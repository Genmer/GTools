import type { HotItem } from './types'

function norm(v: string): string {
  return v.trim().toLowerCase()
}

/** 关注词命中：标题（大小写不敏感）包含任一非空关注词 */
export function matchesWatch(title: string, keywords: readonly string[]): boolean {
  const t = norm(title)
  return keywords.some((k) => {
    const kw = norm(k)
    return kw !== '' && t.includes(kw)
  })
}

export interface FilterOptions {
  /** 外壳搜索框 keyword 后的剩余输入，按标题子串过滤 */
  query: string
  watchOnly: boolean
  watchKeywords: readonly string[]
}

export function filterItems(items: readonly HotItem[], opts: FilterOptions): HotItem[] {
  const q = norm(opts.query)
  return items.filter((i) => {
    if (q !== '' && !norm(i.title).includes(q)) return false
    if (opts.watchOnly && opts.watchKeywords.length > 0 && !matchesWatch(i.title, opts.watchKeywords)) return false
    return true
  })
}
