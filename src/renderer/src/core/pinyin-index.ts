import { pinyin } from 'pinyin-pro'
import { matchEntry, type PinyinIndexed, type SearchEntry } from './matcher'

const cache = new Map<string, PinyinIndexed>()

/** 对 title 预计算拼音索引（多音字取默认读音，已知限制）；同 title 复用缓存 */
export function pinyinIndex(title: string): PinyinIndexed {
  const hit = cache.get(title)
  if (hit) return hit
  // nonZh:'consecutive' 让英文单词整体保留（如 'json'），避免逐字母拆散音节对齐
  const syllables = pinyin(title, {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive'
  }) as string[]
  const initials = (pinyin(title, { pattern: 'first', toneType: 'none', type: 'array' }) as string[]).join('')
  const indexed: PinyinIndexed = { lower: title.toLowerCase(), syllables, initials: initials.toLowerCase() }
  cache.set(title, indexed)
  return indexed
}

/** 对词条的 title + 额外 keywords 全部建索引，匹配取最小分 */
export function matchEntryBest(query: string, entry: SearchEntry): number | null {
  const titles = [entry.title, ...(entry.keywords ?? [])]
  let best: number | null = null
  for (const t of titles) {
    const score = matchEntry(query, entry, pinyinIndex(t))
    if (score !== null && (best === null || score < best)) best = score
  }
  return best
}
