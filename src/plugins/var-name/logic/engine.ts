// 风格引擎（纯函数）：分词 + 各风格渲染 + 缩写词大小写策略 + 候选生成 + 布尔/函数前缀提示。

import type { InitialismPolicy, LanguagePreset, StyleId } from '../data/presets'
import {
  BOOL_MARKER_EN,
  BOOL_MARKER_ZH,
  BOOL_PREFIXES,
  FUNC_VERB_PAIRS,
  FUNC_VERB_ZH
} from '../data/presets'

export interface NamingCandidate {
  contextId: string
  label: string
  value: string
  note?: string
}

// ---- 分词 ----

const STOPWORDS = new Set(['the', 'a', 'of', 'for'])

/** 驼峰拆分 + 分隔符切分 + 小写化 + 停用词过滤；只处理英文形态输入（中文走 lookup 取词链） */
export function tokenize(input: string): string[] {
  const cleaned = input.replace(/['’](s|t|re|ve|ll|d)\b/gi, '') // 去缩写后缀（user's → user）
  const parts = cleaned
    .split(/[\s._\-+/\\|:;,!?()[\]{}"'’`]+/)
    .flatMap((seg) =>
      seg
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // fooBar → foo Bar
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // HTTPServer → HTTP Server
        .split(' ')
    )
  const out: string[] = []
  for (const p of parts) {
    const w = p.toLowerCase()
    if (w !== '' && !STOPWORDS.has(w)) out.push(w)
  }
  return out
}

// ---- 缩写词大小写策略（同词不同果的跨语言硬差异）----

const INITIALISMS = new Set([
  'id', 'url', 'uri', 'uuid', 'db', 'api', 'http', 'https', 'xml', 'json', 'html', 'css', 'sql',
  'io', 'os', 'ip', 'tcp', 'udp', 'dns', 'cdn', 'ui', 'ux', 'jwt', 'svg', 'png', 'pdf', 'cpu',
  'gpu', 'ram', 'ascii', 'utf'
])

// C# 把 id/db 当闭合复合词（Id 非 ID），与两字母缩写全大写规则分开
const CS_CLOSED_COMPOUNDS = new Set(['id', 'db'])
// Swift：通用度高的缩写统一升/降格（URL / uuid 界面内小写）
const SWIFT_UPPER = new Set(['url', 'uri', 'uuid', 'http', 'https', 'json', 'xml', 'html', 'db', 'sql', 'id', 'api', 'ip', 'tcp', 'io'])

function shapeWord(word: string, capFirst: boolean, policy: InitialismPolicy): string {
  const isInitialism = INITIALISMS.has(word)
  if (isInitialism) {
    if (policy === 'go') return capFirst ? word.toUpperCase() : word
    if (policy === 'swift' && SWIFT_UPPER.has(word)) return capFirst ? word.toUpperCase() : word
    if (policy === 'csharp' && !CS_CLOSED_COMPOUNDS.has(word)) {
      if (word.length <= 2) return capFirst ? word.toUpperCase() : word
      return capFirst ? word[0].toUpperCase() + word.slice(1) : word
    }
  }
  return capFirst ? word[0].toUpperCase() + word.slice(1) : word
}

function joinWords(words: readonly string[], style: StyleId, policy: InitialismPolicy): string {
  const lower = (w: string): string => shapeWord(w, false, policy)
  const cap = (w: string): string => shapeWord(w, true, policy)
  switch (style) {
    case 'camel':
      return words.map((w, i) => (i === 0 ? lower(w) : cap(w))).join('')
    case 'pascal':
      return words.map(cap).join('')
    case 'snake':
      return words.map(lower).join('_')
    case 'screaming':
      return words.map((w) => w.toUpperCase()).join('_')
    case 'kebab':
      return words.map(lower).join('-')
    case 'kCamel':
      return `k${words.map(cap).join('')}`
    case 'lower':
      return words.map((w) => w).join('')
  }
}

/** 词组 → 指定风格标识符（prefix/suffix 由调用方拼接，见 generate/prefixHints） */
export function applyStyle(words: readonly string[], style: StyleId, policy: InitialismPolicy): string {
  if (words.length === 0) return ''
  return joinWords(words, style, policy)
}

// ---- 候选生成 ----

export function generate(words: readonly string[], preset: LanguagePreset): NamingCandidate[] {
  if (words.length === 0) return []
  return preset.contexts.map((rule) => ({
    contextId: rule.id,
    label: rule.label,
    value: `${rule.prefix ?? ''}${applyStyle(words, rule.style, preset.initialism)}${rule.suffix ?? ''}`,
    note: rule.note
  }))
}

// ---- 布尔 / 函数惯用前缀提示（docs/research/abbreviations.md Part 4）----

function pickRuleStyle(preset: LanguagePreset, ids: readonly string[]): StyleId {
  for (const id of ids) {
    const r = preset.contexts.find((c) => c.id === id)
    if (r) return r.style
  }
  return preset.contexts[0]?.style ?? 'camel'
}

function looksBoolean(query: string, words: readonly string[]): boolean {
  if (BOOL_MARKER_ZH.some((m) => query.includes(m))) return true
  return words.some((w) => (BOOL_MARKER_EN as readonly string[]).includes(w))
}

/** 布尔量：is/has/can/should 前缀建议；前缀入词链保证各风格大小写正确，已带前缀时换成其他前缀 */
export function boolHints(query: string, words: readonly string[], preset: LanguagePreset): NamingCandidate[] {
  if (words.length === 0 || !looksBoolean(query, words)) return []
  const style = pickRuleStyle(preset, ['variable', 'param', 'local', 'bool', 'constant'])
  const head = words[0]
  const headIsPrefix = (BOOL_PREFIXES as readonly string[]).includes(head)
  const tail = headIsPrefix ? words.slice(1) : words
  const out: NamingCandidate[] = []
  for (const p of BOOL_PREFIXES) {
    if (p === head) continue
    out.push({
      contextId: 'hint-bool',
      label: headIsPrefix ? `布尔前缀改 ${p}` : `布尔前缀 ${p}`,
      value: applyStyle([p, ...tail], style, preset.initialism)
    })
  }
  return out
}

function funcStyle(preset: LanguagePreset): StyleId {
  return pickRuleStyle(preset, ['function', 'method', 'predicate'])
}

/** 函数动词：中文动词命中 → 惯用英文动词前缀；已用动词给出配对提示（A2） */
export function functionHints(query: string, words: readonly string[], preset: LanguagePreset): NamingCandidate[] {
  if (words.length === 0) return []
  const style = funcStyle(preset)
  const out: NamingCandidate[] = []
  const head = words[0]
  const pair = FUNC_VERB_PAIRS[head]
  if (pair !== undefined) {
    out.push({
      contextId: 'hint-func',
      label: '动词配对',
      value: applyStyle([pair, ...words.slice(1)], style, preset.initialism),
      note: `${head} 的惯用配对是 ${pair}`
    })
  }
  for (const [zh, verbs] of Object.entries(FUNC_VERB_ZH)) {
    if (!query.includes(zh)) continue
    for (const verb of verbs) {
      if (verb === head) continue
      out.push({
        contextId: 'hint-func',
        label: `函数动词 ${verb}`,
        value: applyStyle([verb, ...words], style, preset.initialism),
        note: `「${zh}」的惯用动词`
      })
    }
  }
  // 同值去重（多动词/配对可能撞形）
  const seen = new Set<string>()
  return out.filter((c) => (seen.has(c.value) ? false : (seen.add(c.value), true)))
}
