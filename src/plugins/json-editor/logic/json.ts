// JSON 解析与错误定位：自写递归下降而非复用 JSON.parse 的报错——
// 新版 V8 报错文本不再稳定携带 "at position N"，行列号只能自己算才跨版本可靠。

import { looseJsonText } from '@sdk/loose-json'

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
export type ParseInfoResult = { ok: true; value: unknown; dupKeys: number } | { ok: false; error: JsonError }
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
  private dupCount = 0
  constructor(private readonly s: string) {}

  parse(): unknown {
    this.ws()
    if (this.eof()) throw this.fail('输入为空')
    const v = this.value()
    this.ws()
    if (!this.eof()) throw this.fail('JSON 末尾有多余内容')
    return v
  }

  dupKeys(): number {
    return this.dupCount
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
    // Set 而非 key in obj：后者会误把 'toString' 等原型链键当重复
    const seen = new Set<string>()
    this.ws()
    if (this.s[this.i] === '}') {
      this.i++
      this.leave()
      return obj
    }
    for (;;) {
      if (this.s[this.i] !== '"') throw this.fail("对象键名必须是字符串（或 '}' 结束对象）")
      const key = this.string()
      // 同对象重复键 last-wins（下方 obj[key] 赋值），这里只计数供状态栏知情提示
      if (seen.has(key)) this.dupCount++
      else seen.add(key)
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

/** parseJson 附加重复键计数（同对象同键出现次数，last-wins 语义不变） */
export function parseJsonInfo(text: string): ParseInfoResult {
  try {
    const p = new Parser(text)
    const value = p.parse()
    return { ok: true, value, dupKeys: p.dupKeys() }
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

/**
 * 深链/拖入/剪贴板注入载荷合成：文件内容优先于 query/initialText 残留，各自独立校验——
 * 仅当新载荷自身是合法（或宽松可归一化的）JSON 才替换草稿；
 * 'foo' 之类非 JSON 残留不碰旧草稿（被 junk 覆盖会经 DRAFT_KEY 落盘不可恢复）
 */
export function composeIncomingPayload(base: string, q: string, fileText: string): string {
  if (fileText !== '' && parseJson(fileText).ok) return fileText
  if (q !== '' && parseJson(q).ok) return q
  if (q !== '' && looseJsonText(q) !== null) return q
  return base
}

export interface StripResult {
  text: string
  /** 被忽略处数（每段注释、每个尾逗号各计 1） */
  ignored: number
}

/** 宽松剥除（jsonc 级）：行/块注释与尾逗号等长替换为空格（换行保留），行列号与 offset 全程有效。
 *  字符串字面量内的 //、/* 与 , 不剥；调用方拿去重新 parse 即得宽松语义。 */
export function stripJsonc(text: string): StripResult {
  const n = text.length
  const out: string[] = new Array<string>(n)
  let ignored = 0
  let i = 0
  while (i < n) {
    const c = text[i]
    if (c === '"') {
      // 整段字符串字面量原样拷贝（含转义序列）
      out[i] = c
      i++
      while (i < n) {
        const sc = text[i]
        out[i] = sc
        i++
        if (sc === '\\') {
          if (i < n) {
            out[i] = text[i]
            i++
          }
        } else if (sc === '"') break
      }
      continue
    }
    if (c === '/' && text[i + 1] === '/') {
      ignored++
      while (i < n && text[i] !== '\n') {
        out[i] = ' '
        i++
      }
      continue
    }
    if (c === '/' && text[i + 1] === '*') {
      ignored++
      out[i] = ' '
      out[i + 1] = ' '
      i += 2
      while (i < n) {
        if (text[i] === '*' && text[i + 1] === '/') {
          out[i] = ' '
          out[i + 1] = ' '
          i += 2
          break
        }
        out[i] = text[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    if (c === ',') {
      let j = i + 1
      while (j < n && WS.has(text.charCodeAt(j))) j++
      if (text[j] === '}' || text[j] === ']') {
        out[i] = ' '
        ignored++
        i++
        continue
      }
    }
    out[i] = c
    i++
  }
  return { text: out.join(''), ignored }
}

/** 整文 → 带引号的 JSON 字符串字面量（控制符/引号/反斜杠全转义） */
export function escapeJsonString(text: string): string {
  return JSON.stringify(text)
}

const STRING_LITERAL_RE = /"(?:[^"\\\r\n]|\\.)*"/g
const LOSSY_DIGITS_RE = /\d{16,}/
const LOSSY_EXPONENT_RE = /\d[eE][+-]?\d/

/**
 * 顶层切段（与 sdk/json-detect 同构的独立实现，插件禁 import 宿主 core）：
 * depth=0 遇 {/[ 记段起点、遇 }/] 归零即段尾；引号内内容跳过（含转义）；
 * 段间非空白返回 null；未闭合尾段原样入列，交逐段展开兜底。
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

/** 危险数字形状守卫：剥字符串后含超精度长整数或指数记法则原样保留（parse→stringify 往返会改写） */
function hasLossyShape(text: string): boolean {
  const numericOnly = text.replace(STRING_LITERAL_RE, '""')
  return LOSSY_DIGITS_RE.test(numericOnly) || LOSSY_EXPONENT_RE.test(numericOnly)
}

/**
 * 单候选展开：先经 @sdk/loose-json 四档（严格→归一化→去尾逗号→数组包裹）拿可解析文本，
 * 不可解析返回 null（多段时任一段 null 整体原样）；可解析但危险数字形状（原文或归一化文本）
 * 原样保留；Mongo 导出的 ObjectId/ISODate 等会转成对应字符串值后重排。
 */
function expandOne(c: string): string | null {
  const loose = looseJsonText(c)
  if (loose === null) return null
  if (hasLossyShape(c) || hasLossyShape(loose)) return c
  const r = reformat(loose, 2)
  return r.ok ? r.text : null
}

/** 激活注入/粘贴时是 JSON 才展开（2 空格缩进），多段拼接逐段展开换行连接，否则原样返回；1MB 上限防大文本同步 parse 卡顿 */
export function expandIfJson(text: string): string {
  const t = text.trim()
  if (t === '' || t.length > 1_000_000 || (!t.startsWith('{') && !t.startsWith('['))) return text
  const segs = topLevelSegments(t)
  if (segs !== null && segs.length >= 2) {
    // 任一段不可展开整体原样（保守）；危险数字形状段原样保留、安全段照常展开
    const out: string[] = []
    for (const seg of segs) {
      const r = expandOne(seg)
      if (r === null) return text
      out.push(r)
    }
    return out.join('\n')
  }
  return expandOne(t) ?? text
}

/** 整文恰为单个 JSON 字符串字面量时还原其内容，其余形态返回 null（调用方提示后不改写） */
export function unescapeJsonString(text: string): string | null {
  const r = parseJson(text)
  return r.ok && typeof r.value === 'string' ? r.value : null
}

/** 把文本里的 \uXXXX 还原为字符（不要求 JSON 合法）。高低代理配对合成单码位，孤立代理按单码元原样输出；
 *  偶数个前置反斜杠的 \u 是被转义的反斜杠+字面 u，不动。 */
export function decodeUnicodeEscapes(text: string): string {
  if (!text.includes('\\')) return text
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c !== '\\') {
      out += c
      i++
      continue
    }
    let j = i
    while (text[j] === '\\') j++
    const run = j - i
    const hex = text.slice(j + 1, j + 5)
    if (text[j] === 'u' && run % 2 === 1 && /^[0-9a-fA-F]{4}$/.test(hex)) {
      out += text.slice(i, j - 1)
      const unit = parseInt(hex, 16)
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const m = /^\\u([0-9a-fA-F]{4})/.exec(text.slice(j + 5, j + 11))
        if (m !== null) {
          const low = parseInt(m[1], 16)
          if (low >= 0xdc00 && low <= 0xdfff) {
            out += String.fromCodePoint(((unit - 0xd800) << 10) + (low - 0xdc00) + 0x10000)
            i = j + 11
            continue
          }
        }
      }
      out += String.fromCharCode(unit)
      i = j + 5
      continue
    }
    out += text.slice(i, j)
    i = j
  }
  return out
}

/** 简单键名走点号连接，含空格/引号/非 ASCII 的键退回 ["转义"] 形式（与 JSONPath 惯例一致） */
function isSimpleKey(key: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
}

function pathSegment(path: string, key: string): string {
  return isSimpleKey(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`
}

/** 只走位不建值的递归下降：记录光标（offset，区间端点均算在内）落到的最深值路径；
 *  键名 token 上的光标归其值。文本非法抛错由 pathAt 转 null。 */
class PathWalker {
  private i = 0
  private depth = 0
  private bestDepth = -1
  private best: string | null = null
  constructor(private readonly s: string, private readonly offset: number) {}

  private ws(): void {
    while (this.i < this.s.length && WS.has(this.s.charCodeAt(this.i))) this.i++
  }

  private set(path: string, depth: number, start: number): void {
    if (depth > this.bestDepth && this.offset >= start && this.offset <= this.i) {
      this.bestDepth = depth
      this.best = path
    }
  }

  private fail(): never {
    throw new Error('path-walk')
  }

  walk(): string | null {
    this.ws()
    if (this.i >= this.s.length) this.fail()
    this.value('$', 0)
    this.ws()
    if (this.i < this.s.length) this.fail()
    return this.best ?? '$'
  }

  private value(path: string, depth: number): void {
    if (this.i >= this.s.length) this.fail()
    const c = this.s[this.i]
    if (c === '{') return this.object(path, depth)
    if (c === '[') return this.array(path, depth)
    if (c === '"') {
      const start = this.i
      this.string()
      this.set(path, depth, start)
      return
    }
    if (c === 't' || c === 'f' || c === 'n') return this.literal(path, depth)
    if (c === '-' || (c >= '0' && c <= '9')) return this.number(path, depth)
    this.fail()
  }

  private object(path: string, depth: number): void {
    if (++this.depth > MAX_DEPTH) this.fail()
    const start = this.i
    this.i++
    this.ws()
    if (this.s[this.i] === '}') {
      this.i++
      this.depth--
      this.set(path, depth, start)
      return
    }
    for (;;) {
      if (this.s[this.i] !== '"') this.fail()
      const keyStart = this.i
      const key = this.string()
      const keyEnd = this.i
      this.ws()
      if (this.s[this.i] !== ':') this.fail()
      this.i++
      this.ws()
      const child = pathSegment(path, key)
      this.value(child, depth + 1)
      // 键名 token 上的光标归该键的值（此刻 this.i 已是值的右端）
      if (this.offset >= keyStart && this.offset <= keyEnd) {
        if (depth + 1 > this.bestDepth) {
          this.bestDepth = depth + 1
          this.best = child
        }
      }
      this.ws()
      const c = this.s[this.i]
      if (c === ',') {
        this.i++
        this.ws()
        if (this.s[this.i] === '}') this.fail()
        continue
      }
      if (c === '}') {
        this.i++
        this.depth--
        this.set(path, depth, start)
        return
      }
      this.fail()
    }
  }

  private array(path: string, depth: number): void {
    if (++this.depth > MAX_DEPTH) this.fail()
    const start = this.i
    this.i++
    this.ws()
    if (this.s[this.i] === ']') {
      this.i++
      this.depth--
      this.set(path, depth, start)
      return
    }
    for (let idx = 0; ; idx++) {
      this.value(`${path}[${idx}]`, depth + 1)
      this.ws()
      const c = this.s[this.i]
      if (c === ',') {
        this.i++
        this.ws()
        if (this.s[this.i] === ']') this.fail()
        continue
      }
      if (c === ']') {
        this.i++
        this.depth--
        this.set(path, depth, start)
        return
      }
      this.fail()
    }
  }

  /** 只为取键名：走位到闭引号并解码；非法形态一律 fail（pathAt 整体返回 null，无需精确错误位） */
  private string(): string {
    this.i++ // 起始引号
    let out = ''
    for (;;) {
      if (this.i >= this.s.length) this.fail()
      const c = this.s[this.i]
      if (c === '"') {
        this.i++
        return out
      }
      if (c === '\\') {
        this.i++
        const e = this.s[this.i]
        if (e === undefined) this.fail()
        if (e === 'u') {
          const hex = this.s.slice(this.i + 1, this.i + 5)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail()
          out += String.fromCharCode(parseInt(hex, 16))
          this.i += 5
        } else if (e === '"' || e === '\\' || e === '/' || e === 'b' || e === 'f' || e === 'n' || e === 'r' || e === 't') {
          out += e === 'b' ? '\b' : e === 'f' ? '\f' : e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e
          this.i++
        } else {
          this.fail()
        }
        continue
      }
      out += c
      this.i++
    }
  }

  private literal(path: string, depth: number): void {
    const start = this.i
    if (this.s.startsWith('true', this.i)) this.i += 4
    else if (this.s.startsWith('false', this.i)) this.i += 5
    else if (this.s.startsWith('null', this.i)) this.i += 4
    else this.fail()
    this.set(path, depth, start)
  }

  private number(path: string, depth: number): void {
    const start = this.i
    if (this.s[this.i] === '-') this.i++
    if (this.s[this.i] === '0') this.i++
    else {
      if (this.s[this.i] < '1' || this.s[this.i] > '9') this.fail()
      while (this.s[this.i] >= '0' && this.s[this.i] <= '9') this.i++
    }
    if (this.s[this.i] === '.') {
      this.i++
      while (this.s[this.i] >= '0' && this.s[this.i] <= '9') this.i++
    }
    const e = this.s[this.i]
    if (e === 'e' || e === 'E') {
      this.i++
      if (this.s[this.i] === '+' || this.s[this.i] === '-') this.i++
      while (this.s[this.i] >= '0' && this.s[this.i] <= '9') this.i++
    }
    this.set(path, depth, start)
  }
}

/** 光标处值的 JSONPath（$.a.b[0]，特殊键名退回 ["转义"] 形式）；文本非法返回 null */
export function pathAt(text: string, offset: number): string | null {
  const off = Math.max(0, Math.min(offset, text.length))
  try {
    return new PathWalker(text, off).walk()
  } catch {
    return null
  }
}
