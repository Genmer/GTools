import { pinyin } from 'pinyin-pro'
import type { AppEntry } from './types'

// 与外壳 core/matcher 同构的插件内实现（插件规约禁止 import 宿主 core，算法复制保持一致语义）
export interface IndexedName {
  lower: string
  syllables: string[]
  initials: string
}

const RULE_BASE = { literal: 0, syllable: 10_000, initial: 20_000 }
const indexCache = new Map<string, IndexedName>()

export function indexName(name: string): IndexedName {
  const hit = indexCache.get(name)
  if (hit) return hit
  // nonZh:'consecutive' 让英文单词整体保留（如 Chrome），避免逐字母拆散音节对齐
  const syllables = pinyin(name, { toneType: 'none', type: 'array', nonZh: 'consecutive' }) as string[]
  const initials = (pinyin(name, { pattern: 'first', toneType: 'none', type: 'array' }) as string[]).join('')
  const indexed: IndexedName = { lower: name.toLowerCase(), syllables, initials: initials.toLowerCase() }
  indexCache.set(name, indexed)
  return indexed
}

/** query 能否从 startIdx 音节起贪心对齐（完整消耗或终止于音节内部前缀，如 geshi ⊆ ge+shi+hua） */
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

/** 应用名匹配评分（越小越靠前）：原文子串 < 全拼音节对齐 < 首字母子序列；空查询恒 0 分 */
export function matchName(query: string, idx: IndexedName): number | null {
  const q = query.trim().toLowerCase()
  if (q === '') return 0

  const pos = idx.lower.indexOf(q)
  if (pos >= 0) return RULE_BASE.literal + pos * 10 + (pos === 0 ? 0 : 500)

  for (let s = 0; s < idx.syllables.length; s++) {
    if (idx.syllables[s][0] === q[0] && syllableAligned(q, idx.syllables, s)) {
      return RULE_BASE.syllable + s * 10
    }
  }

  const span = subsequenceSpan(q, idx.initials)
  if (span) return RULE_BASE.initial + span.first * 10 + span.span
  return null
}

/** 过滤并排序；空查询原样返回（缓存已按名排序），非空按评分→名长→字典序 */
export function filterApps(query: string, apps: AppEntry[]): { app: AppEntry; score: number }[] {
  const q = query.trim().toLowerCase()
  if (q === '') return apps.map((app) => ({ app, score: 0 }))
  const scored: { app: AppEntry; score: number }[] = []
  for (const app of apps) {
    const s = matchName(q, indexName(app.name))
    if (s !== null) scored.push({ app, score: s })
  }
  return scored.sort(
    (a, b) => a.score - b.score || a.app.name.length - b.app.name.length || a.app.name.localeCompare(b.app.name, 'zh-Hans-CN')
  )
}
