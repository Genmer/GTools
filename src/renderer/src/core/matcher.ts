export interface SearchEntry {
  key: string
  title: string
  subtitle?: string
  icon: string
  pluginId?: string
  commandId?: string
  keywords?: string[]
  kind?: 'plugin' | 'app'
  appId?: string
}

export interface PinyinIndexed {
  lower: string
  /** 去全部空白的小写原文，供「英文/拼音+中文」无空格混排 query 的字面路（缓存键仍为原 title） */
  compact: string
  syllables: string[]
  initials: string
}

const RULE_BASE = { literal: 0, syllable: 10_000, initial: 20_000 }

/** query 是否能从 startIdx 音节起贪心对齐（完整消耗或终止于某音节内部前缀） */
function syllableAligned(query: string, syllables: string[], startIdx: number): boolean {
  let cur = query
  for (let i = startIdx; i < syllables.length; i++) {
    const syl = syllables[i]
    if (syl.startsWith(cur)) return true // query 结束在音节内部（如 geshih ⊆ ge+shi+hua）
    if (!cur.startsWith(syl)) return false
    cur = cur.slice(syl.length)
    if (cur === '') return true
  }
  return false
}

/** 子序列匹配：返回首命中下标与跨度，供评分；不命中返回 null */
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

/**
 * 四路模糊匹配：原文子串 < 全拼音节对齐 < 首字母子序列，返回评分（越小越靠前）。
 * 多音字取默认读音（pinyin-index 预索引），纯函数可单测。
 */
export function matchEntry(query: string, _e: SearchEntry, idx: PinyinIndexed): number | null {
  const q = query.trim().toLowerCase()
  if (q === '') return 0

  // 1. 原文子串（含中文子串），命中位置越靠前分越低
  const pos = idx.lower.indexOf(q)
  if (pos >= 0) {
    return RULE_BASE.literal + pos * 10 + (pos === 0 ? 0 : 500)
  }

  // 1.5 去空白字面：query 去空白后命中 compact（如 json格式化 ⊆ "JSON 格式化"）。
  // min 钳到 syllable-100：分值域 [2000, 9900] 与长尾 literal 有重叠（同属弱字面档，可接受），
  // 但恒低于 syllable 带，DESIGN §2.4 的 syllable < initial 关系不翻转
  const qc = q.replace(/\s+/g, '')
  if (qc !== '') {
    const pos2 = idx.compact.indexOf(qc)
    if (pos2 >= 0) {
      return Math.min(RULE_BASE.syllable - 100, RULE_BASE.literal + 2000 + pos2 * 10 + (pos2 === 0 ? 0 : 500))
    }
  }

  // 2. 全拼音节串，起点对齐音节边界
  for (let s = 0; s < idx.syllables.length; s++) {
    if (idx.syllables[s][0] === q[0] && syllableAligned(q, idx.syllables, s)) {
      return RULE_BASE.syllable + s * 10
    }
  }

  // 3. 首字母串子序列（连续或非连续）
  const span = subsequenceSpan(q, idx.initials)
  if (span) {
    return RULE_BASE.initial + span.first * 10 + span.span
  }
  return null
}

export function sortMatches<T extends { score: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.score - b.score)
}
