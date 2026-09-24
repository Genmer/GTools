import { pinyin } from 'pinyin-pro'
import { hostOf } from './open-url'
import type { SiteEntry } from './sites'

// 与外壳 core/matcher、launcher/match 同构的插件内实现（插件规约禁止 import 宿主 core）
export interface SiteIndexed {
  lower: string
  syllables: string[]
  initials: string
}

const RULE_BASE = { literal: 0, syllable: 10_000, initial: 20_000 }
const indexCache = new Map<string, SiteIndexed>()

export function indexText(text: string): SiteIndexed {
  const hit = indexCache.get(text)
  if (hit) return hit
  // nonZh:'consecutive' 让英文单词整体保留（如 GitHub），避免逐字母拆散音节对齐
  const syllables = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' }) as string[]
  const initials = (pinyin(text, { pattern: 'first', toneType: 'none', type: 'array', nonZh: 'consecutive' }) as string[]).join('')
  const indexed: SiteIndexed = { lower: text.toLowerCase(), syllables, initials: initials.toLowerCase() }
  indexCache.set(text, indexed)
  return indexed
}

/** query 能否从 startIdx 音节起贪心对齐（完整消耗或终止于音节内部前缀，如 bai ⊆ bai+du） */
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

/** 单段文本匹配评分（越小越靠前）：原文子串 < 全拼音节对齐 < 首字母子序列；空查询恒 0 分 */
export function matchText(query: string, idx: SiteIndexed): number | null {
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

/** 站点匹配：对 名称/别名/host 各算取最优分 */
export function matchSite(query: string, site: SiteEntry): number | null {
  const q = query.trim().toLowerCase()
  if (q === '') return 0
  const host = hostOf(site.url).replace(/^www\./, '')
  let best: number | null = null
  for (const text of [site.name, ...(site.aliases ?? []), host]) {
    const s = matchText(q, indexText(text))
    if (s !== null && (best === null || s < best)) best = s
  }
  return best
}

/** 过滤并排序；空查询按库原序（内置分类序 + 自定义追加序）返回 */
export function filterSites(query: string, sites: SiteEntry[]): { site: SiteEntry; score: number }[] {
  const q = query.trim().toLowerCase()
  if (q === '') return sites.map((site) => ({ site, score: 0 }))
  const scored: { site: SiteEntry; score: number }[] = []
  for (const site of sites) {
    const s = matchSite(q, site)
    if (s !== null) scored.push({ site, score: s })
  }
  return scored.sort(
    (a, b) => a.score - b.score || a.site.name.length - b.site.name.length || a.site.name.localeCompare(b.site.name, 'zh-Hans-CN')
  )
}

/** 「缩写 关键词」直达：首词精确命中（别名/名称/全拼首字母/host）且唯一；否则强匹配（原文/音节级）唯一也可锁定 */
export function resolvePin(query: string, sites: SiteEntry[]): { site: SiteEntry; term: string } | null {
  const tokens = query.trim().split(/\s+/)
  if (tokens.length < 2) return null
  const head = tokens[0].toLowerCase()
  const exact: SiteEntry[] = []
  const strong: SiteEntry[] = []
  for (const site of sites) {
    if (pinKeys(site).includes(head)) {
      exact.push(site)
      continue
    }
    // 强匹配 = 原文/音节级（分值 < 首字母档），避免 'gh' 这类松散首字母子序列劫持
    const s = matchSite(head, site)
    if (s !== null && s < RULE_BASE.initial) strong.push(site)
  }
  const hit = exact.length === 1 ? exact[0] : exact.length === 0 && strong.length === 1 ? strong[0] : null
  if (hit === null) return null
  return { site: hit, term: tokens.slice(1).join(' ') }
}

/** 一站可被首词精确锁定的全部键（全小写）：别名、名称、拼音首字母、host（含去 www 形态） */
export function pinKeys(site: SiteEntry): string[] {
  const keys = new Set<string>()
  for (const a of site.aliases ?? []) keys.add(a.toLowerCase())
  keys.add(site.name.toLowerCase())
  keys.add(indexText(site.name).initials)
  const host = hostOf(site.url)
  if (host !== '') {
    keys.add(host)
    keys.add(host.replace(/^www\./, ''))
  }
  return [...keys]
}
