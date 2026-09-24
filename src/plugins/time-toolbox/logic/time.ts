/** 时间戳百宝箱纯函数层：秒/毫秒识别、时区换算、相对时间与本地墙上时间互转（无状态，供单测） */

export type TsUnit = 's' | 'ms'

export interface ParsedTs {
  /** 归一成毫秒的时间戳 */
  ts: number
  /** 输入原本的单位（用于「识别为秒/毫秒」提示） */
  unit: TsUnit
}

/** ECMAScript Date 可表示的最大毫秒（±1e8 天） */
const MAX_MS = 8_640_000_000_000_000

// 12 位及以上按毫秒：12 位毫秒≈1973~2001 合理，12 位秒≈公元 3 万年不现实
export function parseTimestamp(input: string): ParsedTs | null {
  const s = input.trim()
  if (!/^-?\d+$/.test(s)) return null
  const n = Number(s)
  if (!Number.isSafeInteger(n)) return null
  const isMs = s.replace('-', '').length >= 12
  const ms = isMs ? n : n * 1000
  if (ms > MAX_MS || ms < -MAX_MS) return null
  return { ts: ms, unit: isMs ? 'ms' : 's' }
}

export interface WallParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export interface ZonedParts extends WallParts {
  weekday: string
}

const WEEKDAY_ZH: Record<string, string> = {
  Sun: '周日',
  Mon: '周一',
  Tue: '周二',
  Wed: '周三',
  Thu: '周四',
  Fri: '周五',
  Sat: '周六'
}

// Intl.DateTimeFormat 构造贵，按时区缓存（每秒刷新 × 5 时区场景）
const fmtCache = new Map<string, Intl.DateTimeFormat>()

function zonedFormatter(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? '(local)'
  let f = fmtCache.get(key)
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short'
    })
    fmtCache.set(key, f)
  }
  return f
}

/** 某时区的墙上时间（weekday 已转中文）；timeZone 省略 = 本机时区 */
export function zonedParts(ms: number, timeZone?: string): ZonedParts {
  const parts = zonedFormatter(timeZone).formatToParts(ms)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  const wd = get('weekday')
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_ZH[wd] ?? wd
  }
}

const p2 = (n: number): string => String(n).padStart(2, '0')

export function formatZoned(ms: number, timeZone?: string, withSeconds = true): string {
  const z = zonedParts(ms, timeZone)
  const time = withSeconds ? `${p2(z.hour)}:${p2(z.minute)}:${p2(z.second)}` : `${p2(z.hour)}:${p2(z.minute)}`
  return `${z.year}-${p2(z.month)}-${p2(z.day)} ${time}`
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 时区偏移（东经为正，分钟）：墙上时间当 UTC 与真实 epoch 求差，单次往返即正确 */
export function zoneOffsetMinutes(ms: number, timeZone: string): number {
  const z = zonedParts(ms, timeZone)
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000)
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+'
  const abs = Math.abs(minutes)
  return `${sign}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`
}

export interface ZoneDef {
  id: string
  label: string
}

export const DEFAULT_ZONES: readonly ZoneDef[] = [
  { id: 'Asia/Shanghai', label: '北京' },
  { id: 'Asia/Tokyo', label: '东京' },
  { id: 'Europe/London', label: '伦敦' },
  { id: 'America/New_York', label: '纽约' },
  { id: 'Australia/Sydney', label: '悉尼' }
]

export interface ZoneRow {
  id: string
  label: string
  date: string
  time: string
  weekday: string
  /** UTC 偏移，如 +08:00 */
  offset: string
  /** 相对北京的小时差文案 */
  delta: string
}

export function zoneRows(ms: number, zones: readonly ZoneDef[] = DEFAULT_ZONES): ZoneRow[] {
  const base = zoneOffsetMinutes(ms, 'Asia/Shanghai')
  return zones.map((z) => {
    const p = zonedParts(ms, z.id)
    const off = zoneOffsetMinutes(ms, z.id)
    const diffH = (off - base) / 60
    return {
      id: z.id,
      label: z.label,
      date: `${p.year}-${p2(p.month)}-${p2(p.day)}`,
      time: `${p2(p.hour)}:${p2(p.minute)}:${p2(p.second)}`,
      weekday: p.weekday,
      offset: formatOffset(off),
      delta: diffH === 0 ? '同一时区' : `${diffH > 0 ? '+' : ''}${diffH} 小时`
    }
  })
}

const LOCAL_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/

/** 'YYYY-MM-DDTHH:mm[:ss]'（本机时区墙上时间）→ epoch 毫秒；日历非法（如 02-31）返回 null */
export function parseLocalDateTime(input: string): number | null {
  const m = LOCAL_RE.exec(input.trim())
  if (m === null) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = m[6] === undefined ? 0 : Number(m[6])
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  const chk = new Date(asUtc)
  if (chk.getUTCFullYear() !== year || chk.getUTCMonth() !== month - 1 || chk.getUTCDate() !== day) return null
  // getTimezoneOffset 西经为正（UTC−本地）；算两遍修正落在 DST 切点上的墙钟
  const pass1 = asUtc + new Date(asUtc).getTimezoneOffset() * 60_000
  return asUtc + new Date(pass1).getTimezoneOffset() * 60_000
}

/** epoch → datetime-local 输入框值 'YYYY-MM-DDTHH:mm'（本机时区墙上时间） */
export function toDatetimeLocalValue(ms: number): string {
  const z = zonedParts(ms)
  return `${z.year}-${p2(z.month)}-${p2(z.day)}T${p2(z.hour)}:${p2(z.minute)}`
}

export type RelUnit = 'minute' | 'hour' | 'day' | 'week'

export const REL_UNIT_MS: Readonly<Record<RelUnit, number>> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000
}

export function relativeMs(base: number, amount: number, unit: RelUnit, dir: 'ago' | 'later'): number {
  const sign = dir === 'ago' ? -1 : 1
  return base + sign * amount * REL_UNIT_MS[unit]
}

/** 人话距离：刚刚 / N 分钟(小时/天) 前|后；超过一年退化成本地日期（跨年场景） */
export function humanizeDistance(ms: number, now: number): string {
  const diff = ms - now
  const abs = Math.abs(diff)
  const suffix = diff >= 0 ? '后' : '前'
  if (abs < 10_000) return '刚刚'
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)} 分钟${suffix}`
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)} 小时${suffix}`
  if (abs < 365 * 86_400_000) return `${Math.floor(abs / 86_400_000)} 天${suffix}`
  return formatZoned(ms, undefined, false)
}

export interface TimeFormatRow {
  key: string
  label: string
  value: string
}

/** ① 当前时间卡片的多格式行（点击复制整个 value） */
export function nowFormats(ms: number): TimeFormatRow[] {
  return [
    { key: 'local', label: '本地时间', value: formatZoned(ms) },
    { key: 'utc', label: 'UTC 时间', value: formatZoned(ms, 'UTC') },
    { key: 'iso', label: 'ISO 8601', value: toIso(ms) },
    { key: 's', label: 'Unix 秒', value: String(Math.floor(ms / 1000)) },
    { key: 'ms', label: 'Unix 毫秒', value: String(ms) }
  ]
}

/** demo 模式冻结时刻：2026-01-01T00:00:00Z（截图与新手引导用稳定数据） */
export const DEMO_MS = Date.UTC(2026, 0, 1, 0, 0, 0)
