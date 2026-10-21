// 稿纸引擎：多行文本逐行求值（变量赋值/引用/ans/注释）+ 历史条目的构造与容错反序列化

import { CalcError, evaluateExpression, formatDisplay, normalizeExpr } from './parser'

export interface ScratchLine {
  /** 原始行文本（未归一化） */
  raw: string
  kind: 'skip' | 'ok' | 'error'
  /** 赋值行的变量名 */
  varName?: string
  /** ok 行的数值结果 */
  value?: number
  /** 展示文本：ok 行 "= 3" / "a = 3"，error 行为原因 */
  display: string
  /** 数字列表行的数字个数（单个千分位数识别成功时为 1）；表达式 ok 行为 undefined */
  listCount?: number
}

export interface ScratchResult {
  lines: ScratchLine[]
  vars: ReadonlyMap<string, number>
  /** 最后一个成功求值行的结果（同步写入 ans） */
  last: number | null
}

// 行首 ident = 且不是 ==（a==b 走表达式报错，不误判为赋值）
const ASSIGN_RE = /^([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)\s*=(?!=)/

// 数字列表行的分隔符：全角逗号/顿号/分号/全角空格永不做千分位；半角逗号在数字内部可能被千分位合并吸收
const LIST_SEPARATORS = new Set([' ', '\t', '\r', '，', '、', ';', '；', '　'])
const PUNCT_SEPARATORS = new Set([',', '，', '、', ';', '；'])

interface ListScan {
  nums: number[]
  mergedComma: boolean
  sawSeparator: boolean
}

function isDigitCh(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

// 单遍扫描：分隔符切分、负号须紧贴数字、千分位合并（mergeThousands=false 时半角逗号一律当分隔符）；遇非数字非分隔符字符返回 null
function scanNumbers(s: string, mergeThousands: boolean): ListScan | null {
  const nums: number[] = []
  let mergedComma = false
  let sawSeparator = false
  let i = 0
  while (i < s.length) {
    let punctCount = 0
    while (i < s.length && (LIST_SEPARATORS.has(s[i]) || s[i] === ',')) {
      if (PUNCT_SEPARATORS.has(s[i])) punctCount++
      sawSeparator = true
      i++
    }
    if (punctCount > 1) return null
    if (i >= s.length) break
    const start = i
    if (s[i] === '-') i++
    if (isDigitCh(s[i])) {
      i++
      for (;;) {
        if (isDigitCh(s[i])) {
          i++
        } else if (
          s[i] === ',' && mergeThousands &&
          isDigitCh(s[i + 1]) && isDigitCh(s[i + 2]) && isDigitCh(s[i + 3]) && !isDigitCh(s[i + 4])
        ) {
          i += 4
          mergedComma = true
        } else {
          break
        }
      }
    } else if (s[i] !== '.') {
      // 字母/运算符/括号/% 等任何非数字非分隔符字符都说明不是数字列表行
      return null
    }
    // 允许 '1.' 与 '.5'（与 parser NUM_RE 口径一致）；纯 '.' 会因 Number 非有限被拒
    if (s[i] === '.') {
      i++
      while (isDigitCh(s[i])) i++
    }
    // 科学计数：[+-]?数字串凑齐才消费，凑不齐则 'e' 留给主循环判非法
    if (s[i] === 'e' || s[i] === 'E') {
      let j = i + 1
      if (s[j] === '+' || s[j] === '-') j++
      if (isDigitCh(s[j])) {
        while (isDigitCh(s[j])) j++
        i = j
      }
    }
    const v = Number(s.slice(start, i).replace(/,/g, ''))
    // '9e999' 等溢出值返回 null，交回表达式路径报「溢出」
    if (!Number.isFinite(v)) return null
    nums.push(v)
    // 数字 token 之间必须有分隔符：'1.5.5'/'5-3' 这类粘连形态不是列表行
    if (i < s.length && !LIST_SEPARATORS.has(s[i]) && s[i] !== ',') return null
  }
  return { nums, mergedComma, sawSeparator }
}

// 数字列表行判定：≥2 个数求和；单个千分位数原值；不中返回 null
export function tryNumberList(line: string): { value: number; count: number } | null {
  // 前导/尾随空白不算分隔符（'a= 737,452' 剥离赋值号后残留空格），否则误触发降级重扫；非空白前导分隔符（'，737,452'）仍按设计触发
  const s = line.trim()
  const first = scanNumbers(s, true)
  if (first === null) return null
  if (first.nums.length >= 2) return { value: sumOf(first.nums), count: first.nums.length }
  if (first.nums.length === 1 && first.mergedComma && !first.sawSeparator) return { value: first.nums[0], count: 1 }
  if (first.nums.length === 1 && first.sawSeparator) {
    // 千分位数带悬挂分隔符（如 '737,452,'）时，半角逗号降级为分隔符重扫
    const second = scanNumbers(s, false)
    if (second !== null && second.nums.length >= 2) return { value: sumOf(second.nums), count: second.nums.length }
  }
  return null
}

function sumOf(nums: number[]): number {
  return nums.reduce((acc, n) => acc + n, 0)
}

// 内置常量（参考图 2651*pi）；可被赋值行覆盖
export const BUILTIN_CONSTANTS: Readonly<Record<string, number>> = { pi: Math.PI, e: Math.E }

function errMsg(e: unknown): string {
  return e instanceof CalcError ? e.message : '无法计算'
}

/**
 * 顺序逐行求值：空行与 // # 注释行跳过；错误行只标记自身、不中断后续行；
 * ans 始终等于上一个成功求值行的结果。
 */
export function evaluateScratch(text: string): ScratchResult {
  const vars = new Map<string, number>(Object.entries(BUILTIN_CONSTANTS))
  const lines: ScratchLine[] = []
  let last: number | null = null
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = normalizeExpr(raw).trim()
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) {
      lines.push({ raw, kind: 'skip', display: '' })
      continue
    }
    const am = ASSIGN_RE.exec(trimmed)
    const varName = am !== null ? am[1] : undefined
    const expr = am !== null ? trimmed.slice(am[0].length) : trimmed
    const list = tryNumberList(expr)
    let v: number
    if (list !== null) {
      v = list.value
    } else {
      try {
        v = evaluateExpression(expr, vars)
      } catch (e) {
        lines.push({ raw, kind: 'error', display: errMsg(e) })
        continue
      }
    }
    if (varName !== undefined) vars.set(varName, v)
    vars.set('ans', v)
    last = v
    lines.push({ raw, kind: 'ok', varName, value: v, listCount: list?.count, display: varName !== undefined ? `${varName} = ${formatDisplay(v)}` : `= ${formatDisplay(v)}` })
  }
  return { lines, vars, last }
}

export interface HistoryEntry {
  id: string
  ts: number
  text: string
  title: string
}

export const HISTORY_LIMIT = 50

/** storage 里的历史数据可能损坏或为旧格式，逐条校验、坏条目跳过 */
export function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return []
  const out: HistoryEntry[] = []
  for (const item of raw.slice(0, HISTORY_LIMIT)) {
    if (typeof item !== 'object' || item === null) continue
    const { id, ts, text, title } = item as Record<string, unknown>
    if (typeof id !== 'string' || id === '' || typeof ts !== 'number' || !Number.isFinite(ts) || typeof text !== 'string' || typeof title !== 'string') continue
    out.push({ id, ts, text, title })
  }
  return out
}

export function makeHistoryEntry(text: string, now = Date.now()): HistoryEntry {
  const first = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('//') && !l.startsWith('#'))
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now,
    text,
    title: (first ?? '').slice(0, 30) || '（空）'
  }
}
