/** 番茄统计：完成日志是唯一事实源（今日数/累计数/每条待办数都由它派生）。backend 属主。 */

export interface PomodoroEntry {
  ts: number
  /** 完成日 YYYY-MM-DD（本地时区），今日统计按它比对 */
  dateKey: string
  todoId: string | null
}

export interface PomodoroLog {
  v: 1
  entries: PomodoroEntry[]
}

export const MAX_LOG_ENTRIES = 2000

export function emptyLog(): PomodoroLog {
  return { v: 1, entries: [] }
}

/** 追加并按 ts 保留最新 MAX 条（时间乱序时也按 ts 排序裁剪） */
export function appendEntry(log: PomodoroLog, entry: PomodoroEntry): PomodoroLog {
  const entries = [...log.entries, entry]
  entries.sort((a, b) => a.ts - b.ts)
  return { v: 1, entries: entries.slice(-MAX_LOG_ENTRIES) }
}

/** 宽松解析：坏条目丢弃；结构不对返回 null（调用方保持现态） */
export function parsePomodoroLog(raw: unknown): PomodoroLog | null {
  if (typeof raw !== 'object' || raw === null) return null
  const entries = (raw as { entries?: unknown }).entries
  if (!Array.isArray(entries)) return null
  const out: PomodoroEntry[] = []
  for (const it of entries) {
    if (typeof it !== 'object' || it === null) continue
    const r = it as Record<string, unknown>
    if (typeof r.ts !== 'number' || !Number.isFinite(r.ts)) continue
    if (typeof r.dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.dateKey)) continue
    out.push({ ts: r.ts, dateKey: r.dateKey, todoId: typeof r.todoId === 'string' && r.todoId !== '' ? r.todoId : null })
  }
  return { v: 1, entries: out.slice(-MAX_LOG_ENTRIES) }
}

export function todayCount(log: PomodoroLog, today: string): number {
  return log.entries.reduce((n, e) => (e.dateKey === today ? n + 1 : n), 0)
}

export function totalCount(log: PomodoroLog): number {
  return log.entries.length
}

export function todoCounts(log: PomodoroLog): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of log.entries) {
    if (e.todoId !== null) out[e.todoId] = (out[e.todoId] ?? 0) + 1
  }
  return out
}

/** 落盘自愈校验：同 ts 且同 todoId 的条目仍在（跨写并发可能整文件被旧快照覆盖） */
export function logContains(log: PomodoroLog, entry: PomodoroEntry): boolean {
  return log.entries.some((e) => e.ts === entry.ts && e.todoId === entry.todoId)
}
