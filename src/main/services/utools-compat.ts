import { extname, join, resolve, sep } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/**
 * uTools 移植 POC（阶段 1）：plugin.json 解析、本地静态服务、utools API shim。
 * 独立目录 userData/utools-plugins/，与 userData/plugins/ 的安全边界无关；
 * 不执行插件 preload.js（require 全量 Node），只服务页面 + 注入白名单 shim。
 * electron 一律不 import，fs 依赖构造注入。
 */

export interface UtoolsFeature {
  code: string
  explain: string
  cmds: string[]
  /** 对象型 cmds 的原始 type（'over'/'regex'/…），与 cmds 按下标对应；字符串型 cmd 为 undefined */
  cmdTypes?: (string | undefined)[]
}

export interface UtoolsManifest {
  name: string
  description: string
  version: string
  main: string
  logo: string
  /** 清单声明的 preload 路径原样透传（POC 不执行，仅供「功能受限（需 Node）」徽标判定） */
  preload?: string
  features: UtoolsFeature[]
}

export interface UtoolsParseResult {
  ok: boolean
  manifest?: UtoolsManifest
  errors: string[]
}

export interface UtoolsScanEntry {
  /** 目录名即 id */
  id: string
  manifest?: UtoolsManifest
  /** 清单缺失/非法时的灰显原因 */
  error?: string
}

export interface UtoolsScanFs {
  readdir(path: string, opts: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean }>>
  readFile(path: string, encoding: 'utf-8'): Promise<string>
}

export interface UtoolsServeFs {
  readFile(path: string): Promise<Buffer>
  /** 解引用符号链接后的真实路径：越界判定必须按真实路径做（词法 resolve 防不住插件目录内的 symlink） */
  realpath(path: string): Promise<string>
}

/** 关键字段（name/main）缺失即整体判废；feature 项缺 code/cmds 只剔除该项并记入 errors */
export function parseUtoolsManifest(text: string): UtoolsParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, errors: [`plugin.json 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`] }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['plugin.json 顶层必须是对象'] }
  }
  const r = raw as Record<string, unknown>
  const errors: string[] = []
  const name = typeof r.pluginName === 'string' ? r.pluginName.trim() : ''
  if (name === '') errors.push('pluginName 缺失或为空')
  const main = typeof r.main === 'string' && r.main.trim() !== '' ? r.main.trim() : ''
  if (main === '') errors.push('main 缺失或为空')
  if (errors.length > 0) return { ok: false, errors }

  const features: UtoolsFeature[] = []
  if (r.features !== undefined) {
    if (!Array.isArray(r.features)) {
      errors.push('features 须为数组，已忽略')
    } else {
      r.features.forEach((item, i) => {
        if (typeof item !== 'object' || item === null) {
          errors.push(`features[${i}] 不是对象，已忽略`)
          return
        }
        const f = item as Record<string, unknown>
        const code = typeof f.code === 'string' ? f.code.trim() : ''
        if (code === '') {
          errors.push(`features[${i}].code 缺失或为空，已忽略`)
          return
        }
        const cmds: string[] = []
        const cmdTypes: (string | undefined)[] = []
        let hasTyped = false
        if (f.cmds !== undefined && !Array.isArray(f.cmds)) {
          errors.push(`features[${i}].cmds 须为数组，已忽略`)
        } else if (Array.isArray(f.cmds)) {
          f.cmds.forEach((c, j) => {
            if (typeof c === 'string') {
              if (c.trim() === '') {
                errors.push(`features[${i}].cmds[${j}] 为空字符串，已忽略`)
                return
              }
              cmds.push(c)
              cmdTypes.push(undefined)
              return
            }
            if (typeof c === 'object' && c !== null && typeof (c as Record<string, unknown>).label === 'string') {
              const label = ((c as Record<string, unknown>).label as string).trim()
              const type = (c as Record<string, unknown>).type
              if (label === '') {
                errors.push(`features[${i}].cmds[${j}].label 为空，已忽略`)
                return
              }
              cmds.push(label)
              cmdTypes.push(typeof type === 'string' ? type : undefined)
              hasTyped = true
              return
            }
            errors.push(`features[${i}].cmds[${j}] 须为字符串或含 label 的对象，已忽略`)
          })
        }
        features.push({
          code,
          explain: typeof f.explain === 'string' ? f.explain : '',
          cmds,
          ...(hasTyped ? { cmdTypes } : {})
        })
      })
    }
  }

  return {
    ok: true,
    manifest: {
      name,
      description: typeof r.description === 'string' ? r.description : '',
      version: typeof r.version === 'string' ? r.version : '',
      main,
      logo: typeof r.logo === 'string' ? r.logo : '',
      ...(typeof r.preload === 'string' && r.preload.trim() !== '' ? { preload: r.preload } : {}),
      features
    },
    errors
  }
}

/** 只扫一级子目录，各自读 plugin.json；目录不存在/不可读视为空，单目录读失败记 error 不中断 */
export async function scanUtoolsPlugins(dir: string, fsLike: UtoolsScanFs): Promise<UtoolsScanEntry[]> {
  let dirents: Array<{ name: string; isDirectory(): boolean }>
  try {
    dirents = await fsLike.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: UtoolsScanEntry[] = []
  for (const ent of dirents) {
    if (!ent.isDirectory() || ent.name.startsWith('.')) continue
    let text: string
    try {
      text = await fsLike.readFile(join(dir, ent.name, 'plugin.json'), 'utf-8')
    } catch {
      out.push({ id: ent.name, error: 'plugin.json 不存在或不可读' })
      continue
    }
    const parsed = parseUtoolsManifest(text)
    if (parsed.ok && parsed.manifest) out.push({ id: ent.name, manifest: parsed.manifest })
    else out.push({ id: ent.name, error: parsed.errors.join('；') })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  json: 'application/json; charset=utf-8',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2'
}

const SHIM_FILE = '__gtools-shim.js'

/** shim 须赶在插件自身脚本前执行（onPluginEnter 注册先于宿主 push），故注入点选 </head> 前 */
function injectShim(html: string, shimSrc: string): string {
  const tag = `<script src="${shimSrc}"></script>`
  if (/<\/head\s*>/i.test(html)) return html.replace(/<\/head\s*>/i, () => `${tag}</head>`)
  const bodyOpen = html.match(/<body[^>]*>/i)
  if (bodyOpen?.index !== undefined) {
    return html.slice(0, bodyOpen.index) + `${bodyOpen[0]}${tag}` + html.slice(bodyOpen.index + bodyOpen[0].length)
  }
  return `${tag}${html}`
}

export interface UtoolsPluginServer {
  readonly port: number
  /** serve 前由调用方刷新：id → main 文件名（id 白名单 + 根路径 302 目标） */
  setPlugins(mains: Record<string, string>): void
  url(id: string): string
  close(): Promise<void>
}

/**
 * 127.0.0.1 随机端口静态服务：GET /<pluginId>/<path> 服务 rootDir 下对应插件目录，
 * 首段 id 必须在 setPlugins 白名单内；resolve 后越出插件根一律拒绝（防 .. / 编码穿越）。
 */
export async function createPluginServer(opts: { rootDir: string; fsLike?: UtoolsServeFs }): Promise<UtoolsPluginServer> {
  const fsLike = opts.fsLike ?? (await import('node:fs/promises'))
  const root = resolve(opts.rootDir)
  const mains = new Map<string, string>()

  const server: Server = createServer((req, res) => {
    const reply = (status: number, body: string, contentType = 'text/plain; charset=utf-8'): void => {
      res.writeHead(status, { 'Content-Type': contentType })
      res.end(req.method === 'HEAD' ? undefined : body)
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      reply(405, '仅支持 GET')
      return
    }
    let pathname: string
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
    } catch {
      reply(400, 'URL 解码失败')
      return
    }
    const segments = pathname.split('/').filter((s) => s !== '')
    const id = segments[0] ?? ''
    const main = mains.get(id)
    if (main === undefined) {
      reply(404, '未知插件')
      return
    }
    const rel = segments.slice(1)
    const shimSrc = `/${encodeURIComponent(id)}/${SHIM_FILE}`

    // 根路径 302 到 main（main 可含子目录，逐段编码防注入）
    if (rel.length === 0) {
      res.writeHead(302, { Location: `/${encodeURIComponent(id)}/${main.split('/').map(encodeURIComponent).join('/')}` })
      res.end()
      return
    }
    if (rel.length === 1 && rel[0] === SHIM_FILE) {
      reply(200, shimScript(), 'text/javascript; charset=utf-8')
      return
    }

    // 归一化后必须仍落在插件根内；盘符切换（win 的 D:\）与 .. 都在这里被拦下
    const pluginRoot = resolve(root, id)
    const full = resolve(pluginRoot, join(...rel))
    if (full !== pluginRoot && !full.startsWith(pluginRoot + sep)) {
      reply(403, '路径越界')
      return
    }
    // 符号链接会骗过词法归一化（link -> 目录外文件会被 readFile 跟随）：根与目标都解引用后再比对一次
    Promise.all([fsLike.realpath(pluginRoot), fsLike.realpath(full)])
      .then(([realRoot, realFull]) => {
        if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) {
          reply(403, '路径越界')
          return undefined
        }
        return fsLike.readFile(full).then((data) => {
          const mime = MIME_BY_EXT[extname(full).slice(1).toLowerCase()] ?? 'application/octet-stream'
          const isHtml = mime.startsWith('text/html')
          res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' })
          res.end(isHtml && !req.headers.range ? injectShim(data.toString('utf-8'), shimSrc) : data)
        })
      })
      .catch(() => reply(404, '文件不存在'))
  })

  await new Promise<void>((res, rej) => {
    const onError = (err: Error): void => rej(err)
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      res()
    })
  })

  const port = (server.address() as AddressInfo).port
  return {
    port,
    setPlugins(m) {
      mains.clear()
      for (const [id, main] of Object.entries(m)) mains.set(id, main)
    },
    url(id) {
      const main = mains.get(id) ?? 'index.html'
      return `http://127.0.0.1:${port}/${encodeURIComponent(id)}/${main.split('/').map(encodeURIComponent).join('/')}`
    },
    close() {
      // keep-alive 连接会挂住 close 回调，先掐掉全部连接保证端口确定释放
      server.closeAllConnections()
      return new Promise((res) => server.close(() => res()))
    }
  }
}

/** 注入插件页的 window.utools shim：白名单外成员不存在，插件自行降级；宿主能力经 postMessage 桥转发 */
export function shimScript(): string {
  return `(function () {
  'use strict'
  if (window.utools) return
  var pending = new Map()
  var reqSeq = 0
  var enterCbs = []
  var outCbs = []
  function request(action, payload) {
    return new Promise(function (resolve, reject) {
      var reqId = 'req-' + String(++reqSeq) + '-' + Math.random().toString(36).slice(2)
      pending.set(reqId, { resolve: resolve, reject: reject })
      window.parent.postMessage({ source: 'gtools-utools-shim', action: action, payload: payload, reqId: reqId }, '*')
    })
  }
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return
    var d = e.data
    if (!d || typeof d !== 'object') return
    if (d.type === 'gtools:enter' && d.payload) {
      enterCbs.forEach(function (cb) {
        try { cb(d.payload) } catch (_) {}
      })
      return
    }
    if (d.type === 'gtools:out') {
      outCbs.forEach(function (cb) {
        try { cb(false) } catch (_) {}
      })
      return
    }
    if (d.source !== 'gtools-utools-host' || typeof d.reqId !== 'string') return
    var entry = pending.get(d.reqId)
    if (!entry) return
    pending.delete(d.reqId)
    if (d.ok) entry.resolve(d.data)
    else entry.reject(new Error(d.error || 'utools api 调用失败'))
  })
  window.utools = {
    onPluginEnter: function (cb) { if (typeof cb === 'function') enterCbs.push(cb) },
    onPluginOut: function (cb) { if (typeof cb === 'function') outCbs.push(cb) },
    copyText: function (text) { return request('copyText', { text: String(text == null ? '' : text) }) },
    notify: function (body) { return request('notify', { body: String(body == null ? '' : body) }) },
    hideMainWindow: function () { return request('hideMainWindow', {}) }
  }
  Object.freeze(window.utools)
})()
`
}
