/** 榜单条目（key 是快照对比『新上榜』判定的唯一依据） */
export interface HotItem {
  key: string
  title: string
  url: string
  heat?: number
  tag?: string
  isNew?: boolean
}

export interface BoardData {
  fetchedAt: number
  items: HotItem[]
}

export interface HotSearchCache {
  version: 1
  boards: Record<string, BoardData>
}

export interface HotSearchSettings {
  /** 关注词：只看关注模式下，标题含任一词即命中 */
  watchKeywords: string[]
  watchOnly: boolean
  /** 自动刷新间隔（分钟），0 = 关闭 */
  autoRefreshMin: number
}

export const AUTO_REFRESH_OPTIONS: readonly number[] = [0, 1, 3, 5, 10]
export const DEFAULT_SETTINGS: HotSearchSettings = {
  watchKeywords: [],
  watchOnly: false,
  autoRefreshMin: 5
}
export const MAX_WATCH_KEYWORDS = 50
/** 每平台持久化条数上限（各平台榜单本身 ≤ 50，防异常超长） */
export const MAX_ITEMS_PER_BOARD = 100

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function parseItem(v: unknown): HotItem | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  const key = asString(e.key)
  const title = asString(e.title)
  const url = asString(e.url)
  if (key === '' || title === '' || url === '') return null
  const heat = typeof e.heat === 'number' && Number.isFinite(e.heat) && e.heat >= 0 ? e.heat : undefined
  const tag = asString(e.tag) || undefined
  const isNew = e.isNew === true ? true : undefined
  return { key, title, url, ...(heat !== undefined ? { heat } : {}), ...(tag !== undefined ? { tag } : {}), ...(isNew !== undefined ? { isNew } : {}) }
}

/** 从 storage 读回设置：字段缺失/非法回落默认值，关注词去空去重限量 */
export function normalizeSettings(raw: unknown): HotSearchSettings {
  const src = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const keywords = Array.isArray(src.watchKeywords)
    ? src.watchKeywords.filter((k): k is string => typeof k === 'string' && k.trim() !== '').map((k) => k.trim()).slice(0, MAX_WATCH_KEYWORDS)
    : []
  const seen = new Set<string>()
  const watchKeywords = keywords.filter((k) => {
    const lower = k.toLowerCase()
    if (seen.has(lower)) return false
    seen.add(lower)
    return true
  })
  const autoRefreshMin =
    typeof src.autoRefreshMin === 'number' && AUTO_REFRESH_OPTIONS.includes(src.autoRefreshMin) ? src.autoRefreshMin : DEFAULT_SETTINGS.autoRefreshMin
  return { watchKeywords, watchOnly: src.watchOnly === true, autoRefreshMin }
}

function parseBoard(v: unknown): BoardData | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  if (typeof e.fetchedAt !== 'number' || !Number.isFinite(e.fetchedAt) || !Array.isArray(e.items)) return null
  const items = e.items.map(parseItem).filter((x): x is HotItem => x !== null)
  if (items.length === 0) return null
  return { fetchedAt: e.fetchedAt, items }
}

/** storage 读回的缓存可能是任意坏数据，逐层校验后返回（无可信榜单则 null，走首次拉取） */
export function parseCache(raw: unknown): HotSearchCache | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const e = raw as Record<string, unknown>
  if (e.version !== 1 || e.boards === null || typeof e.boards !== 'object' || Array.isArray(e.boards)) return null
  const boards: Record<string, BoardData> = {}
  for (const [id, v] of Object.entries(e.boards as Record<string, unknown>)) {
    const b = parseBoard(v)
    if (b !== null) boards[id] = b
  }
  return Object.keys(boards).length > 0 ? { version: 1, boards } : null
}

/** 写入 storage 前的封装：截断条数，避免异常接口撑爆存储 */
export function toCache(boards: Record<string, BoardData>): HotSearchCache {
  const out: Record<string, BoardData> = {}
  for (const [id, b] of Object.entries(boards)) {
    out[id] = { fetchedAt: b.fetchedAt, items: b.items.slice(0, MAX_ITEMS_PER_BOARD) }
  }
  return { version: 1, boards: out }
}
