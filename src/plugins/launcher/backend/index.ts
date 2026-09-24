import type { BackendContext, PluginBackend } from '@sdk/api'
import { scanApps } from '../scan'
import { isCacheStale, parseCache, type AppEntry, type AppsCache, type ScanDeps } from '../types'

const CACHE_KEY = 'apps'
const REQUEST_KEY = 'scanRequest'
const DEFAULT_POLL_MS = 1500

// web tsconfig 程序会收走 src/plugins 下所有 .ts 且无 node 类型，顶层 import node:* 会挂共享 typecheck；
// 非字面量说明符的动态导入不参与类型解析，只在主进程运行期执行（backend 永不进渲染 bundle）
async function buildDefaultDeps(): Promise<ScanDeps> {
  const p = 'node:'
  const fsMod = (await import(/* @vite-ignore */ p + 'fs/promises')) as {
    readdir(path: string, opts: { withFileTypes: true }): Promise<{ name: string; isDirectory(): boolean }[]>
    readFile(path: string, opts: { encoding: 'utf-8' }): Promise<string>
  }
  const cpMod = (await import(/* @vite-ignore */ p + 'child_process')) as {
    execFile(
      cmd: string,
      args: string[],
      opts: { windowsHide: true },
      cb: (err: Error | null, stdout: string, stderr: string) => void
    ): unknown
  }
  const osMod = (await import(/* @vite-ignore */ p + 'os')) as { homedir(): string }
  const procMod = (await import(/* @vite-ignore */ p + 'process')) as {
    env: Record<string, string | undefined>
    platform: string
  }
  return {
    platform: procMod.platform,
    homeDir: osMod.homedir(),
    env: procMod.env,
    fs: {
      readdir: (dir) => fsMod.readdir(dir, { withFileTypes: true }),
      readFile: (path) => fsMod.readFile(path, { encoding: 'utf-8' })
    },
    exec: {
      execFile: (cmd, args) =>
        new Promise((resolve, reject) => {
          cpMod.execFile(cmd, args, { windowsHide: true }, (err, stdout, stderr) =>
            err ? reject(err) : resolve({ stdout, stderr })
          )
        })
    }
  }
}

export interface LauncherBackendOptions {
  /** 注入扫描依赖（测试走 fixture 目录），缺省运行期取 node 内置模块 */
  deps?: () => Promise<ScanDeps>
  /** 注入扫描实现（测试注入失败/单飞），缺省 scanApps */
  scan?: (deps: ScanDeps) => Promise<AppEntry[]>
  pollMs?: number
}

/**
 * 扫描结果经 ctx.storage 缓存（渲染层同 key 直读）；渲染层「刷新」写 scanRequest 时间戳，
 * backend 轮询该 key 感知请求——BackendContext 无文件系统能力，这是协议内唯一的请求通道。
 */
export function createLauncherBackend(opts: LauncherBackendOptions = {}): PluginBackend {
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS
  const resolveDeps = opts.deps ?? buildDefaultDeps
  const scan = opts.scan ?? scanApps

  let ctx: BackendContext | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let scanning = false
  let lastRequest: number | null = null

  async function readCache(): Promise<AppsCache | null> {
    return parseCache(await ctx!.storage.get(CACHE_KEY))
  }

  async function rescan(reason: 'stale' | 'manual'): Promise<void> {
    if (!ctx || scanning) return
    scanning = true
    ctx.emit('scan-started', { reason })
    try {
      const deps = await resolveDeps()
      const apps = await scan(deps)
      const cache: AppsCache = { version: 1, scannedAt: Date.now(), apps }
      await ctx.storage.set(CACHE_KEY, cache)
      ctx.emit('scan-done', { reason, scannedAt: cache.scannedAt, count: apps.length, apps })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.emit('scan-error', { reason, message })
      try {
        await ctx.notification.show('应用扫描失败', message)
      } catch {
        // 通知失败不再上报
      }
    } finally {
      scanning = false
    }
  }

  async function checkScanRequest(): Promise<void> {
    if (!ctx || scanning) return
    let req: unknown
    try {
      req = await ctx.storage.get(REQUEST_KEY)
    } catch {
      return
    }
    if (typeof req !== 'number' || !Number.isFinite(req)) return
    if (lastRequest !== null && req === lastRequest) return
    const cache = await readCache()
    // 首次见到请求且不晚于上次扫描 → 只记基准不补扫（吃掉 start 前残留的旧请求）
    if (lastRequest === null && cache !== null && req <= cache.scannedAt) {
      lastRequest = req
      return
    }
    lastRequest = req
    await rescan('manual')
  }

  return {
    async init(c): Promise<void> {
      ctx = c
    },
    async start(): Promise<void> {
      if (!ctx) throw new Error('launcher backend 未 init 即 start')
      if (timer !== null) return
      const cache = await readCache()
      if (isCacheStale(cache, Date.now())) void rescan('stale') // 后台进行，不阻塞 start
      timer = setInterval(() => void checkScanRequest(), pollMs)
      void checkScanRequest()
    },
    async stop(): Promise<void> {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      lastRequest = null
    }
  }
}

export default createLauncherBackend()
