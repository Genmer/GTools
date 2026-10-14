/** 应用日志环形缓冲：内存态、不落盘（排查用，重启即清）。纯逻辑无 electron 依赖，测试直接实例化 */

export type AppLogLevel = 'info' | 'warn' | 'error'
export type AppLogSource = 'main' | 'renderer'

export interface AppLogEntry {
  /** epoch ms */
  t: number
  level: AppLogLevel
  source: AppLogSource
  text: string
}

const MAX_TEXT = 2000

export function sanitizeAppLogText(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…` : v
}

export function isAppLogLevel(v: unknown): v is AppLogLevel {
  return v === 'info' || v === 'warn' || v === 'error'
}

export function isAppLogSource(v: unknown): v is AppLogSource {
  return v === 'main' || v === 'renderer'
}

/** 定容环形缓冲：超容丢最旧；entries() 返回时间升序快照（新条目在尾） */
export class AppLog {
  private readonly buf: AppLogEntry[] = []
  private seq = 0

  constructor(private readonly cap = 500) {}

  push(level: AppLogLevel, source: AppLogSource, text: string): void {
    const entry: AppLogEntry = { t: Date.now(), level, source, text: sanitizeAppLogText(text) }
    if (this.buf.length >= this.cap) this.buf.shift()
    this.buf.push(entry)
    this.seq++
  }

  /** 传 seq 只取增量（渲染层已拉过的跳过）；首次传 0 取全量 */
  entries(since = 0): { seq: number; items: AppLogEntry[] } {
    if (since >= this.seq) return { seq: this.seq, items: [] }
    // 环形丢弃后 seq 与 buf 不对齐：按丢弃数取交集头部
    const dropped = Math.max(0, this.seq - this.buf.length)
    const from = Math.max(since, dropped)
    return { seq: this.seq, items: this.buf.slice(from - dropped) }
  }

  clear(): void {
    this.buf.length = 0
  }
}
