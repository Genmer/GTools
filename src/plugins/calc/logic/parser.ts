// 表达式解析求值器：手写 lexer + 递归下降 + AST 求值，不使用 eval/new Function

export class CalcError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CalcError'
  }
}

export type CalcEnv = ReadonlyMap<string, number>

type Token =
  | { t: 'num'; v: number; pct: boolean }
  | { t: 'id'; name: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' }

type Node =
  | { k: 'num'; v: number }
  | { k: 'var'; name: string }
  | { k: 'call'; name: string; a: Node }
  | { k: 'pct'; v: number }
  | { k: 'neg'; a: Node }
  | { k: 'pos'; a: Node }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '%' | '^'; a: Node; b: Node }
  // a ± b% 的商用计算器语义：a ± a*b/100（pct 字面量单独出现时等于 b/100）
  | { k: 'addpct'; op: '+' | '-'; a: Node; r: number }

// 内置单参函数：log 取常用对数（log10），ln 自然对数；三角函数用弧度
const FUNCS: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  abs: Math.abs,
  log: Math.log10,
  ln: Math.log
}

const FULLWIDTH_MAP: Record<string, string> = {
  '＋': '+',
  '－': '-',
  '＊': '*',
  '／': '/',
  '％': '%',
  '＾': '^',
  '（': '(',
  '）': ')',
  '＝': '=',
  '×': '*',
  '÷': '/'
}

/** 全角运算符、全角数字与 ×÷ 归一为 ASCII，容错从别处粘贴的算式 */
export function normalizeExpr(src: string): string {
  return src.replace(/[＋－＊／％＾（）＝×÷０-９]/g, (ch) => {
    if (ch >= '０' && ch <= '９') return String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
    return FULLWIDTH_MAP[ch] ?? ch
  })
}

const NUM_RE = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/
const ID_RE = /^[A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff]*/
const OPS = '+-*/%^()'

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    const ch = rest[0]
    if (ch === ' ' || ch === '\t') {
      i += 1
      continue
    }
    if (ch === '*' && rest[1] === '*') {
      tokens.push({ t: 'op', v: '^' })
      i += 2
      continue
    }
    if (ch >= '0' && ch <= '9' || ch === '.') {
      const m = NUM_RE.exec(rest)
      if (m === null) throw new CalcError(`无法识别的数字：「${rest.slice(0, 12)}」`)
      i += m[0].length
      // 数字紧邻 % 才是百分号；隔了空格的 % 按取模运算符处理
      const pct = src[i] === '%'
      if (pct) i += 1
      tokens.push({ t: 'num', v: Number(m[0]), pct })
      continue
    }
    const idm = ID_RE.exec(rest)
    if (idm !== null) {
      tokens.push({ t: 'id', name: idm[0] })
      i += idm[0].length
      continue
    }
    if (OPS.includes(ch)) {
      tokens.push({ t: 'op', v: ch as '+' | '-' | '*' | '/' | '%' | '^' | '(' | ')' })
      i += 1
      continue
    }
    throw new CalcError(`无法识别的字符：「${ch}」`)
  }
  return tokens
}

class Parser {
  private pos = 0

  constructor(private readonly tokens: Token[]) {}

  parseFull(): Node {
    if (this.tokens.length === 0) throw new CalcError('表达式为空')
    const node = this.add()
    const rest = this.tokens[this.pos]
    if (rest !== undefined) {
      throw new CalcError(`多余的内容：「${rest.t === 'op' ? rest.v : rest.t === 'id' ? rest.name : rest.v}」`)
    }
    return node
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private eatOp<T extends string>(...ops: T[]): T | null {
    const t = this.peek()
    if (t !== undefined && t.t === 'op' && (ops as readonly string[]).includes(t.v)) {
      this.pos += 1
      return t.v as T
    }
    return null
  }

  private add(): Node {
    let a = this.mul()
    for (;;) {
      const op = this.eatOp('+', '-')
      if (op === null) return a
      const b = this.mul()
      a = b.k === 'pct' ? { k: 'addpct', op, a, r: b.v } : { k: 'bin', op, a, b }
    }
  }

  private mul(): Node {
    let a = this.unary()
    for (;;) {
      const op = this.eatOp('*', '/', '%')
      if (op === null) return a
      a = { k: 'bin', op, a, b: this.unary() }
    }
  }

  private unary(): Node {
    const op = this.eatOp('-', '+')
    if (op === '-') return { k: 'neg', a: this.unary() }
    if (op === '+') return { k: 'pos', a: this.unary() }
    return this.power()
  }

  private power(): Node {
    const a = this.primary()
    if (this.eatOp('^') !== null) {
      // 右结合（2^3^2=512）；右侧走 unary 以支持 2^-3，且 -2^2 = -(2^2)
      return { k: 'bin', op: '^', a, b: this.unary() }
    }
    return a
  }

  private primary(): Node {
    const t = this.peek()
    if (t === undefined) throw new CalcError('表达式不完整')
    if (t.t === 'num') {
      this.pos += 1
      return t.pct ? { k: 'pct', v: t.v } : { k: 'num', v: t.v }
    }
    if (t.t === 'id') {
      this.pos += 1
      // ident 紧跟 ( 视为函数调用；函数名大小写不敏感，与大小写敏感的变量互不干扰
      const nx = this.peek()
      if (nx !== undefined && nx.t === 'op' && nx.v === '(') {
        const name = t.name.toLowerCase()
        if (FUNCS[name] === undefined) throw new CalcError(`未知函数：${t.name}`)
        this.pos += 1
        const arg = this.add()
        if (this.eatOp(')') === null) throw new CalcError('括号未闭合')
        return { k: 'call', name, a: arg }
      }
      return { k: 'var', name: t.name }
    }
    if (t.v === '(') {
      this.pos += 1
      const node = this.add()
      if (this.eatOp(')') === null) throw new CalcError('括号未闭合')
      return node
    }
    throw new CalcError(`此处不应出现「${t.v}」`)
  }
}

function evalNode(n: Node, env: CalcEnv): number {
  switch (n.k) {
    case 'num':
      return n.v
    case 'pct':
      return n.v / 100
    case 'var': {
      const v = env.get(n.name)
      if (v === undefined) throw new CalcError(`未知变量：${n.name}`)
      return v
    }
    case 'call':
      return FUNCS[n.name](evalNode(n.a, env))
    case 'neg':
      return -evalNode(n.a, env)
    case 'pos':
      return evalNode(n.a, env)
    case 'addpct': {
      const a = evalNode(n.a, env)
      return n.op === '+' ? a + (a * n.r) / 100 : a - (a * n.r) / 100
    }
    case 'bin': {
      const a = evalNode(n.a, env)
      const b = evalNode(n.b, env)
      switch (n.op) {
        case '+':
          return a + b
        case '-':
          return a - b
        case '*':
          return a * b
        case '/':
          if (b === 0) throw new CalcError('除数为 0')
          return a / b
        case '%':
          if (b === 0) throw new CalcError('模数为 0')
          return a % b
        case '^':
          return Math.pow(a, b)
      }
    }
  }
}

/** 解析并求值；任何词法/语法/算术错误都以 CalcError 抛出 */
export function evaluateExpression(src: string, env: CalcEnv): number {
  const node = new Parser(tokenize(normalizeExpr(src))).parseFull()
  const v = evalNode(node, env)
  if (Number.isNaN(v)) throw new CalcError('结果不是有效数字')
  if (!Number.isFinite(v)) throw new CalcError('结果溢出')
  return v
}

/** 展示用数字格式：12 位有效数字截断浮点误差（0.1+0.2 → 0.3） */
export function formatNumber(v: number): string {
  if (Number.isNaN(v) || !Number.isFinite(v)) return String(v)
  if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v)
  return String(Number(v.toPrecision(12)))
}

/** 整数部分插千分位逗号（对齐 uTools 参考图 = 4,175,270）；科学计数与特殊值原样 */
export function groupThousands(s: string): string {
  if (/[eE]/.test(s) || s === 'NaN' || s === 'Infinity' || s === '-Infinity') return s
  const neg = s.startsWith('-')
  const body = neg ? s.slice(1) : s
  const dot = body.indexOf('.')
  const int = dot === -1 ? body : body.slice(0, dot)
  const frac = dot === -1 ? '' : body.slice(dot)
  return (neg ? '-' : '') + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + frac
}

/** 界面展示格式：formatNumber + 千分位；复制走 formatNumber 保持可粘贴 */
export function formatDisplay(v: number): string {
  return groupThousands(formatNumber(v))
}
