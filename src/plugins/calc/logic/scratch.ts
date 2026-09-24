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
}

export interface ScratchResult {
  lines: ScratchLine[]
  vars: ReadonlyMap<string, number>
  /** 最后一个成功求值行的结果（同步写入 ans） */
  last: number | null
}

// 行首 ident = 且不是 ==（a==b 走表达式报错，不误判为赋值）
const ASSIGN_RE = /^([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*)\s*=(?!=)/

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
    try {
      const v = evaluateExpression(expr, vars)
      if (varName !== undefined) vars.set(varName, v)
      vars.set('ans', v)
      last = v
      lines.push({ raw, kind: 'ok', varName, value: v, display: varName !== undefined ? `${varName} = ${formatDisplay(v)}` : `= ${formatDisplay(v)}` })
    } catch (e) {
      lines.push({ raw, kind: 'error', display: errMsg(e) })
    }
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
