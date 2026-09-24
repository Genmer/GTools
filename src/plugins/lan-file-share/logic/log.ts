/** 传输日志环形缓冲（纯逻辑）：新条目追加尾部，超容量丢最旧 */

import type { LogKind, TransferLogEntry } from '../shared'

const KINDS: readonly LogKind[] = ['start', 'stop', 'connect', 'upload', 'download', 'zip', 'error']

export function pushLog(entries: readonly TransferLogEntry[], e: TransferLogEntry, cap: number): TransferLogEntry[] {
  const next = entries.length >= cap ? entries.slice(entries.length - cap + 1) : [...entries]
  next.push(e)
  return next
}

/** 容错解析持久化数据：逐条校验，坏条目剔除，超容量截尾保留最新 */
export function parseLog(raw: unknown, cap: number): TransferLogEntry[] {
  if (!Array.isArray(raw)) return []
  const out: TransferLogEntry[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const e = item as Partial<TransferLogEntry>
    if (typeof e.t !== 'number' || !Number.isFinite(e.t)) continue
    if (!KINDS.includes(e.kind as LogKind)) continue
    if (typeof e.device !== 'string') continue
    const entry: TransferLogEntry = { t: e.t, kind: e.kind as LogKind, device: e.device }
    if (typeof e.name === 'string') entry.name = e.name
    if (typeof e.size === 'number' && Number.isFinite(e.size)) entry.size = e.size
    if (typeof e.detail === 'string') entry.detail = e.detail
    out.push(entry)
  }
  return out.length > cap ? out.slice(out.length - cap) : out
}
