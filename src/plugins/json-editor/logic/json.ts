// JSON 解析与错误定位：自写递归下降而非复用 JSON.parse 的报错——
// 新版 V8 报错文本不再稳定携带 "at position N"，行列号只能自己算才跨版本可靠。

export interface JsonError {
  /** 人读原因（中文，不含位置信息） */
  message: string
  /** 出错字符下标（0 起） */
  offset: number
  /** 1 起行号 */
  line: number
  /** 1 起列号 */
  column: number
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: JsonError }
export type ReformatResult = { ok: true; text: string } | { ok: false; error: JsonError }

/** 防 JS 栈溢出的嵌套上限（对齐常见编辑器量级） */
const MAX_DEPTH = 512

/** offset → 行列号；\r\n 记作一次换行。纯函数，供解析器与视图跳转共用 */
export function posToLineCol(text: string, offset: number): { line: number; column: number } {
  const pos = Math.max(0, Math.min(offset, text.length))
  let line = 1
  let lineStart = 0
  let i = 0
  while (i < pos) {
    const c = text.charCodeAt(i)
    if (c === 13 /* \r */) {
      line++
      i += text.charCodeAt(i + 1) === 10 ? 2 : 1
      lineStart = i
    } else if (c === 10 /* \n */) {
      line++
      i++
      lineStart = i
    } else {
      i++
    }
  }
  return { line, column: Math.max(1, pos - lineStart + 1) }
}

export function countLines(text: string): number {
  if (text === '') return 0
  let n = 1
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

class Fail {
  constructor(readonly detail: JsonError) {}
}

const WS = new Set([32, 9, 10, 13])

class Parser {
  private i = 0
  private depth = 0
  constructor(private readonly s: string) {}

  parse(): unknown {
    this.ws()
    if (this.eof()) throw this.fail('输入为空')
    const v = this.value()
    this.ws()
    if (!this.eof()) throw this.fail('JSON 末尾有多余内容')
    return v
  }

  private ws(): void {
    while (this.i < this.s.length && WS.has(this.s.charCodeAt(this.i))) this.i++
  }

  private eof(): boolean {
    return this.i >= this.s.length
  }

  private fail(message: string, at = this.i): Fail {
    const { line, column } = posToLineCol(this.s, at)
    return new Fail({ message, offset: at, line, column })
  }

  private value(): unknown {
    if (this.eof()) throw this.fail('JSON 意外结束')
    const c = this.s[this.i]
    if (c === '{') return this.object()
    if (c === '[') return this.array()
    if (c === '"') return this.string()
    if (c === 't' || c === 'f' || c === 'n') return this.literal()
    if (c === '-' || (c >= '0' && c <= '9')) return this.number()
    throw this.fail(`意外的字符 '${c}'`)
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) throw this.fail(`嵌套超过 ${MAX_DEPTH} 层`)
  }

  /** 容器退出必须回退计数：否则 depth 变成「容器总数」，扁平大数组也会误判超限 */
  private leave(): void {
    this.depth--
  }

  private object(): Record<string, unknown> {
    this.enter()
    this.i++
    const obj: Record<string, unknown> = {}
    this.ws()
    if (this.s[this.i] === '}') {
      this.i++
      this.leave()
      return obj
    }
    for (;;) {
      if (this.s[this.i] !== '"') throw this.fail("对象键名必须是字符串（或 '}' 结束对象）")
      const key = this.string()
      this.ws()
      if (this.s[this.i] !== ':') throw this.fail("键名后应为 ':'")
      this.i++
      this.ws()
      obj[key] = this.value()
      this.ws()
      const c = this.s[this.i]
      if (c === ',') {
        this.i++
        this.ws()
        if (this.s[this.i] === '}') throw this.fail("对象末项后多了一个 ','")
        continue
      }
      if (c === '}') {
        this.i++
        this.leave()
        return obj
      }
      throw this.fail(this.eof() ? 'JSON 意外结束' : "应为 ',' 或 '}'")
    }
  }

  private array(): unknown[] {
    this.enter()
    this.i++
    const arr: unknown[] = []
    this.ws()
    if (this.s[this.i] === ']') {
      this.i++
      this.leave()
      return arr
    }
    for (;;) {
      arr.push(this.value())
      this.ws()
      const c = this.s[this.i]
      if (c === ',') {
        this.i++
        this.ws()
        if (this.s[this.i] === ']') throw this.fail("数组末元素后多了一个 ','")
        continue
      }
      if (c === ']') {
        this.i++
        this.leave()
        return arr
      }
      throw this.fail(this.eof() ? 'JSON 意外结束' : "应为 ',' 或 ']'")
    }
  }

  private string(): string {
    this.i++ // 起始引号
    let out = ''
    let chunkStart = this.i
    const flush = (): void => {
      out += this.s.slice(chunkStart, this.i)
      chunkStart = this.i
    }
    for (;;) {
      if (this.i >= this.s.length) throw this.fail('字符串未闭合')
      const c = this.s[this.i]
      if (c === '"') {
        flush()
        this.i++
        return out
      }
      if (c === '\\') {
        flush()
        this.i++
        if (this.i >= this.s.length) throw this.fail('字符串未闭合')
        const e = this.s[this.i]
        if (e === 'u') {
          this.i++
          for (let k = 0; k < 4; k++) {
            const h = this.s[this.i]
            if (h === undefined || !/[0-9a-fA-F]/.test(h)) throw this.fail('\\u 转义需要 4 位十六进制字符')
            this.i++
          }
          out += String.fromCharCode(parseInt(this.s.slice(this.i - 4, this.i), 16))
          chunkStart = this.i
        } else if (e === '"' || e === '\\' || e === '/' || e === 'b' || e === 'f' || e === 'n' || e === 'r' || e === 't') {
          out += e === 'b' ? '\b' : e === 'f' ? '\f' : e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e
          this.i++
          chunkStart = this.i
        } else {
          throw this.fail(`无效的转义字符 '\\${e}'`)
        }
        continue
      }
      if (c.charCodeAt(0) < 0x20) throw this.fail('字符串中包含未转义的控制字符（如换行）')
      this.i++
    }
  }

  private literal(): unknown {
    if (this.s.startsWith('true', this.i)) {
      this.i += 4
      return true
    }
    if (this.s.startsWith('false', this.i)) {
      this.i += 5
      return false
    }
    if (this.s.startsWith('null', this.i)) {
      this.i += 4
      return null
    }
    throw this.fail('应为 true / false / null')
  }

  private number(): number {
    const start = this.i
    if (this.s[this.i] === '-') {
      this.i++
      if (this.s[this.i] < '0' || this.s[this.i] > '9') throw this.fail('负号后应为数字')
    }
    if (this.s[this.i] === '0') {
      this.i++
      const next = this.s[this.i]
      if (next >= '0' && next <= '9') throw this.fail('整数部分不能有前导 0')
    } else {
      const d = this.s[this.i]
      if (d === undefined || d < '1' || d > '9') throw this.fail('应为数字')
      while (this.s[this.i] >= '0' && this.s[this.i] <= '9') this.i++
    }
    if (this.s[this.i] === '.') {
      this.i++
      const d = this.s[this.i]
      if (d === undefined || d < '0' || d > '9') throw this.fail('小数点后应为数字')
      while (this.s[this.i] >= '0' && this.s[this.i] <= '9') this.i++
    }
    const e = this.s[this.i]
    if (e === 'e' || e === 'E') {
      this.i++
      const sign = this.s[this.i]
      if (sign === '+' || sign === '-') this.i++
      const d = this.s[this.i]
      if (d === undefined || d < '0' || d > '9') throw this.fail('指数应为数字')
      while (this.s[this.i] >= '0' && this.s[this.i] <= '9') this.i++
    }
    return Number(this.s.slice(start, this.i))
  }
}

export function parseJson(text: string): ParseResult {
  try {
    return { ok: true, value: new Parser(text).parse() }
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.detail }
    throw e
  }
}

/** indent=0 即压缩；出错时原样带回错误供状态条展示 */
export function reformat(text: string, indent: number): ReformatResult {
  const r = parseJson(text)
  return r.ok ? { ok: true, text: JSON.stringify(r.value, null, indent) } : r
}

// 自动展开必须无损：parse→stringify 往返会改写 >2^53 整数（16 位起可能溢出进位）与溢出指数（1e999→null），
// 命中危险数字形状即保守跳过；手动格式化按钮不在此列。
// 只检数字 token（先剥字符串字面量）：长 ID/订单号等字符串值重排原样保留、无损，不剥会被误伤挡掉真实日志 JSON
const STRING_LITERAL_RE = /"(?:[^"\\\r\n]|\\.)*"/g
const LOSSY_DIGITS_RE = /\d{16,}/
const LOSSY_EXPONENT_RE = /\d[eE][+-]?\d/

/**
 * 顶层切段（与宿主 recommend 同构的独立实现，插件禁 import 宿主 core）：
 * depth=0 遇 {/[ 记段起点、遇 }/] 归零即段尾；引号内内容跳过（含转义）；
 * 段间非空白返回 null；未闭合尾段原样入列，交逐段 reformat 兜底。
 * 导出供 index.vue 数段数做多段提示。
 */
export function topLevelSegments(text: string): string[] | null {
  const segs: string[] = []
  let depth = 0
  let start = -1
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i++
      else if (c === '"') inStr = false
      continue
    }
    if (depth === 0) {
      if (c === '{' || c === '[') {
        start = i
        depth = 1
      } else if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') {
        return null
      }
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      if (--depth === 0) segs.push(text.slice(start, i + 1))
    }
  }
  if (depth > 0) segs.push(text.slice(start))
  return segs
}

/** 激活注入/粘贴时是 JSON 才展开（2 空格缩进），多段拼接逐段展开换行连接，否则原样返回；1MB 上限防大文本同步 parse 卡顿 */
export function expandIfJson(text: string): string {
  const t = text.trim()
  if (t === '' || t.length > 1_000_000 || (!t.startsWith('{') && !t.startsWith('['))) return text
  const segs = topLevelSegments(t)
  if (segs !== null && segs.length >= 2) {
    // 任一段非法整体原样（保守）；危险数字形状段原样保留、安全段照常展开
    const out: string[] = []
    for (const seg of segs) {
      const r = reformat(seg, 2)
      if (!r.ok) return text
      const numericOnly = seg.replace(STRING_LITERAL_RE, '""')
      out.push(LOSSY_DIGITS_RE.test(numericOnly) || LOSSY_EXPONENT_RE.test(numericOnly) ? seg : r.text)
    }
    return out.join('\n')
  }
  const numericOnly = t.replace(STRING_LITERAL_RE, '""')
  if (LOSSY_DIGITS_RE.test(numericOnly) || LOSSY_EXPONENT_RE.test(numericOnly)) return text
  const r = reformat(t, 2)
  return r.ok ? r.text : text
}

/** 虚拟滚动可视窗口：start/end 为行下标区间 [start, end)，含 overscan 缓冲（行号槽用） */
export function windowRange(
  totalRows: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 8
): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight)
  const start = Math.min(totalRows, Math.max(0, first - overscan))
  const end = Math.min(totalRows, first + visible + overscan)
  return { start, end: Math.max(start, end) }
}
