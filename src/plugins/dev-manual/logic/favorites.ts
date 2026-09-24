import type { ManualEntry } from '../data/types'

export const FAVORITES_KEY = 'favorites'

export interface StoredFavorites {
  v: 1
  ids: string[]
}

/** 存储侧只信结构：数组、元素为非空字符串、去重保序 */
export function normalizeFavorites(raw: unknown): string[] {
  if (typeof raw !== 'object' || raw === null) return []
  const ids = (raw as Partial<StoredFavorites>).ids
  if (!Array.isArray(ids)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string' || id === '' || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function toggleFavorite(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]
}

/** 收藏视图条目：按收藏先后顺序；数据演进后已删除的 id 静默过滤 */
export function favoriteEntries(ids: readonly string[], byId: ReadonlyMap<string, ManualEntry>): ManualEntry[] {
  const out: ManualEntry[] = []
  for (const id of ids) {
    const e = byId.get(id)
    if (e) out.push(e)
  }
  return out
}
