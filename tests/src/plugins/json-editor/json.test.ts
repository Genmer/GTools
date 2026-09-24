import { describe, expect, it } from 'vitest'
import { countLines, parseJson, posToLineCol, reformat } from '../../../../src/plugins/json-editor/logic/json'
import { SAMPLE_JSON } from '../../../../src/plugins/json-editor/logic/sample'

function errOf(text: string): { message: string; line: number; column: number; offset: number } {
  const r = parseJson(text)
  if (r.ok) throw new Error(`预期解析失败，但成功了：${text}`)
  const { message, line, column, offset } = r.error
  return { message, line, column, offset }
}

describe('posToLineCol', () => {
  it('单行与多行定位（1 起）', () => {
    expect(posToLineCol('abc', 0)).toEqual({ line: 1, column: 1 })
    expect(posToLineCol('abc', 2)).toEqual({ line: 1, column: 3 })
    expect(posToLineCol('a\nbc\nd', 3)).toEqual({ line: 2, column: 2 })
    expect(posToLineCol('a\nbc\nd', 5)).toEqual({ line: 3, column: 1 })
  })

  it('\\r\\n 记作一次换行', () => {
    expect(posToLineCol('a\r\nbc', 4)).toEqual({ line: 2, column: 2 })
  })

  it('越界钳制到串长', () => {
    expect(posToLineCol('ab', 99)).toEqual({ line: 1, column: 3 })
  })

  it('负 offset 钳制到 0（line 1 column 1）', () => {
    expect(posToLineCol('abc', -5)).toEqual({ line: 1, column: 1 })
  })
})

describe('countLines', () => {
  it('空串为 0 行，行数按换行符计', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('a')).toBe(1)
    expect(countLines('a\nb')).toBe(2)
    expect(countLines('a\n')).toBe(2)
    expect(countLines('\n\n')).toBe(3)
  })
})

describe('parseJson 合法输入', () => {
  it('示例数据可解析且与 JSON.parse 等价', () => {
    const r = parseJson(SAMPLE_JSON)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual(JSON.parse(SAMPLE_JSON))
  })

  it('根允许基本类型（对齐 JSON.parse 语义）', () => {
    expect(parseJson('123')).toEqual({ ok: true, value: 123 })
    expect(parseJson('true')).toEqual({ ok: true, value: true })
    expect(parseJson('"s"')).toEqual({ ok: true, value: 's' })
    expect(parseJson('null')).toEqual({ ok: true, value: null })
  })

  it('首尾空白（含换行制表符）容忍', () => {
    expect(parseJson('  \n\t 7 \n ')).toEqual({ ok: true, value: 7 })
    expect(parseJson('\r\n{"a":1}\r\n')).toEqual({ ok: true, value: { a: 1 } })
  })

  it('转义/Unicode/代理对/科学计数法与 JSON.parse 逐字等价', () => {
    const cases = [
      '{"\\u0041\\u4e2d": 1.5e10, "s": "a\\nb\\t\\"q\\\\", "surro": "\\uD83D\\uDE00"}',
      '{"neg": -0.5, "zero": 0, "exp": 1E+2, "deep": {"list": [1, [2, [3]]]}}',
      '{"": "空键名也是合法键"}',
      '[1e-3, 0.25, -12]'
    ]
    for (const t of cases) {
      const mine = parseJson(t)
      expect(mine.ok).toBe(true)
      if (mine.ok) expect(mine.value).toEqual(JSON.parse(t))
    }
  })
})

describe('parseJson 错误定位与原因', () => {
  it('空输入', () => {
    expect(errOf('')).toMatchObject({ message: '输入为空', line: 1, column: 1 })
    expect(errOf('   \n ')).toMatchObject({ message: '输入为空', line: 2, column: 2 })
  })

  it('尾逗号：对象与数组分别报错并指向出错处', () => {
    expect(errOf('{"a":1,}')).toMatchObject({ message: "对象末项后多了一个 ','", line: 1, column: 8 })
    expect(errOf('[1, 2,]')).toMatchObject({ message: "数组末元素后多了一个 ','", line: 1, column: 7 })
  })

  it('键名与分隔符', () => {
    expect(errOf("{'a': 1}")).toMatchObject({ message: "对象键名必须是字符串（或 '}' 结束对象）", line: 1, column: 2 })
    expect(errOf('{"a" 1}')).toMatchObject({ message: "键名后应为 ':'", line: 1, column: 6 })
    expect(errOf('{"a": 1 "b": 2}')).toMatchObject({ message: "应为 ',' 或 '}'", line: 1, column: 9 })
    expect(errOf('[1 2]')).toMatchObject({ message: "应为 ',' 或 ']'", line: 1, column: 4 })
  })

  it('字符串类错误', () => {
    expect(errOf('{"a": "b}')).toMatchObject({ message: '字符串未闭合', line: 1, column: 10 })
    expect(errOf('"a\\q"')).toMatchObject({ message: "无效的转义字符 '\\q'", line: 1, column: 4 })
    expect(errOf('{"a": "b\nc"}')).toMatchObject({ message: '字符串中包含未转义的控制字符（如换行）', line: 1, column: 9 })
    expect(errOf('"\\uZZZZ"')).toMatchObject({ message: '\\u 转义需要 4 位十六进制字符', line: 1, column: 4 })
  })

  it('数字类错误', () => {
    expect(errOf('01')).toMatchObject({ message: '整数部分不能有前导 0', line: 1, column: 2 })
    expect(errOf('1.')).toMatchObject({ message: '小数点后应为数字', line: 1, column: 3 })
    expect(errOf('-.5')).toMatchObject({ message: '负号后应为数字', line: 1, column: 2 })
    expect(errOf('1e')).toMatchObject({ message: '指数应为数字', line: 1, column: 3 })
    expect(errOf('+1')).toMatchObject({ message: "意外的字符 '+'", line: 1, column: 1 })
  })

  it('字面量与结尾多余内容', () => {
    expect(errOf('tru')).toMatchObject({ message: '应为 true / false / null', line: 1, column: 1 })
    expect(errOf('NaN')).toMatchObject({ message: "意外的字符 'N'", line: 1, column: 1 })
    expect(errOf('{} x')).toMatchObject({ message: 'JSON 末尾有多余内容', line: 1, column: 4 })
    expect(errOf('[1,')).toMatchObject({ message: 'JSON 意外结束', line: 1, column: 4 })
  })

  it('多行输入定位到正确行列', () => {
    expect(errOf('{"a":\n  1,\n  "b" 2\n}')).toMatchObject({ message: "键名后应为 ':'", line: 3, column: 7 })
    expect(errOf('{\r\n "a": 1x\r\n}')).toMatchObject({ message: "应为 ',' 或 '}'", line: 2, column: 8 })
  })

  it('嵌套超限拒绝（防栈溢出）', () => {
    const r = parseJson('['.repeat(600))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.message).toBe('嵌套超过 512 层')
  })

  it('深度按嵌套计而非容器总数：扁平多容器不误报超限', () => {
    const flat = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ id: i })))
    const r = parseJson(flat)
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.value as unknown[]).length).toBe(2000)
  })
})

describe('reformat', () => {
  it('格式化与压缩往返保持语义', () => {
    const pretty = reformat(SAMPLE_JSON, 2)
    expect(pretty.ok).toBe(true)
    if (pretty.ok) {
      expect(pretty.text).toBe(JSON.stringify(JSON.parse(SAMPLE_JSON), null, 2))
      const minified = reformat(pretty.text, 0)
      expect(minified.ok && minified.text).toBe(JSON.stringify(JSON.parse(SAMPLE_JSON)))
    }
  })

  it('非法输入带回与 parseJson 相同的错误', () => {
    const r = reformat('{"a":,}', 2)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toEqual(errOf('{"a":,}'))
  })
})
