// ECMAScript Date 可表示范围为 epoch 起 ±8.64e15 ms，超界 new Date 得 Invalid Date，
// formatDate 会产出 'NaN-NaN-NaN …' 串，故 tsToDate 超界返回 null 交调用方提示
const MAX_DATE_MS = 8.64e15

export function tsToDate(ts: number, unit: 's' | 'ms'): Date | null {
  const ms = unit === 's' ? ts * 1000 : ts
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return null
  return new Date(ms)
}

export function dateToTs(d: Date): { s: number; ms: number } {
  const ms = d.getTime()
  return { s: Math.floor(ms / 1000), ms }
}

// 本地时区可读格式，避免 toISOString 的 UTC 偏移干扰
export function formatDate(d: Date): string {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  )
}
