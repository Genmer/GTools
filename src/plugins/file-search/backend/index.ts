import { execFile } from 'node:child_process'
import { stat as fsStat } from 'node:fs/promises'
import type { BackendContext, PluginBackend } from '@sdk/api'
import { MAX_HITS, mdfindLineCount, parseMdfindLines, type FileHit } from '../logic/parse'
import { ERROR_EVENT, PLATFORM_HINT, REQ_KEY, RESULTS_EVENT, type SearchRequest } from '../logic/protocol'

const POLL_MS = 250
const MDFIND_TIMEOUT_MS = 5000
// mdfind 宽词可能吐出上 MB 路径；超限按搜索失败处理，v1 不做流失读取
const MAX_BUFFER = 8 * 1024 * 1024

/** exec/stat 注入面：单测用假实现，不碰真实进程与文件系统 */
export interface SearchDeps {
  platform: string
  execFile(cmd: string, args: string[], opts: { timeout: number }): Promise<{ stdout: string }>
  stat(path: string): Promise<{ isDirectory: boolean }>
}

/** 平台文件名搜索器；win32 留接口：Everything CLI（es.exe）或 PowerShell 递归都需外部依赖/较慢，接入前回不支持提示 */
type NameSearcher = (q: string, deps: SearchDeps) => Promise<{ stdout: string }>

const NAME_SEARCHERS: Partial<Record<string, NameSearcher>> = {
  darwin: async (q, deps) => deps.execFile('mdfind', ['-name', q], { timeout: MDFIND_TIMEOUT_MS })
}

export interface FileSearchBackendOptions {
  deps?: SearchDeps
  pollMs?: number
}

export function isSearchRequest(v: unknown): v is SearchRequest {
  if (typeof v !== 'object' || v === null) return false
  const r = v as SearchRequest
  return typeof r.q === 'string' && typeof r.seq === 'number' && Number.isFinite(r.seq)
}

/**
 * 渲染层把 {q, seq} 写进 storage，backend 轮询发现 seq 变化即跑 mdfind 并 emit 结果
 * （storage 是协议内唯一渲染→backend 请求通道，同 launcher scanRequest）。
 * 搜索进行中收到新请求只暂存最新一条，跑完当前后立即执行，响应天然按请求序到达。
 */
export function createFileSearchBackend(opts: FileSearchBackendOptions = {}): PluginBackend & { pollOnce(): Promise<void> } {
  let ctx: BackendContext | null = null
  let deps: SearchDeps | null = opts.deps ?? null
  let timer: ReturnType<typeof setInterval> | null = null
  let lastSeq: number | null = null
  let draining = false
  let pending: SearchRequest | null = null

  async function runSearch(req: SearchRequest): Promise<void> {
    if (!ctx) return
    if (deps === null) deps = defaultDeps()
    const q = req.q.trim()
    if (q === '') {
      emitResults(req, [], 0, 0)
      return
    }
    const searcher = NAME_SEARCHERS[deps.platform]
    if (searcher === undefined) {
      ctx.emit(ERROR_EVENT, { seq: req.seq, q, code: 'UNSUPPORTED_PLATFORM', message: PLATFORM_HINT })
      return
    }
    const startedAt = Date.now()
    try {
      const { stdout } = await searcher(q, deps)
      const hits = parseMdfindLines(stdout, MAX_HITS)
      await enrichDirectories(hits)
      emitResults(req, hits, mdfindLineCount(stdout), Date.now() - startedAt)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      ctx.emit(ERROR_EVENT, { seq: req.seq, q, code: 'SEARCH_FAILED', message: `mdfind 执行失败：${message}` })
    }
  }

  function emitResults(req: SearchRequest, hits: FileHit[], total: number, elapsedMs: number): void {
    ctx!.emit(RESULTS_EVENT, { seq: req.seq, q: req.q, hits, total, elapsedMs })
  }

  // 目录徽标准确性靠 stat 补全（mdfind 输出不区分文件/目录）；stat 失败按文件兜底
  async function enrichDirectories(hits: FileHit[]): Promise<void> {
    await Promise.all(
      hits.map(async (h) => {
        try {
          h.isDirectory = (await deps!.stat(h.path)).isDirectory
        } catch {
          // 文件可能在索引与查询之间被删，静默降级为文件
        }
      })
    )
  }

  async function pollOnce(): Promise<void> {
    if (!ctx) return
    let req: unknown
    try {
      req = await ctx.storage.get(REQ_KEY)
    } catch {
      return // storage 故障本轮放弃，下轮轮询再试
    }
    if (!isSearchRequest(req)) return
    if (lastSeq !== null && req.seq <= lastSeq) return
    lastSeq = req.seq
    pending = req
    if (draining) return
    draining = true
    try {
      while (pending !== null) {
        const cur = pending
        pending = null
        await runSearch(cur)
      }
    } finally {
      draining = false
    }
  }

  return {
    async init(c): Promise<void> {
      ctx = c
    },
    async start(): Promise<void> {
      if (!ctx) throw new Error('file-search backend 未 init 即 start')
      if (timer !== null) return
      timer = setInterval(() => void pollOnce(), opts.pollMs ?? POLL_MS)
    },
    async stop(): Promise<void> {
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      lastSeq = null
      pending = null
    },
    pollOnce
  }
}

function defaultDeps(): SearchDeps {
  return {
    platform: process.platform,
    execFile: (cmd, args, opts) =>
      new Promise((resolve, reject) => {
        execFile(cmd, args, { timeout: opts.timeout, windowsHide: true, maxBuffer: MAX_BUFFER }, (err, stdout) => {
          if (err) reject(err)
          else resolve({ stdout: String(stdout) })
        })
      }),
    stat: async (path) => {
      const s = await fsStat(path)
      return { isDirectory: s.isDirectory() }
    }
  }
}

export default createFileSearchBackend()
