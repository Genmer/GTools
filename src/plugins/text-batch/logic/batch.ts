// 文本批量处理纯逻辑：规则链顺序折叠，逐行/整列规则分流应用。
// 独立实现（插件两两禁止 import），不依赖 node/electron。

export type BatchRuleType =
  | 'replace'
  | 'regexReplace'
  | 'dedupe'
  | 'sort'
  | 'case'
  | 'trim'
  | 'wrap'
  | 'filter'

export type SortOrder = 'asc' | 'desc'
export type CaseMode = 'upper' | 'lower' | 'title'
export type FilterMode = 'include' | 'exclude' | 'regex'

export const RULE_TYPE_OPTIONS: readonly { type: BatchRuleType; label: string }[] = [
  { type: 'replace', label: '查找替换' },
  { type: 'regexReplace', label: '正则替换' },
  { type: 'dedupe', label: '按行去重' },
  { type: 'sort', label: '排序' },
  { type: 'case', label: '大小写' },
  { type: 'trim', label: 'Trim' },
  { type: 'wrap', label: '加前后缀' },
  { type: 'filter', label: '按行过滤' }
]

export type BatchRule =
  | { type: 'replace'; find: string; replaceWith: string }
  | { type: 'regexReplace'; regex: string; replaceWith: string }
  | { type: 'dedupe' }
  | { type: 'sort'; order: SortOrder }
  | { type: 'case'; mode: CaseMode }
  | { type: 'trim' }
  | { type: 'wrap'; prefix: string; suffix: string }
  | { type: 'filter'; mode: FilterMode; value: string }

/** 视图编辑态：全字段平铺便于表单双向绑定，应用前经 toRule 收敛成实际生效字段 */
export interface RuleDraft {
  uid: number
  type: BatchRuleType
  find: string
  replaceWith: string
  regex: string
  order: SortOrder
  caseMode: CaseMode
  prefix: string
  suffix: string
  filterMode: FilterMode
  filterValue: string
}

export function makeDraft(uid: number, type: BatchRuleType): RuleDraft {
  return {
    uid,
    type,
    find: '',
    replaceWith: '',
    regex: '',
    order: 'asc',
    caseMode: 'upper',
    prefix: '',
    suffix: '',
    filterMode: 'include',
    filterValue: ''
  }
}

export function toRule(d: RuleDraft): BatchRule {
  switch (d.type) {
    case 'replace':
      return { type: 'replace', find: d.find, replaceWith: d.replaceWith }
    case 'regexReplace':
      return { type: 'regexReplace', regex: d.regex, replaceWith: d.replaceWith }
    case 'dedupe':
      return { type: 'dedupe' }
    case 'sort':
      return { type: 'sort', order: d.order }
    case 'case':
      return { type: 'case', mode: d.caseMode }
    case 'trim':
      return { type: 'trim' }
    case 'wrap':
      return { type: 'wrap', prefix: d.prefix, suffix: d.suffix }
    case 'filter':
      return { type: 'filter', mode: d.filterMode, value: d.filterValue }
  }
}

function compileReplace(source: string): RegExp | null {
  if (source === '') return null
  try {
    return new RegExp(source, 'g')
  } catch {
    return null
  }
}

function compileMatch(source: string): RegExp | null {
  if (source === '') return null
  try {
    return new RegExp(source)
  } catch {
    return null
  }
}

/** title：小写化后每个「字母/数字词」首字符大写（词间以非文字字符分界） */
function applyCase(line: string, mode: CaseMode): string {
  if (mode === 'upper') return line.toUpperCase()
  if (mode === 'lower') return line.toLowerCase()
  let out = ''
  let cap = true
  for (const ch of line.toLowerCase()) {
    const isWord = /\p{L}|\p{N}/u.test(ch)
    out += isWord && cap ? ch.toUpperCase() : ch
    if (isWord) cap = false
    else cap = true
  }
  return out
}

/** 逐行规则：返回 null 表示此规则对该行不生效（保持原行），非法正则/空查找值由此整条跳过 */
function applyLineRule(line: string, rule: BatchRule): string | null {
  switch (rule.type) {
    case 'replace':
      // 空查找串会在每个位置插入，视为未配置
      if (rule.find === '') return null
      return line.split(rule.find).join(rule.replaceWith)
    case 'regexReplace': {
      const re = compileReplace(rule.regex)
      return re === null ? null : line.replace(re, rule.replaceWith)
    }
    case 'case':
      return applyCase(line, rule.mode)
    case 'trim':
      return line.trim()
    case 'wrap':
      return `${rule.prefix}${line}${rule.suffix}`
    default:
      return null
  }
}

/** 规则链顺序折叠：dedupe/sort/filter 作用于整列，其余逐行 */
export function chain(lines: string[], rules: readonly BatchRule[]): string[] {
  let cur = lines
  for (const rule of rules) {
    switch (rule.type) {
      case 'dedupe': {
        const seen = new Set<string>()
        cur = cur.filter((l) => {
          if (seen.has(l)) return false
          seen.add(l)
          return true
        })
        break
      }
      case 'sort': {
        // 码元比较保证跨环境确定性（localeCompare 受 ICU 影响不稳）
        const next = [...cur].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        cur = rule.order === 'desc' ? next.reverse() : next
        break
      }
      case 'filter': {
        if (rule.mode === 'regex') {
          const re = compileMatch(rule.value)
          if (re === null) break
          cur = cur.filter((l) => re.test(l))
          break
        }
        if (rule.value === '') break
        cur = cur.filter((l) => (rule.mode === 'include' ? l.includes(rule.value) : !l.includes(rule.value)))
        break
      }
      default:
        cur = cur.map((l) => {
          const next = applyLineRule(l, rule)
          return next === null ? l : next
        })
    }
  }
  return cur
}

/** 全文入口：按 \n 拆行折叠后拼回（末行空串保留，往返不丢结尾换行） */
export function runBatch(text: string, rules: readonly BatchRule[]): string {
  return chain(text.split('\n'), rules).join('\n')
}
