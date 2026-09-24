import { describe, expect, it } from 'vitest'
import { format, minify, validate } from '../../../../src/plugins/devtools/views/logic/json'

describe('devtools json validate：合法输入', () => {
  it('嵌套结构解析并返回值', () => {
    const src = '{\n  "a": [1, 2.5, -3e-1],\n  "b": {"c": null, "d": true, "e": "\\u4f60"}\n}'
    const r = validate(src)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ a: [1, 2.5, -0.3], b: { c: null, d: true, e: '你' } })
  })

  it('顶层标量与首尾空白', () => {
    expect(validate('  null ').ok).toBe(true)
    expect(validate('"x"').ok).toBe(true)
    expect(validate(' [] ').ok).toBe(true)
  })
})

describe('devtools json validate：语法错误定位（行列从 1 起）', () => {
  const expectErr = (src: string, line: number, column: number, msgPart: string): void => {
    const r = validate(src)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.line).toBe(line)
      expect(r.column).toBe(column)
      expect(r.message).toContain(msgPart)
    }
  }

  it('对象键必须是字符串', () => {
    expectErr('{a:1}', 1, 2, '预期字符串')
  })

  it('缺冒号：单行列号与多行行号', () => {
    expectErr('{"a" 1}', 1, 6, '预期 ":"')
    expectErr('{\n  "a": 1,\n  "b" 2\n}', 3, 7, '预期 ":"')
  })

  it('输入截断与未闭合', () => {
    expectErr('', 1, 1, '意外的输入结束')
    expectErr('[1,', 1, 4, '意外的输入结束')
    expectErr('"abc', 1, 5, '字符串未闭合')
  })

  it('根值后多余内容', () => {
    expectErr('{"a":1}x', 1, 8, '多余内容')
  })

  it('字符串内的非法内容：裸控制字符 / 非法转义 / 非法 \\u', () => {
    expectErr('["\t"]', 1, 3, '控制字符')
    expectErr('["\\q"]', 1, 4, '非法转义')
    expectErr('["\\uZZZZ"]', 1, 4, '\\u')
  })

  it('字面量与数字格式错误', () => {
    expectErr('tru', 1, 1, '字面量拼写错误')
    expectErr('NaN', 1, 1, '意外的字符')
    expectErr('[01]', 1, 3, '预期 "," 或 "]"')
    expectErr('{"a":1.}', 1, 8, '小数点后缺数字')
    expectErr('{"a":1e}', 1, 8, '指数部分缺数字')
  })

  it('尾随逗号（JSON 严格语法不允许）', () => {
    expectErr('{"a":1,}', 1, 8, '预期字符串')
  })
})

describe('devtools json format / minify', () => {
  it('2 空格与 4 空格缩进', () => {
    expect(format('{"b":1,"a":[2,3]}', 2)).toMatchObject({
      ok: true,
      text: '{\n  "b": 1,\n  "a": [\n    2,\n    3\n  ]\n}'
    })
    expect(format('[1]', 4)).toMatchObject({ ok: true, text: '[\n    1\n]' })
  })

  it('minify 去掉全部空白', () => {
    expect(minify(' { "a" : 1 , "b" : [ true , null ] } ')).toMatchObject({
      ok: true,
      text: '{"a":1,"b":[true,null]}'
    })
  })

  it('非法输入时 format/minify 透传错误定位', () => {
    const r = format('{a:1}', 2)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.line).toBe(1)
      expect(r.column).toBe(2)
    }
    expect(minify('[1,').ok).toBe(false)
  })
})
