export interface JsonOk {
  ok: true
  value: unknown
  text?: string
}
export interface JsonErr {
  ok: false
  line: number
  column: number
  message: string
}
export type JsonResult = JsonOk | JsonErr

function locAt(src: string, pos: number): { line: number; column: number } {
  const before = src.slice(0, Math.min(pos, src.length))
  const lines = before.split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

type Step = { ok: true } | { ok: false; msg: string }

// Node 22 起语法错误消息不再带 "position N"，行列定位须自扫（递归下降，i 即出错下标）
function locateError(src: string): { line: number; column: number; message: string } {
  let i = 0
  const n = src.length

  const fail = (msg: string): { line: number; column: number; message: string } => {
    const { line, column } = locAt(src, i)
    return { line, column, message: msg }
  }
  const ws = (): void => {
    while (i < n && ' \t\n\r'.includes(src[i])) i++
  }

  function parseString(): Step {
    if (src[i] !== '"') return { ok: false, msg: `预期字符串，遇到 "${src[i] ?? '输入结束'}"` }
    i++
    while (i < n) {
      const c = src[i]
      if (c === '"') {
        i++
        return { ok: true }
      }
      if (c === '\\') {
        i++
        const esc = src[i]
        if (esc === undefined) return { ok: false, msg: '字符串未闭合（转义截断）' }
        if ('"\\/bfnrt'.includes(esc)) i++
        else if (esc === 'u') {
          if (!/^[0-9a-fA-F]{4}/.test(src.slice(i + 1, i + 5))) return { ok: false, msg: '非法 \\u 转义' }
          i += 5
        } else return { ok: false, msg: `非法转义 "\\${esc}"` }
      } else if (c < ' ') {
        return { ok: false, msg: '字符串内含未转义的控制字符' }
      } else i++
    }
    return { ok: false, msg: '字符串未闭合' }
  }

  function parseNumber(): Step {
    if (src[i] === '-') i++
    if (src[i] === '0') i++
    else if (/[1-9]/.test(src[i] ?? '')) {
      while (/[0-9]/.test(src[i] ?? '')) i++
    } else return { ok: false, msg: `非法数字 "${src.slice(i, i + 2)}"` }
    if (src[i] === '.') {
      i++
      if (!/[0-9]/.test(src[i] ?? '')) return { ok: false, msg: '小数点后缺数字' }
      while (/[0-9]/.test(src[i] ?? '')) i++
    }
    if (src[i] === 'e' || src[i] === 'E') {
      i++
      if (src[i] === '+' || src[i] === '-') i++
      if (!/[0-9]/.test(src[i] ?? '')) return { ok: false, msg: '指数部分缺数字' }
      while (/[0-9]/.test(src[i] ?? '')) i++
    }
    return { ok: true }
  }

  function parseValue(): Step {
    ws()
    if (i >= n) return { ok: false, msg: '意外的输入结束（缺少值）' }
    const c = src[i]
    if (c === '{') {
      i++
      ws()
      if (src[i] === '}') {
        i++
        return { ok: true }
      }
      for (;;) {
        ws()
        const r1 = parseString()
        if (!r1.ok) return r1
        ws()
        if (src[i] !== ':') return { ok: false, msg: `预期 ":"，遇到 "${src[i] ?? '输入结束'}"` }
        i++
        const r2 = parseValue()
        if (!r2.ok) return r2
        ws()
        if (src[i] === ',') {
          i++
          continue
        }
        if (src[i] === '}') {
          i++
          return { ok: true }
        }
        return { ok: false, msg: `预期 "," 或 "}"，遇到 "${src[i] ?? '输入结束'}"` }
      }
    }
    if (c === '[') {
      i++
      ws()
      if (src[i] === ']') {
        i++
        return { ok: true }
      }
      for (;;) {
        const r = parseValue()
        if (!r.ok) return r
        ws()
        if (src[i] === ',') {
          i++
          continue
        }
        if (src[i] === ']') {
          i++
          return { ok: true }
        }
        return { ok: false, msg: `预期 "," 或 "]"，遇到 "${src[i] ?? '输入结束'}"` }
      }
    }
    if (c === '"') return parseString()
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber()
    if (src.startsWith('true', i) || src.startsWith('null', i)) {
      i += 4
      return { ok: true }
    }
    if (src.startsWith('false', i)) {
      i += 5
      return { ok: true }
    }
    if (c === 't' || c === 'f' || c === 'n') return { ok: false, msg: `字面量拼写错误（应为 true/false/null）："${src.slice(i, i + 5)}"` }
    return { ok: false, msg: `意外的字符 "${c}"` }
  }

  const top = parseValue()
  if (!top.ok) return fail(top.msg)
  ws()
  if (i < n) return fail(`根值之后有多余内容 "${src[i]}"`)
  return { line: 1, column: 1, message: '未知错误' }
}

export function validate(json: string): JsonResult {
  try {
    return { ok: true, value: JSON.parse(json) }
  } catch {
    return { ok: false, ...locateError(json) }
  }
}

export function format(json: string, indent: 2 | 4): JsonResult {
  const r = validate(json)
  if (!r.ok) return r
  return { ok: true, value: r.value, text: JSON.stringify(r.value, null, indent) }
}

export function minify(json: string): JsonResult {
  const r = validate(json)
  if (!r.ok) return r
  return { ok: true, value: r.value, text: JSON.stringify(r.value) }
}
