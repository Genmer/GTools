// 宿主内联计算器纯逻辑：手写 tokenizer + 递归下降，禁 eval/new Function（CSP 红线）
// 运算：+ - * / %（取模）^ 括号、一元负号、小数；非法输入一律返回 null 不抛

const MAX_LEN = 100
const DECIMALS = 10

class CalcError extends Error {}

type Token = { type: 'num'; value: number } | { type: 'op'; value: string } | { type: 'lp' } | { type: 'rp' }

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t') {
      i++
      continue
    }
    if ((c >= '0' && c <= '9') || c === '.') {
      let j = i
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++
      const text = src.slice(i, j)
      // '1.2.3' 之类多小数点直接判非法
      if ((text.match(/\./g) ?? []).length > 1) throw new CalcError('bad number')
      const value = Number(text)
      if (!Number.isFinite(value)) throw new CalcError('bad number')
      tokens.push({ type: 'num', value })
      i = j
      continue
    }
    if ('+-*/%^'.includes(c)) {
      tokens.push({ type: 'op', value: c })
      i++
      continue
    }
    if (c === '(') {
      tokens.push({ type: 'lp' })
      i++
      continue
    }
    if (c === ')') {
      tokens.push({ type: 'rp' })
      i++
      continue
    }
    throw new CalcError('bad char')
  }
  return tokens
}

/** expr := term (('+'|'-') term)*；term := unary (('*'|'/'|'%') unary)*；unary := '-' unary | power；
 *  power := primary ('^' unary)?（右结合，指数可带负号）；-2^2 按惯例解析为 -(2^2) */
function parse(tokens: Token[]): number {
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const next = (): Token | undefined => tokens[pos++]

  const primary = (): number => {
    const t = next()
    if (t?.type === 'num') return t.value
    if (t?.type === 'lp') {
      const v = expr()
      if (next()?.type !== 'rp') throw new CalcError('unbalanced parens')
      return v
    }
    throw new CalcError('unexpected token')
  }
  const power = (): number => {
    const base = primary()
    const t = peek()
    if (t?.type === 'op' && t.value === '^') {
      next()
      return Math.pow(base, unary())
    }
    return base
  }
  const unary = (): number => {
    const t = peek()
    if (t?.type === 'op' && t.value === '-') {
      next()
      return -unary()
    }
    return power()
  }
  const term = (): number => {
    let left = unary()
    for (;;) {
      const t = peek()
      if (t?.type === 'op' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        next()
        const right = unary()
        if ((t.value === '/' || t.value === '%') && right === 0) throw new CalcError('divide by zero')
        left = t.value === '*' ? left * right : t.value === '/' ? left / right : left % right
      } else {
        return left
      }
    }
  }
  const expr = (): number => {
    let left = term()
    for (;;) {
      const t = peek()
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        next()
        const right = term()
        left = t.value === '+' ? left + right : left - right
      } else {
        return left
      }
    }
  }

  const v = expr()
  if (pos !== tokens.length) throw new CalcError('trailing tokens')
  return v
}

/** 整数直出（无千分位分隔）；小数至多 10 位并去尾零。非法形态回退原串兜底 */
function format(v: number): string {
  if (Number.isInteger(v)) return String(v)
  const trimmed = v.toFixed(DECIMALS).replace(/0+$/, '').replace(/\.$/, '')
  const n = Number(trimmed)
  return Number.isFinite(n) ? String(n) : trimmed
}

/** 合法算式返回结果文本，否则 null（trim 空/超长/除零/非法字符/结构残缺均 null，不抛） */
export function calc(query: string): string | null {
  const q = query.trim()
  if (q === '' || q.length > MAX_LEN) return null
  let value: number
  try {
    value = parse(tokenize(q))
  } catch {
    return null
  }
  if (!Number.isFinite(value)) return null
  return format(value)
}
