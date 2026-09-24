// 上传历史记录（纯逻辑）：新增置顶、容量淘汰、按 id 删除、脏数据归一化。

export interface HistoryEntry {
  id: string
  url: string
  deleteUrl?: string
  filename: string
  width?: number
  height?: number
  bytes?: number
  /** 缩略图 dataURL（小尺寸 jpeg），无则前端用占位 */
  thumb?: string
  uploadedAt: number
  providerId: string
}

export const HISTORY_STORAGE_KEY = 'history'
export const DEFAULT_HISTORY_LIMIT = 100

export function makeEntryId(now = Date.now(), rand = Math.random()): string {
  return `${now.toString(36)}-${rand.toString(36).slice(2, 8)}`
}

/** 单条脏数据 → 合法记录；缺 url / url 非 http(s) 一律丢弃返回 null */
export function normalizeHistoryEntry(raw: unknown): HistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Partial<HistoryEntry>
  if (typeof e.url !== 'string' || !/^https?:\/\//i.test(e.url)) return null
  const pos = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
  const entry: HistoryEntry = {
    id: typeof e.id === 'string' && e.id !== '' ? e.id : makeEntryId(),
    url: e.url,
    filename: typeof e.filename === 'string' && e.filename !== '' ? e.filename : 'image',
    uploadedAt: typeof e.uploadedAt === 'number' && Number.isFinite(e.uploadedAt) ? e.uploadedAt : 0,
    providerId: typeof e.providerId === 'string' && e.providerId !== '' ? e.providerId : 'unknown',
    deleteUrl: typeof e.deleteUrl === 'string' && e.deleteUrl !== '' ? e.deleteUrl : undefined,
    width: pos(e.width),
    height: pos(e.height),
    bytes: pos(e.bytes),
    thumb: typeof e.thumb === 'string' && e.thumb.startsWith('data:image/') ? e.thumb : undefined
  }
  return entry
}

export function normalizeHistory(raw: unknown, limit = DEFAULT_HISTORY_LIMIT): HistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: HistoryEntry[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const e = normalizeHistoryEntry(item)
    if (e === null) continue
    if (seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
    if (out.length >= limit) break
  }
  return out
}

/** 新记录按传入顺序置顶，超出容量淘汰最旧 */
export function addEntries(list: readonly HistoryEntry[], fresh: readonly HistoryEntry[], limit: number): HistoryEntry[] {
  const seen = new Set(list.map((e) => e.id))
  const merged: HistoryEntry[] = []
  for (const e of fresh) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    merged.push(e)
  }
  return [...merged, ...list].slice(0, limit)
}

export function removeEntry(list: readonly HistoryEntry[], id: string): HistoryEntry[] {
  return list.filter((e) => e.id !== id)
}
