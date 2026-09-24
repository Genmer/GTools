/**
 * 局域网文件共享 backend：轮询 storage 控制键启停 node:http 服务，
 * 状态快照（运行中/设备/日志）写回 storage 并 emit 推送渲染层。
 * 渲染层退出插件视图时发 stop 控制 → 服务即停（协议内渲染层到 backend 的唯一请求通道就是 storage）。
 */
import type { BackendContext, PluginBackend } from '@sdk/api'
import {
  CONTROL_KEY,
  DEFAULT_PORT,
  DEVICE_CAP,
  DEVICE_TTL_MS,
  LOG_CAP,
  MAX_PORT,
  PORT_ATTEMPTS,
  STATE_KEY,
  normalizePort,
  parseControl,
  type LogKind,
  type ShareState,
  type TransferLogEntry
} from '../shared'
import { DeviceRegistry } from '../logic/devices'
import { parseLog, pushLog } from '../logic/log'
import { ShareServer, type ServerRequest, type ServerResponse, type ShareFs } from './server'

export const MAX_BODY_BYTES = 256 * 1024 * 1024
export const MAX_SERVE_BYTES = 256 * 1024 * 1024
export const MAX_ZIP_BYTES = 256 * 1024 * 1024
const DEFAULT_POLL_MS = 500
const PERSIST_MS = 2000
const NOTIFY_INTERVAL_MS = 10_000

export interface HttpServerHandle {
  on(event: 'error', cb: (err: Error) => void): unknown
  once(event: 'error', cb: (err: Error) => void): unknown
  listen(port: number, host: string, onListening: () => void): unknown
  address(): { port: number } | string | null
  close(cb?: (err?: Error | null) => void): unknown
  /** node 18.2+：立即掐断存量 keep-alive 连接，否则 close 会等手机浏览器连接自然超时 */
  closeAllConnections?(): void
}

export interface LanShareDeps {
  now(): number
  deflate(b: Buffer): Buffer
  createServer(handler: (req: ServerRequest, res: ServerResponse) => void): HttpServerHandle
  listen(server: HttpServerHandle, port: number, host: string): Promise<number>
  close(server: HttpServerHandle): Promise<void>
}

// 顶层 import node:* 会挂 web tsconfig 的共享 typecheck，用非字面量动态导入（同 launcher backend）
async function buildDefaultDeps(): Promise<LanShareDeps> {
  const p = 'node:'
  const httpMod = (await import(/* @vite-ignore */ p + 'http')) as {
    createServer(handler: (req: unknown, res: unknown) => void): unknown
  }
  const zlibMod = (await import(/* @vite-ignore */ p + 'zlib')) as { deflateRawSync(b: Buffer): Buffer }
  return {
    now: () => Date.now(),
    deflate: (b) => zlibMod.deflateRawSync(b),
    createServer: (handler) => httpMod.createServer(handler as (req: unknown, res: unknown) => void) as HttpServerHandle,
    listen: (server, port, host) =>
      new Promise<number>((resolve, reject) => {
        server.on('error', () => {}) // reject 之后的二次 error 兜底，防未处理事件抛崩
        server.once('error', reject)
        server.listen(port, host, () => {
          const a = server.address()
          resolve(typeof a === 'object' && a !== null ? a.port : port)
        })
      }),
    close: (server) =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
        setTimeout(resolve, 3000) // close 回调被存量连接拖延时的兜底
      })
  }
}

export function createCtxShareFs(ctx: BackendContext): ShareFs {
  return {
    list: (dir) => ctx.fs.list(dir),
    stat: (path) => ctx.fs.stat(path),
    read: (path) => ctx.fs.read(path, { encoding: 'base64' }),
    write: (path, base64, opts) => ctx.fs.write(path, base64, { encoding: 'base64', append: opts?.append, createDir: opts?.createDir })
  }
}

export interface LanFileShareBackendOptions {
  pollMs?: number
  deps?: () => Promise<LanShareDeps>
  host?: string
}

export class LanFileShareBackend implements PluginBackend {
  private ctx: BackendContext | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private depsPromise: Promise<LanShareDeps> | null = null
  private httpServer: HttpServerHandle | null = null
  private server: ShareServer | null = null
  private devices = new DeviceRegistry()
  private state: ShareState = emptyState()
  private lastHandledId = 0
  private busy = false
  private dirty = false
  private saving = false
  private lastUploadNotifyAt = 0

  constructor(private readonly opts: LanFileShareBackendOptions = {}) {}

  private get pollMs(): number {
    return this.opts.pollMs ?? DEFAULT_POLL_MS
  }

  private resolveDeps(): Promise<LanShareDeps> {
    this.depsPromise ??= (this.opts.deps ?? buildDefaultDeps)()
    return this.depsPromise
  }

  async init(ctx: BackendContext): Promise<void> {
    this.ctx = ctx
    let persisted: unknown = null
    try {
      persisted = await ctx.storage.get(STATE_KEY)
    } catch {
      persisted = null
    }
    try {
      const stale = parseControl(await ctx.storage.get(CONTROL_KEY))
      if (stale !== null) this.lastHandledId = stale.id // 吃掉上次会话残留请求，不补执行
    } catch {
      // storage 读失败按无残留处理
    }
    const p = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Partial<ShareState>
    this.state = {
      ...emptyState(),
      lastHandledId: this.lastHandledId,
      log: parseLog(p.log, LOG_CAP) // 设备不跨会话保留；上次进程退出时服务已随之关闭
    }
    this.dirty = true
    await this.flush()
  }

  async start(): Promise<void> {
    if (!this.ctx) throw new Error('lan-file-share backend 未 init 即 start')
    if (this.pollTimer !== null) return
    this.pollTimer = setInterval(() => void this.pollOnce(), this.pollMs)
    this.flushTimer = setInterval(() => void this.flush(), PERSIST_MS)
    void this.pollOnce()
  }

  async stop(): Promise<void> {
    if (this.pollTimer !== null) clearInterval(this.pollTimer)
    if (this.flushTimer !== null) clearInterval(this.flushTimer)
    this.pollTimer = null
    this.flushTimer = null
    await this.stopServer('stop')
    await this.flush()
  }

  async dispose(): Promise<void> {
    await this.stop()
  }

  snapshot(): ShareState {
    return this.state
  }

  private async pollOnce(): Promise<void> {
    const ctx = this.ctx
    if (ctx === null || this.busy) return
    let raw: unknown
    try {
      raw = await ctx.storage.get(CONTROL_KEY)
    } catch {
      return
    }
    const msg = parseControl(raw)
    if (msg === null || msg.id === this.lastHandledId) return
    try {
      await this.handleControl(msg)
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err)
      this.addLog({ kind: 'error', device: '本机', detail: this.state.error })
    }
    this.lastHandledId = msg.id
    this.state.lastHandledId = msg.id
    this.emitState()
    void this.flush()
  }

  private async handleControl(msg: { op: 'start' | 'stop'; dir?: string; port?: number }): Promise<void> {
    if (msg.op === 'stop') {
      await this.stopServer('stop')
      return
    }
    this.busy = true
    try {
      await this.startServer(msg.dir ?? this.state.dir ?? '', normalizePort(msg.port) ?? DEFAULT_PORT)
    } finally {
      this.busy = false
    }
  }

  private async startServer(dir: string, port: number): Promise<void> {
    const ctx = this.ctx
    if (ctx === null || dir === '') {
      this.state.error = '未指定共享目录'
      this.addLog({ kind: 'error', device: '本机', detail: '未指定共享目录' })
      return
    }
    let ok = false
    try {
      const st = await ctx.fs.stat(dir)
      ok = st !== null && st.exists && st.isDirectory
    } catch {
      ok = false
    }
    if (!ok) {
      this.state.error = `共享目录不存在：${dir}`
      this.addLog({ kind: 'error', device: '本机', detail: '共享目录不存在' })
      return
    }

    this.devices.reset()
    const now = this.now()
    const deps = await this.resolveDeps()
    this.server = new ShareServer({
      fs: createCtxShareFs(ctx),
      rootDir: dir,
      now: () => this.now(),
      maxBodyBytes: MAX_BODY_BYTES,
      maxServeBytes: MAX_SERVE_BYTES,
      maxZipBytes: MAX_ZIP_BYTES,
      deflate: deps.deflate,
      device: (ip, ua) => {
        const isNew = this.devices.touch(ip, ua, this.now())
        this.state.devices = this.devices.snapshot(this.now(), { cap: DEVICE_CAP, ttlMs: DEVICE_TTL_MS })
        return { label: this.state.devices.find((d) => d.ip === ip)?.label ?? '未知设备', isNew }
      },
      onLog: (e) => this.addLog(e)
    })

    const handler = (req: unknown, res: unknown): void => {
      this.server?.handle(req as ServerRequest, res as ServerResponse)
    }
    const server = deps.createServer(handler)

    let boundPort: number | null = null
    let lastErr = '监听失败'
    for (let i = 0; i < PORT_ATTEMPTS; i++) {
      const tryPort = port + i
      if (tryPort > MAX_PORT) break
      try {
        boundPort = await deps.listen(server, tryPort, this.opts.host ?? '0.0.0.0')
        break
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err)
        // win32 首次监听会弹系统防火墙授权，属预期行为（未实测）
        if ((err as { code?: string }).code !== 'EADDRINUSE') break
      }
    }
    if (boundPort === null) {
      void deps.close(server).catch(() => {})
      this.state.error = `端口不可用：${lastErr}`
      this.addLog({ kind: 'error', device: '本机', detail: `端口监听失败：${lastErr}` })
      this.server = null
      return
    }

    this.httpServer = server
    this.state.running = true
    this.state.port = boundPort
    this.state.dir = dir
    this.state.startedAt = now
    this.state.error = null
    this.addLog({ kind: 'start', device: '本机', detail: `端口 ${boundPort}` })
  }

  private async stopServer(kind: LogKind): Promise<void> {
    if (this.httpServer === null) return
    const deps = await this.resolveDeps()
    const server = this.httpServer
    this.httpServer = null
    this.server = null
    try {
      await deps.close(server)
    } catch {
      // 关闭失败不阻塞状态翻转
    }
    this.state.running = false
    this.state.devices = []
    this.devices.reset()
    this.addLog({ kind, device: '本机' })
  }

  private addLog(e: { kind: LogKind; device: string; name?: string; size?: number; detail?: string }): void {
    const entry: TransferLogEntry = { t: this.now(), ...e }
    this.state.log = pushLog(this.state.log, entry, LOG_CAP)
    if (e.kind === 'upload') void this.notifyUpload(e.device, e.name ?? '')
    this.emitState()
  }

  private notifyUpload(device: string, name: string): void {
    const ctx = this.ctx
    if (ctx === null) return
    const now = this.now()
    if (now - this.lastUploadNotifyAt < NOTIFY_INTERVAL_MS) return
    this.lastUploadNotifyAt = now
    void ctx.notification.show('局域网文件共享', `${device} 上传了「${name}」`).catch(() => {})
  }

  private emitState(): void {
    this.dirty = true
    this.ctx?.emit('state', this.state)
  }

  private async flush(): Promise<void> {
    const ctx = this.ctx
    if (ctx === null || !this.dirty || this.saving) return
    this.saving = true
    this.dirty = false
    try {
      await ctx.storage.set(STATE_KEY, this.state)
    } catch {
      this.dirty = true // 落盘失败保留脏标记，等下轮重试
    } finally {
      this.saving = false
    }
  }

  private now(): number {
    return Date.now()
  }
}

function emptyState(): ShareState {
  return { running: false, port: null, dir: null, startedAt: null, error: null, lastHandledId: 0, devices: [], log: [] }
}

export function createLanFileShareBackend(opts?: LanFileShareBackendOptions): PluginBackend {
  return new LanFileShareBackend(opts)
}

export default createLanFileShareBackend()
