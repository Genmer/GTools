// 历史 / 收藏 / 偏好（纯逻辑，storage 读写由 index.vue 经 host.storage 承接）。
// 容量淘汰与同 q 去重思路同 clipboard-history（DESIGN C.7）。

import { ALL_PRESETS } from '../data/presets'

export interface HistoryEntry {
  q: string
  words: string[]
  at: number
}

export interface FavoriteEntry {
  id: string
  q: string
  words: string[]
  note?: string
  at: number
}

export type VarNameTab = 'main' | 'history' | 'favorites'

export interface VarNamePrefs {
  langId: string
  useAbbreviations: boolean
  tab: VarNameTab
}

export const HISTORY_KEY = 'history'
export const FAVORITES_KEY = 'favorites'
export const PREFS_KEY = 'prefs'
export const HISTORY_LIMIT = 100

export const DEFAULT_PREFS: VarNamePrefs = { langId: 'generic', useAbbreviations: false, tab: 'main' }

export function makeFavId(now = Date.now(), rand = Math.random()): string {
  return `${now.toString(36)}-${rand.toString(36).slice(2, 8)}`
}

function normalizeWords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((w): w is string => typeof w === 'string' && /^[a-z0-9]+$/.test(w) && w !== '')
}

export function normalizeHistoryEntry(raw: unknown): HistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Partial<HistoryEntry>
  if (typeof e.q !== 'string' || e.q.trim() === '') return null
  const words = normalizeWords(e.words)
  if (words.length === 0) return null
  return { q: e.q, words, at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0 }
}

export function normalizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: HistoryEntry[] = []
  for (const item of raw) {
    const e = normalizeHistoryEntry(item)
    if (e) out.push(e)
  }
  return out.slice(0, HISTORY_LIMIT)
}

/** 同 q 去重只更新时间并置顶，超容量淘汰最旧 */
export function addHistory(list: readonly HistoryEntry[], q: string, words: readonly string[], now = Date.now()): HistoryEntry[] {
  const trimmed = q.trim()
  if (trimmed === '' || words.length === 0) return [...list]
  const rest = list.filter((e) => e.q !== trimmed)
  return [{ q: trimmed, words: [...words], at: now }, ...rest].slice(0, HISTORY_LIMIT)
}

export function removeHistory(list: readonly HistoryEntry[], q: string): HistoryEntry[] {
  return list.filter((e) => e.q !== q)
}

export function normalizeFavoriteEntry(raw: unknown): FavoriteEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const e = raw as Partial<FavoriteEntry>
  if (typeof e.id !== 'string' || e.id === '') return null
  if (typeof e.q !== 'string' || e.q.trim() === '') return null
  const words = normalizeWords(e.words)
  if (words.length === 0) return null
  return {
    id: e.id,
    q: e.q,
    words,
    note: typeof e.note === 'string' && e.note !== '' ? e.note : undefined,
    at: typeof e.at === 'number' && Number.isFinite(e.at) ? e.at : 0
  }
}

export function normalizeFavorites(raw: unknown): FavoriteEntry[] {
  if (!Array.isArray(raw)) return []
  const out: FavoriteEntry[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const e = normalizeFavoriteEntry(item)
    if (e === null || seen.has(e.id)) continue
    seen.add(e.id)
    out.push(e)
  }
  return out
}

export function addFavorite(
  list: readonly FavoriteEntry[],
  q: string,
  words: readonly string[],
  note: string | undefined,
  now = Date.now(),
  id = makeFavId(now)
): FavoriteEntry[] {
  return [{ id, q: q.trim(), words: [...words], note: note !== undefined && note !== '' ? note : undefined, at: now }, ...list]
}

export function removeFavorite(list: readonly FavoriteEntry[], id: string): FavoriteEntry[] {
  return list.filter((e) => e.id !== id)
}

export function updateFavoriteNote(list: readonly FavoriteEntry[], id: string, note: string): FavoriteEntry[] {
  return list.map((e) => (e.id === id ? { ...e, note: note.trim() === '' ? undefined : note.trim() } : e))
}

export function normalizePrefs(raw: unknown): VarNamePrefs {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<VarNamePrefs>
  const langId =
    typeof p.langId === 'string' && ALL_PRESETS.some((preset) => preset.id === p.langId) ? p.langId : DEFAULT_PREFS.langId
  const tab = p.tab === 'history' || p.tab === 'favorites' ? p.tab : 'main'
  return { langId, useAbbreviations: p.useAbbreviations === true, tab }
}
