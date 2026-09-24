import { pinyin } from 'pinyin-pro'
import type { ManualEntry } from '../data/types'

// 与 launcher/match 同构的插件内实现（规约禁止 import 宿主 core，算法语义保持一致）
export interface IndexedText {
  lower: string
  syllables: string[]
  initials: string
}

const indexCache = new Map<string, IndexedText>()

export function indexText(text: string): IndexedText {
  const hit = indexCache.get(text)
  if (hit) return hit
  // nonZh:'consecutive' 保留英文单词整体（如 grep），中文逐字出音节
  const syllables = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' }) as string[]
  const initials = (pinyin(text, { pattern: 'first', toneType: 'none', type: 'array' }) as string[]).join('')
  const indexed: IndexedText = { lower: text.toLowerCase(), syllables, initials: initials.toLowerCase() }
  indexCache.set(text, indexed)
  return indexed
}

// 评分层级：名字面 < 关键字字面 < 拼音 < 摘要子串（越小越靠前）
const TIER = {
  nameExact: 0,
  namePrefix: 100,
  nameSubstr: 200,
  kwExact: 300,
  kwPrefix: 340,
  kwSubstr: 380,
  pinyinSyllable: 500,
  pinyinInitial: 600,
  summarySubstr: 700
} as const

/** query 能否从 startIdx 音节起贪心对齐（完整消耗或终止于音节内部前缀，如 chakan ⊆ cha+kan） */
function syllableAligned(query: string, syllables: string[], startIdx: number): boolean {
  let cur = query
  for (let i = startIdx; i < syllables.length; i++) {
    const syl = syllables[i]
    if (syl.startsWith(cur)) return true
    if (!cur.startsWith(syl)) return false
    cur = cur.slice(syl.length)
    if (cur === '') return true
  }
  return false
}

function subsequenceSpan(query: string, target: string): { first: number; span: number } | null {
  let qi = 0
  let first = -1
  let last = -1
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      if (first === -1) first = ti
      last = ti
      qi++
    }
  }
  return qi === query.length ? { first, span: last - first } : null
}

function literalScore(q: string, lower: string, base: { exact: number; prefix: number; substr: number }): number | null {
  const pos = lower.indexOf(q)
  if (pos < 0) return null
  if (pos === 0) return lower === q ? base.exact : base.prefix
  return base.substr + pos
}

function pinyinScore(q: string, idx: IndexedText): number | null {
  for (let s = 0; s < idx.syllables.length; s++) {
    if (idx.syllables[s][0] === q[0] && syllableAligned(q, idx.syllables, s)) {
      return TIER.pinyinSyllable + s * 10
    }
  }
  const span = subsequenceSpan(q, idx.initials)
  if (span) return TIER.pinyinInitial + span.first * 10 + span.span
  return null
}

export function scoreEntry(q: string, entry: ManualEntry): number | null {
  const nameIdx = indexText(entry.name)
  const nameLit = literalScore(q, nameIdx.lower, {
    exact: TIER.nameExact,
    prefix: TIER.namePrefix,
    substr: TIER.nameSubstr
  })
  if (nameLit !== null) return nameLit

  let best: number | null = null
  for (const kw of entry.keywords) {
    const lit = literalScore(q, indexText(kw).lower, {
      exact: TIER.kwExact,
      prefix: TIER.kwPrefix,
      substr: TIER.kwSubstr
    })
    if (lit !== null && (best === null || lit < best)) best = lit
  }
  if (best !== null) return best

  const namePy = pinyinScore(q, nameIdx)
  if (namePy !== null) return namePy
  for (const kw of entry.keywords) {
    const s = pinyinScore(q, indexText(kw))
    if (s !== null && (best === null || s < best)) best = s
  }
  if (best !== null) return best

  const sumLit = literalScore(q, indexText(entry.summary).lower, {
    exact: TIER.summarySubstr,
    prefix: TIER.summarySubstr,
    substr: TIER.summarySubstr
  })
  return sumLit
}

export interface ScoredEntry {
  entry: ManualEntry
  score: number
}

/** 空查询原样返回（保持数据策展顺序）；非空按评分→名长→字典序 */
export function searchEntries(query: string, entries: readonly ManualEntry[]): ScoredEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return entries.map((entry) => ({ entry, score: 0 }))
  const scored: ScoredEntry[] = []
  for (const entry of entries) {
    const s = scoreEntry(q, entry)
    if (s !== null) scored.push({ entry, score: s })
  }
  return scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.entry.name.length - b.entry.name.length ||
      a.entry.name.localeCompare(b.entry.name, 'zh-Hans-CN')
  )
}
