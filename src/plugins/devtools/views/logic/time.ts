export function tsToDate(ts: number, unit: 's' | 'ms'): Date {
  return new Date(unit === 's' ? ts * 1000 : ts)
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
