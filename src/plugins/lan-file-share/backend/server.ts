/**
 * 局域网共享 HTTP 服务路由：文件列表/下载/在线预览/Range/打包 zip/上传，
 * 文件能力全部经注入的 ShareFs（生产为 ctx.fs，测试为内存实现）。
 */
import type { LogKind } from '../shared'
import {
  contentDispositionHeader,
  contentTypeFor,
  decodeRel,
  joinRel,
  normalizeRelPath,
  previewKindFor,
  sanitizeFilename,
  uniqueFileName
} from '../logic/paths'
import { buildZip, type ZipInput } from './zip'
import { boundaryFromContentType, parseMultipart } from './multipart'
import { mobilePageHtml } from './http-page'

export interface ShareFsEntry {
  name: string
  /** 绝对路径（与 ctx.fs.list 同构；fake 实现也须返回绝对路径） */
  path: string
  isDirectory: boolean
  size: number
}

export interface ShareFs {
  list(dir: string): Promise<ShareFsEntry[]>
  stat(path: string): Promise<{ exists: boolean; isFile: boolean; isDirectory: boolean; size: number } | null>
  read(path: string): Promise<string>
  write(path: string, base64: string, opts?: { append?: boolean; createDir?: boolean }): Promise<void>
}

export interface ServerRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
  on(event: 'data', cb: (chunk: Buffer) => void): unknown
  on(event: 'end', cb: () => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
}

export interface ServerResponse {
  statusCode: number
  setHeader(k: string, v: string | number): void
  write(chunk: Buffer | string): boolean
  end(data?: Buffer | string): void
  on(event: 'error', cb: (err: Error) => void): unknown
}

export interface ShareServerOptions {
  fs: ShareFs
  rootDir: string
  now(): number
  maxBodyBytes: number
  maxServeBytes: number
  maxZipBytes: number
  deflate: (b: Buffer) => Buffer
  /** 每个请求登记设备；返回展示名与是否新连接（新连接由 server 记 connect 日志） */
  device(ip: string, ua: string): { label: string; isNew: boolean }
  onLog(e: { kind: LogKind; device: string; name?: string; size?: number; detail?: string }): void
}

const MAX_ZIP_PATHS = 200

export class ShareServer {
  private readonly sep: string
  /** 整文件读进内存是协议（ctx.fs 无分段读）决定的，串行化读避免并发叠加撑爆内存 */
  private readChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly opts: ShareServerOptions) {
    this.sep = opts.rootDir.includes('\\') ? '\\' : '/' // win32 根路径为反斜杠（未实测）
  }

  handle(req: ServerRequest, res: ServerResponse): void {
    void this.dispatch(req, res).catch(() => {
      this.safeEnd(res, 500, '服务器内部错误')
    })
  }

  private async dispatch(req: ServerRequest, res: ServerResponse): Promise<void> {
    res.on('error', () => {}) // 手机端中途断开属常态，吞掉避免未处理 error 抛崩
    const url = new URL(req.url ?? '/', 'http://lan')
    const method = (req.method ?? 'GET').toUpperCase()

    const { label, isNew } = this.opts.device(clientIp(req), header(req, 'user-agent') ?? '')
    if (isNew) this.opts.onLog({ kind: 'connect', device: label })

    if (url.pathname === '/' || url.pathname === '/index.html') {
      this.html(res, mobilePageHtml())
      return
    }
    if (url.pathname === '/favicon.ico') {
      res.statusCode = 204
      res.end()
      return
    }
    if (!url.pathname.startsWith('/api/')) {
      this.errorPage(res, 404, '页面不存在')
      return
    }

    if (method === 'GET' && url.pathname === '/api/list') return this.apiList(url, res)
    if (method === 'GET' && url.pathname === '/api/raw') return this.apiRaw(url, req, res, label)
    if (method === 'GET' && url.pathname === '/api/download') return this.apiDownload(url, res, label)
    if (method === 'GET' && url.pathname === '/api/zip') return this.apiZip(url, res, label)
    if (method === 'POST' && url.pathname === '/api/upload') return this.apiUpload(url, req, res, label)
    this.errorPage(res, 404, '接口不存在')
  }

  private async apiList(url: URL, res: ServerResponse): Promise<void> {
    const rel = await this.relParam(url)
    if (rel === null) return this.errorPage(res, 400, '路径非法')
    const entries = await this.opts.fs.list(this.abs(rel))
    const items: Array<{ name: string; path: string; isDir: boolean; size: number; kind: string | null }> = []
    for (const e of entries) {
      const r = this.relOf(e.path)
      if (r === null) continue
      items.push({ name: e.name, path: r, isDir: e.isDirectory, size: e.size, kind: previewKindFor(e.name) })
    }
    items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    this.json(res, 200, { ok: true, entries: items })
  }

  private async apiRaw(url: URL, req: ServerRequest, res: ServerResponse, device: string): Promise<void> {
    const loaded = await this.loadFile(url, res)
    if (loaded === null) return
    const { name, buf } = loaded
    res.setHeader('Content-Type', contentTypeFor(name))
    res.setHeader('Content-Disposition', contentDispositionHeader(name, 'inline'))

    const range = header(req, 'range')
    const m = range !== undefined ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
    if (m === null) {
      res.setHeader('Content-Length', buf.length)
      res.statusCode = 200
      res.end(buf)
    } else {
      const start = m[1] === '' ? 0 : Number.parseInt(m[1], 10)
      const end = m[2] === '' ? buf.length - 1 : Math.min(Number.parseInt(m[2], 10), buf.length - 1)
      if (!Number.isFinite(start) || start > end || start >= buf.length) {
        res.setHeader('Content-Range', `bytes */${buf.length}`)
        return this.errorPage(res, 416, '区间不可用')
      }
      const slice = buf.subarray(start, end + 1)
      res.setHeader('Content-Range', `bytes ${start}-${end}/${buf.length}`)
      res.setHeader('Content-Length', slice.length)
      res.statusCode = 206
      res.end(slice)
    }
    this.opts.onLog({ kind: 'download', device, name, size: buf.length, detail: '在线预览' })
  }

  private async apiDownload(url: URL, res: ServerResponse, device: string): Promise<void> {
    const rel = await this.relParam(url)
    if (rel === null) return this.errorPage(res, 400, '路径非法')
    const st = await this.opts.fs.stat(this.abs(rel))
    if (st !== null && st.exists && st.isDirectory) {
      const name = rel.split('/').pop() ?? 'files'
      return this.sendZip([rel], res, `${name}.zip`, device)
    }
    const loaded = await this.loadFile(url, res)
    if (loaded === null) return
    const { name, buf } = loaded
    res.setHeader('Content-Type', contentTypeFor(name))
    res.setHeader('Content-Disposition', contentDispositionHeader(name, 'attachment'))
    res.setHeader('Content-Length', buf.length)
    res.statusCode = 200
    res.end(buf)
    this.opts.onLog({ kind: 'download', device, name, size: buf.length })
  }

  private async apiZip(url: URL, res: ServerResponse, device: string): Promise<void> {
    let raw: unknown
    try {
      raw = JSON.parse(url.searchParams.get('paths') ?? '[]')
    } catch {
      return this.errorPage(res, 400, '路径参数非法')
    }
    if (!Array.isArray(raw) || raw.length === 0) return this.errorPage(res, 400, '未选择文件')
    if (raw.length > MAX_ZIP_PATHS) return this.errorPage(res, 400, `一次最多打包 ${MAX_ZIP_PATHS} 项`)
    const rels: string[] = []
    for (const item of raw) {
      if (typeof item !== 'string') return this.errorPage(res, 400, '路径参数非法')
      const rel = await this.relParamFor(item)
      if (rel === null) return this.errorPage(res, 400, '路径非法')
      if (!rels.includes(rel)) rels.push(rel)
    }
    await this.sendZip(rels, res, 'files.zip', device)
  }

  private async apiUpload(url: URL, req: ServerRequest, res: ServerResponse, device: string): Promise<void> {
    const boundary = boundaryFromContentType(header(req, 'content-type'))
    if (boundary === null) return this.json(res, 400, { ok: false, error: '缺少 multipart 边界' })
    const body = await this.readBody(req)
    if (body.tooLarge) {
      return this.json(res, 413, {
        ok: false,
        error: `单次上传超过 ${Math.floor(this.opts.maxBodyBytes / 1024 / 1024)}MB 上限，请分批或压缩后上传`
      })
    }
    if (body.error) return this.json(res, 500, { ok: false, error: '接收数据中断' })

    const dirRel = await this.relParamFor(url.searchParams.get('dir') ?? '')
    if (dirRel === null) return this.json(res, 400, { ok: false, error: '目标目录非法' })

    const parts = parseMultipart(body.buf, boundary).filter((p) => p.filename !== undefined)
    if (parts.length === 0) return this.json(res, 400, { ok: false, error: '未收到文件' })

    let existing: string[] = []
    try {
      existing = (await this.opts.fs.list(this.abs(dirRel))).map((e) => e.name)
    } catch {
      existing = [] // 目标目录可能尚未创建，write createDir 兜底
    }

    const saved: Array<{ name: string; size: number; error?: string }> = []
    for (const part of parts) {
      const desired = sanitizeFilename(part.filename ?? '')
      const name = uniqueFileName(existing, desired)
      try {
        await this.opts.fs.write(this.abs(joinRel(dirRel, name)), part.data.toString('base64'), { createDir: true })
        existing.push(name)
        saved.push({ name, size: part.data.length })
        this.opts.onLog({ kind: 'upload', device, name, size: part.data.length })
      } catch (err) {
        saved.push({ name: desired, size: part.data.length, error: err instanceof Error ? err.message : String(err) })
      }
    }
    if (saved.every((s) => s.error !== undefined)) return this.json(res, 500, { ok: false, error: saved[0]?.error ?? '写入失败' })
    this.json(res, 200, { ok: true, saved })
  }

  /** 打包下载（多选/整目录）：收集条目 → 体积封顶 → zip → 一次性回包 */
  private async sendZip(rels: string[], res: ServerResponse, zipName: string, device: string): Promise<void> {
    const entries: ZipInput[] = []
    let total = 0
    let fileCount = 0
    const addFile = async (rel: string, abs: string, size: number): Promise<boolean> => {
      if (size > this.opts.maxServeBytes) {
        this.errorPage(res, 413, '含超过单文件上限的大文件，无法打包')
        return false
      }
      total += size
      if (total > this.opts.maxZipBytes) {
        this.errorPage(res, 413, '所选内容总量超过打包上限')
        return false
      }
      entries.push({ path: rel, data: await this.queueRead(abs) })
      fileCount++
      return true
    }

    for (const rel of rels) {
      const abs = this.abs(rel)
      const st = await this.opts.fs.stat(abs)
      if (st === null || !st.exists) continue
      if (st.isFile) {
        if (!(await addFile(rel, abs, st.size))) return
        continue
      }
      entries.push({ path: rel === '' ? '共享文件夹/' : `${rel}/`, data: Buffer.alloc(0) })
      let level = [abs]
      while (level.length > 0) {
        const next: string[] = []
        for (const dir of level) {
          for (const e of await this.opts.fs.list(dir)) {
            const r = this.relOf(e.path)
            if (r === null) continue
            if (e.isDirectory) {
              entries.push({ path: `${r}/`, data: Buffer.alloc(0) })
              next.push(e.path)
            } else if (!(await addFile(r, e.path, e.size))) {
              return
            }
          }
        }
        level = next
      }
    }
    if (fileCount === 0) return this.errorPage(res, 400, '没有可下载的文件')

    const zip = buildZip(entries, { deflate: this.opts.deflate, now: new Date(this.opts.now()) })
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', contentDispositionHeader(zipName, 'attachment'))
    res.setHeader('Content-Length', zip.length)
    res.statusCode = 200
    res.end(zip)
    this.opts.onLog({ kind: 'zip', device, name: zipName, size: zip.length, detail: `${fileCount} 个文件` })
  }

  /** 供 raw/download 共用：校验存在性与单文件上限后整读（走串行队列） */
  private async loadFile(url: URL, res: ServerResponse): Promise<{ name: string; buf: Buffer } | null> {
    const rel = await this.relParam(url)
    if (rel === null) {
      this.errorPage(res, 400, '路径非法')
      return null
    }
    const name = rel.split('/').pop() ?? 'file'
    const abs = this.abs(rel)
    const st = await this.opts.fs.stat(abs)
    if (st === null || !st.exists || st.isDirectory) {
      this.errorPage(res, 404, '文件不存在')
      return null
    }
    if (st.size > this.opts.maxServeBytes) {
      this.errorPage(res, 413, `文件超过 ${Math.floor(this.opts.maxServeBytes / 1024 / 1024)}MB 单文件上限，暂不支持在线传输`)
      return null
    }
    return { name, buf: await this.queueRead(abs) }
  }

  /** rel（'/' 分隔）→ 平台绝对路径；调用方已过 normalizeRelPath */
  private abs(rel: string): string {
    if (rel === '') return this.opts.rootDir
    return this.opts.rootDir + this.sep + rel.replace(/\//g, this.sep)
  }

  /** fs 返回的绝对路径 → rel；越出根（符号链接逃逸等）返回 null */
  private relOf(absPath: string): string | null {
    if (absPath === this.opts.rootDir) return ''
    const prefix = this.opts.rootDir + this.sep
    if (!absPath.startsWith(prefix)) return null
    return absPath.slice(prefix.length).split(this.sep).join('/')
  }

  private async relParam(url: URL): Promise<string | null> {
    return this.relParamFor(url.searchParams.get('path') ?? '')
  }

  private async relParamFor(raw: string): Promise<string | null> {
    const decoded = decodeRel(raw)
    if (decoded === null) return null
    return normalizeRelPath(decoded)
  }

  private queueRead(abs: string): Promise<Buffer> {
    const run = async (): Promise<Buffer> => Buffer.from(await this.opts.fs.read(abs), 'base64')
    const next = this.readChain.then(run, run)
    this.readChain = next.catch(() => {})
    return next
  }

  private readBody(req: ServerRequest): Promise<{ buf: Buffer; tooLarge?: boolean; error?: boolean }> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let total = 0
      let tooLarge = false
      let settled = false
      const finish = (error: boolean): void => {
        if (settled) return
        settled = true
        resolve({ buf: tooLarge ? Buffer.alloc(0) : Buffer.concat(chunks), tooLarge, error })
      }
      req.on('data', (chunk) => {
        if (tooLarge) return
        total += chunk.length
        if (total > this.opts.maxBodyBytes) {
          tooLarge = true
          chunks.length = 0
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => finish(false))
      req.on('error', () => finish(true))
    })
  }

  private json(res: ServerResponse, code: number, obj: unknown): void {
    const body = JSON.stringify(obj)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Length', Buffer.byteLength(body))
    res.statusCode = code
    res.end(body)
  }

  private html(res: ServerResponse, body: string): void {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Length', Buffer.byteLength(body))
    res.statusCode = 200
    res.end(body)
  }

  private errorPage(res: ServerResponse, code: number, msg: string): void {
    this.safeEnd(res, code, msg)
  }

  private safeEnd(res: ServerResponse, code: number, msg: string): void {
    try {
      const esc = msg.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)
      const body = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px"><h3>${code}</h3><p>${esc}</p>`
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Length', Buffer.byteLength(body))
      res.statusCode = code
      res.end(body)
    } catch {
      // 回包阶段连接已断，尽力而为
    }
  }
}

function header(req: ServerRequest, name: string): string | undefined {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

function clientIp(req: ServerRequest): string {
  const raw = req.socket?.remoteAddress ?? ''
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw
}
