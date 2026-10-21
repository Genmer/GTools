// 应用内更新下载会话纯逻辑：fetchStream/fs/时钟全部构造注入，零 electron import（node 环境可单测）
import { join } from 'node:path'

export interface UpdateDownloadSnapshot {
  state: 'idle' | 'downloading' | 'downloaded' | 'failed'
  receivedBytes: number
  totalBytes: number | null // Content-Length；缺失/非法为 null
  speedBps: number | null // 滑动窗口测速字节/秒；非 downloading 或样本跨度 <1s 为 null
  fileName: string | null
  installerPath: string | null // 仅 state==='downloaded' 非空
  error: string | null // 仅 failed 非空，中文
}

export interface StreamFetchResponse {
  ok: boolean
  status: number
  totalBytes: number | null
  consume(onChunk: (chunk: Uint8Array) => void): Promise<void>
  cancel(): void
}
export type StreamFetch = (url: string) => Promise<StreamFetchResponse>

export interface SinkLike {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
}

export interface UpdateDownloaderFs {
  mkdir(dir: string, opts: { recursive: true }): Promise<void>
  readdir(dir: string): Promise<string[]>
  rm(path: string, opts: { force: true }): Promise<void>
  rename(from: string, to: string): Promise<void>
  stat(path: string): Promise<{ mtimeMs: number }>
  createSink(path: string): Promise<SinkLike>
}

const MB = 1_048_576
const STALL_TIMEOUT_MS = 30_000
const STALL_CHECK_MS = 5_000
const SPEED_WINDOW_MS = 3_000
const SPEED_MIN_SPAN_MS = 1_000
const PROGRESS_MIN_INTERVAL_MS = 200
const STALL_ERROR = '下载停滞（30 秒无数据），请重试'

const fmtMB = (bytes: number): string => `${(bytes / MB).toFixed(1)} MB`

/** 文件名黑名单：空段 / 路径分隔符 / 上跳段 / 控制字符（解码后可能引入 %2F 形态的斜杠，须对解码值再验一遍） */
function invalidFileName(name: string): boolean {
  return name === '' || name.includes('/') || name.includes('\\') || name.includes('..') || /[\x00-\x1f\x7f]/.test(name)
}

/** 文件名取初始 URL 尾段并解码；扩展名按平台强校验（win32 .exe / darwin .dmg，大小写不敏感） */
function deriveFileName(url: string, platform: string): { ok: true; name: string } | { ok: false; raw: string } {
  let raw = url
  try {
    raw = new URL(url).pathname.split('/').pop() ?? ''
  } catch {
    // URL 本身不合法：以整串当 raw 报文件名异常
  }
  if (invalidFileName(raw)) return { ok: false, raw }
  let name: string
  try {
    name = decodeURIComponent(raw)
  } catch {
    return { ok: false, raw }
  }
  if (invalidFileName(name)) return { ok: false, raw }
  const lower = name.toLowerCase()
  if (platform === 'win32' && !lower.endsWith('.exe')) return { ok: false, raw }
  if (platform === 'darwin' && !lower.endsWith('.dmg')) return { ok: false, raw }
  return { ok: true, name }
}

export function createUpdateDownloader(deps: {
  fetchStream: StreamFetch
  fs: UpdateDownloaderFs
  dir: string
  platform: string
  now?: () => number
  schedule?: (fn: () => void, ms: number) => () => void
  onProgress?: (snap: UpdateDownloadSnapshot) => void
}): {
  start(url: string): Promise<{ ok: true; data: UpdateDownloadSnapshot } | { ok: false; error: string }>
  cancel(): UpdateDownloadSnapshot
  status(): UpdateDownloadSnapshot
} {
  const now = deps.now ?? Date.now
  // 默认schedule=setTimeout 包装，测试注入假时钟/假定时器
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number): (() => void) => {
      const t = setTimeout(fn, ms)
      return () => clearTimeout(t)
    })

  let state: UpdateDownloadSnapshot['state'] = 'idle'
  let receivedBytes = 0
  let totalBytes: number | null = null
  let fileName: string | null = null
  let installerPath: string | null = null
  let error: string | null = null
  let completedUrl: string | null = null // state==='downloaded' 时的来源 URL，同 URL 幂等复用
  // 会话代次：新会话开启、cancel、终态落定均自增；旧协程跨 await 后凭 gen 失效，不再写状态/磁盘
  let generation = 0
  let res: StreamFetchResponse | null = null
  let sink: SinkLike | null = null
  let partPath: string | null = null
  let lastProgressAt = 0
  let samples: Array<{ t: number; b: number }> = []
  let stopStallTimer: (() => void) | null = null
  // 停滞分支已触过 res.cancel 的标记：真实流会随 cancel reject，由 consume catch 凭此把文案判成停滞而非网络中断
  let stallAbortMessage: string | null = null
  let lastPushedAt = Number.NEGATIVE_INFINITY
  let lastPushedReceived = 0
  let lastPushedTotal: number | null = null

  const computeSpeed = (): number | null => {
    if (state !== 'downloading' || samples.length < 2) return null
    const cutoff = now() - SPEED_WINDOW_MS
    while (samples.length > 0 && samples[0].t < cutoff) samples.shift()
    if (samples.length < 2) return null
    const first = samples[0]
    const last = samples[samples.length - 1]
    const spanMs = last.t - first.t
    if (spanMs < SPEED_MIN_SPAN_MS) return null
    return (last.b - first.b) / (spanMs / 1000)
  }

  const snapshot = (): UpdateDownloadSnapshot => ({
    state,
    receivedBytes,
    totalBytes,
    speedBps: computeSpeed(),
    fileName,
    installerPath,
    error
  })

  // 节流：≥200ms、进度百分比跳变 ≥1%、或总字节数从未知变已知（首知 Content-Length 也是新信息）才推；终态走 emit(true) 绕过
  const emit = (force: boolean): void => {
    if (!force) {
      const elapsed = now() - lastPushedAt
      const totalChanged = totalBytes !== lastPushedTotal
      const jumped =
        totalBytes !== null &&
        totalBytes > 0 &&
        lastPushedTotal !== null &&
        lastPushedTotal === totalBytes &&
        (receivedBytes - lastPushedReceived) / totalBytes >= 0.01
      if (elapsed < PROGRESS_MIN_INTERVAL_MS && !jumped && !totalChanged) return
    }
    lastPushedAt = now()
    lastPushedReceived = receivedBytes
    lastPushedTotal = totalBytes
    deps.onProgress?.(snapshot())
  }

  const disarmStallTimer = (): void => {
    if (stopStallTimer !== null) {
      stopStallTimer()
      stopStallTimer = null
    }
  }

  /** 捕获并断开 sink/res/.part 引用：并发清理（cancel/停滞/consume 收口）只留一份本地引用，不会重复关删 */
  const detachDisk = (): { s: SinkLike | null; p: string | null } => {
    const s = sink
    const p = partPath
    sink = null
    res = null
    partPath = null
    return { s, p }
  }

  /** 尽力关 sink 删 .part；close 期间会话失效则不再删盘（同路径可能已被新会话接管） */
  const cleanupPart = async (gen: number): Promise<void> => {
    const { s, p } = detachDisk()
    if (s !== null) await s.close().catch(() => {})
    if (p !== null && gen === generation) await deps.fs.rm(p, { force: true }).catch(() => {})
  }

  const toFailed = (message: string): { ok: false; error: string } => {
    generation++ // 终态落定即作废本会话代次，残余协程（stall 回调/consume 链）不得再写状态
    state = 'failed'
    error = message
    installerPath = null
    completedUrl = null
    disarmStallTimer()
    emit(true)
    return { ok: false, error: message }
  }

  /** 会话已失效（cancel 回 idle / 停滞已判 failed / 新会话接管）：只回报当前快照，不再产生副作用 */
  const staleReturn = (): { ok: true; data: UpdateDownloadSnapshot } | { ok: false; error: string } => {
    const snap = snapshot()
    return snap.state === 'failed' ? { ok: false, error: snap.error ?? STALL_ERROR } : { ok: true, data: snap }
  }

  /** 清理 .part 与 sink 后落 failed；清理期间被 cancel 则保持 idle，不覆写 */
  const cleanupAndFail = async (
    gen: number,
    message: string
  ): Promise<{ ok: true; data: UpdateDownloadSnapshot } | { ok: false; error: string }> => {
    await cleanupPart(gen)
    if (gen !== generation) return staleReturn()
    return toFailed(message)
  }

  const armStallTimer = (gen: number): void => {
    disarmStallTimer()
    stopStallTimer = schedule(() => {
      if (gen !== generation || state !== 'downloading') return
      if (now() - lastProgressAt > STALL_TIMEOUT_MS) {
        // 禁整体超时（大文件慢速合法），只按「无字节进展」判停滞
        stallAbortMessage = STALL_ERROR
        try {
          res?.cancel()
        } catch {
          // cancel 自身异常吞掉，清理状态优先
        }
        // 真实流随 cancel 以 reject 收尾：由 consume catch 统一清理落败（文案取 stallAbortMessage）；
        // 流不 reject 的形态走本兜底。rm 前查 partPath 接管：close 在途期间会话可能已落终态且
        // 新会话重建了同路径 .part（start 同步赋 partPath），此时删除会误杀新会话的活跃文件
        const { s, p } = detachDisk()
        void (async () => {
          if (s !== null) await s.close().catch(() => {})
          if (p !== null && partPath !== p) await deps.fs.rm(p, { force: true }).catch(() => {})
          // 清理 await 期间会话可能已被 consume catch 落 failed 或被 cancel 回 idle：gen 校验保证终态只落一次
          if (gen !== generation) return
          toFailed(STALL_ERROR)
        })()
        return
      }
      armStallTimer(gen)
    }, STALL_CHECK_MS)
  }

  async function start(url: string): Promise<{ ok: true; data: UpdateDownloadSnapshot } | { ok: false; error: string }> {
    if (state === 'downloading') return { ok: true, data: snapshot() }
    if (state === 'downloaded' && url === completedUrl) return { ok: true, data: snapshot() }

    const derived = deriveFileName(url, deps.platform)
    if (!derived.ok) {
      // 文件名校验先于一切磁盘动作：不开流、不建 .part、状态零变化
      return { ok: false, error: `安装包文件名异常：${derived.raw}` }
    }
    const name = derived.name
    const targetPath = join(deps.dir, name)
    const gen = ++generation

    state = 'downloading'
    fileName = name
    receivedBytes = 0
    totalBytes = null
    installerPath = null
    error = null
    completedUrl = null
    stallAbortMessage = null // 上个会话的停滞标记不带入本会话
    samples = [{ t: now(), b: 0 }]
    lastProgressAt = now()
    lastPushedAt = Number.NEGATIVE_INFINITY
    lastPushedReceived = 0
    lastPushedTotal = null
    emit(true) // 首帧：进 downloading 即告知 UI

    // 下载前清理：建目录 → 清全部 .part → 旧安装包只留 mtime 最新一个（目标同名留给 rename 覆盖）
    try {
      await deps.fs.mkdir(deps.dir, { recursive: true })
      const names = await deps.fs.readdir(deps.dir).catch(() => [] as string[])
      for (const n of names) {
        if (n.toLowerCase().endsWith('.part')) await deps.fs.rm(join(deps.dir, n), { force: true })
      }
      const olds: Array<{ name: string; mtimeMs: number }> = []
      for (const n of names) {
        if (n === name || n.toLowerCase().endsWith('.part')) continue
        const st = await deps.fs.stat(join(deps.dir, n)).catch(() => null)
        olds.push({ name: n, mtimeMs: st?.mtimeMs ?? Number.NEGATIVE_INFINITY })
      }
      if (olds.length > 1) {
        const newest = olds.reduce((a, b) => (b.mtimeMs > a.mtimeMs ? b : a))
        for (const o of olds) {
          if (o !== newest) await deps.fs.rm(join(deps.dir, o.name), { force: true })
        }
      }
    } catch (err) {
      if (gen !== generation) return staleReturn() // 清理期间被 cancel，不落 failed
      return toFailed(`磁盘写入失败：${err instanceof Error ? err.message : String(err)}`)
    }

    let response: StreamFetchResponse
    try {
      response = await deps.fetchStream(url)
    } catch {
      // 握手期被 cancel 后迟到的 reject 不落 failed（当前已是 idle/新会话）
      if (gen !== generation) return staleReturn()
      return toFailed('网络连接中断，下载失败')
    }
    if (gen !== generation) {
      // 握手期被取消/被新会话接管：响应不消费，断流防连接泄漏
      try {
        response.cancel()
      } catch {
        // 断流失败只能放任：会话已不归本协程
      }
      return staleReturn()
    }
    if (!response.ok || response.status < 200 || response.status >= 300) {
      return toFailed(`下载失败（HTTP ${response.status}）`)
    }
    res = response
    totalBytes = response.totalBytes
    let openedSink: SinkLike
    try {
      partPath = `${targetPath}.part`
      openedSink = await deps.fs.createSink(partPath)
    } catch (err) {
      if (gen !== generation) return staleReturn() // partPath 已被接管方清理/改写，不再碰
      partPath = null
      return toFailed(`磁盘写入失败：${err instanceof Error ? err.message : String(err)}`)
    }
    if (gen !== generation) {
      // 建文件期间被取消/接管：不接手 sink，只关自己开的句柄（.part 留给下次启动前清扫）
      void openedSink.close().catch(() => {})
      return staleReturn()
    }
    sink = openedSink
    lastProgressAt = now()

    // consume 的 onChunk 是同步签名：写盘按 promise 链串行，错误记下流末统一判；
    // 写链放行时须重验会话代次——cancel 前已排队的旧 chunk 放行时可能已易主新 sink，不得写入
    let writeError: unknown = null
    let writeTail: Promise<void> = Promise.resolve()
    armStallTimer(gen)
    try {
      await response.consume((chunk) => {
        if (gen !== generation) return // 失效会话迟到的 chunk：不计数不写盘
        receivedBytes += chunk.byteLength
        lastProgressAt = now()
        samples.push({ t: now(), b: receivedBytes })
        writeTail = writeTail
          .then(() => (gen === generation && sink !== null ? sink.write(chunk) : Promise.resolve()))
          .catch((err: unknown) => {
            writeError ??= err
          })
        emit(false)
      })
    } catch {
      // cancel（idle）与停滞（failed）都已使 gen 失效并清理过，只回报当前终态；
      // 停滞触发的 cancel 也会以 reject 走到这：文案优先取停滞标记（真实生产时序）
      if (gen !== generation) return staleReturn()
      return cleanupAndFail(gen, stallAbortMessage ?? '网络连接中断，下载失败')
    }
    if (gen !== generation) {
      // fake 流 cancel 后不 reject 的兜底：流虽结束但会话易主，不落 downloaded
      try {
        response.cancel()
      } catch {
        // 同上：断流失败放任
      }
      return staleReturn()
    }

    disarmStallTimer()
    await writeTail
    if (gen !== generation) return staleReturn()
    if (writeError !== null) {
      return cleanupAndFail(gen, `磁盘写入失败：${writeError instanceof Error ? writeError.message : String(writeError)}`)
    }

    if (receivedBytes === 0) {
      return cleanupAndFail(gen, '下载内容为空')
    }
    if (totalBytes !== null && totalBytes !== receivedBytes) {
      return cleanupAndFail(gen, `下载不完整（应为 ${fmtMB(totalBytes)}，实收 ${fmtMB(receivedBytes)}），请重试`)
    }

    try {
      await sink!.close()
      if (gen !== generation) return staleReturn() // close 期间被 cancel
      await deps.fs.rename(partPath!, targetPath)
    } catch (err) {
      return cleanupAndFail(gen, `磁盘写入失败：${err instanceof Error ? err.message : String(err)}`)
    }
    if (gen !== generation) return staleReturn() // rename 期间被 cancel：保持 idle
    sink = null
    partPath = null
    installerPath = targetPath
    state = 'downloaded'
    completedUrl = url
    generation++ // 终态落定，本会话代次作废
    emit(true)
    return { ok: true, data: snapshot() }
  }

  function cancel(): UpdateDownloadSnapshot {
    if (state !== 'downloading') return snapshot()
    generation++ // 在途会话的所有协程立即失效（含握手期：迟到的 settle 由 gen 校验丢弃）
    try {
      res?.cancel()
    } catch {
      // 状态优先：cancel 异常不阻断回 idle
    }
    // 清理走本地捕获：cleanupPart 带 gen 校验，cancel 已自增代次不能再复用
    const { s, p } = detachDisk()
    if (s !== null) void s.close().catch(() => {})
    if (p !== null) void deps.fs.rm(p, { force: true }).catch(() => {})
    state = 'idle'
    receivedBytes = 0
    totalBytes = null
    fileName = null
    installerPath = null
    error = null
    completedUrl = null
    samples = []
    disarmStallTimer()
    emit(true)
    return snapshot()
  }

  return { start, cancel, status: snapshot }
}

/** 启动清扫：删目录内全部 *.part（幂等，目录不存在静默返回） */
export async function sweepUpdateCache(fs: Pick<UpdateDownloaderFs, 'readdir' | 'rm'>, dir: string): Promise<void> {
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return
  }
  for (const n of names) {
    if (n.toLowerCase().endsWith('.part')) await fs.rm(join(dir, n), { force: true })
  }
}
