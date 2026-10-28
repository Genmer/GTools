// 纯文本查找：朴素 indexOf 循环 O(n)，不依赖 JSON 可解析——非法/宽松文本也能搜（定位兜底）。
import { posToLineCol } from './json'

export interface SearchMatch {
  start: number
  end: number
  /** 命中首字符所在行（1 起） */
  line: number
}

export interface FindResult {
  matches: SearchMatch[]
  /** 命中数超过上限被截断：只标前 MAX_MATCHES 个，搜索条展示 n+ 防 DOM 爆炸 */
  truncated: boolean
}

export const MAX_MATCHES = 10_000

export function findMatches(text: string, keyword: string, caseSensitive = false): FindResult {
  if (keyword === '') return { matches: [], truncated: false }
  const hay = caseSensitive ? text : text.toLowerCase()
  const needle = caseSensitive ? keyword : keyword.toLowerCase()
  const matches: SearchMatch[] = []
  let from = 0
  while (matches.length < MAX_MATCHES) {
    const idx = hay.indexOf(needle, from)
    if (idx === -1) break
    matches.push({ start: idx, end: idx + needle.length, line: posToLineCol(text, idx).line })
    from = idx + needle.length
  }
  const truncated = matches.length === MAX_MATCHES && hay.indexOf(needle, from) !== -1
  return { matches, truncated }
}
