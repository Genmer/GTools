import { describe, expect, it } from 'vitest'
import {
  composeIncomingPayload,
  countLines,
  decodeUnicodeEscapes,
  escapeJsonString,
  parseJson,
  parseJsonInfo,
  pathAt,
  posToLineCol,
  reformat,
  stripJsonc,
  unescapeJsonString
} from '../../../../src/plugins/json-editor/logic/json'
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

describe('parseJsonInfo 重复键计数', () => {
  it('同对象同键计数（last-wins 语义不变），不同对象互不影响', () => {
    const r = parseJsonInfo('{"a":1,"a":2,"b":{"a":3,"a":4}}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      // 外层 a 重复 1 次 + 内层 a 重复 1 次
      expect(r.dupKeys).toBe(2)
      expect(r.value).toEqual({ a: 2, b: { a: 4 } })
    }
    const clean = parseJsonInfo('{"a":1,"b":{"a":2}}')
    expect(clean.ok && clean.dupKeys).toBe(0)
  })

  it('原型链键名（toString 等）不误报重复', () => {
    const r = parseJsonInfo('{"toString":1,"constructor":2}')
    expect(r.ok && r.dupKeys).toBe(0)
  })
})

describe('stripJsonc', () => {
  it('行注释/块注释/尾逗号等长替换为空格，剥后可解析', () => {
    const src = `{
  // 行注释
  "a": 1, /* 块
注释 */
  "b": [1, 2,],
}`
    const { text: out, ignored } = stripJsonc(src)
    expect(out.length).toBe(src.length)
    expect(ignored).toBe(4)
    const r = parseJson(out)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toEqual({ a: 1, b: [1, 2] })
  })

  it('换行位置逐字符不变（行列号与 offset 全程有效）', () => {
    const src = '{\n  // c\n  "a": 1,\n}'
    const out = stripJsonc(src).text
    const nl = (s: string): number[] => [...s].map((c, i) => (c === '\n' ? i : -1)).filter((i) => i >= 0)
    expect(nl(out)).toEqual(nl(src))
  })

  it('字符串字面量内的 //、/*、} 与 , 不剥', () => {
    const src = '{"url": "http://x", "s": "a,]//b", "c": "/* 不是注释 */"}'
    const r = stripJsonc(src)
    expect(r.text).toBe(src)
    expect(r.ignored).toBe(0)
  })

  it('无宽松内容时原样返回', () => {
    const r = stripJsonc('{"a": [1, 2]}')
    expect(r).toEqual({ text: '{"a": [1, 2]}', ignored: 0 })
  })

  it('注释中的伪字符串不干扰字符串态跟踪', () => {
    const src = '{\n  // "unclosed\n  "a": 1\n}'
    const r = stripJsonc(src)
    expect(parseJson(r.text).ok).toBe(true)
  })
})

describe('escapeJsonString / unescapeJsonString', () => {
  it('转义-还原往返（控制符/引号/反斜杠）', () => {
    const s = 'a"b\\c\nd\te'
    expect(escapeJsonString(s)).toBe(JSON.stringify(s))
    expect(unescapeJsonString(escapeJsonString(s))).toBe(s)
  })

  it('去转义只认整文单个字符串字面量，其余形态返回 null', () => {
    expect(unescapeJsonString('"abc"')).toBe('abc')
    expect(unescapeJsonString('"a\\nb"')).toBe('a\nb')
    expect(unescapeJsonString('{"a":1}')).toBeNull()
    expect(unescapeJsonString('abc')).toBeNull()
    expect(unescapeJsonString('"a" "b"')).toBeNull()
    expect(unescapeJsonString('')).toBeNull()
  })
})

describe('decodeUnicodeEscapes', () => {
  it('基本平面 \\uXXXX 还原为字符', () => {
    expect(decodeUnicodeEscapes('{"\\u4e2d": "\\u0041"}')).toBe('{"中": "A"}')
  })

  it('高低代理配对合并为单码位（emoji）', () => {
    const out = decodeUnicodeEscapes('"\\ud83d\\ude00"')
    expect(out).toBe('"😀"')
    expect([...out]).toHaveLength(3)
  })

  it('孤立高代理不炸，按单码元原样输出', () => {
    const out = decodeUnicodeEscapes('\\ud83d')
    expect(out.length).toBe(1)
    expect(out.charCodeAt(0)).toBe(0xd83d)
  })

  it('偶数个前置反斜杠的 \\u 是字面反斜杠+u，不动', () => {
    expect(decodeUnicodeEscapes('\\\\u0041')).toBe('\\\\u0041')
  })

  it('无转义原文返回（零拷贝路径）', () => {
    expect(decodeUnicodeEscapes('{"a": 1}')).toBe('{"a": 1}')
  })
})

describe('pathAt', () => {
  const doc = '{"a": {"b": [1, "x"]}, "c d": 2}'

  it('对象/数组/嵌套/键名归其值', () => {
    expect(pathAt(doc, 13)).toBe('$.a.b[0]')
    expect(pathAt(doc, 17)).toBe('$.a.b[1]')
    expect(pathAt(doc, 8)).toBe('$.a.b')
    expect(pathAt(doc, 23)).toBe('$["c d"]')
    expect(pathAt(doc, 30)).toBe('$["c d"]')
    expect(pathAt(doc, 6)).toBe('$.a')
    expect(pathAt(doc, 0)).toBe('$')
  })

  it('区间端点都算在内；文末与前后空白落到根', () => {
    expect(pathAt(doc, 14)).toBe('$.a.b[0]')
    expect(pathAt(doc, 19)).toBe('$.a.b[1]')
    expect(pathAt(doc, doc.length)).toBe('$')
    expect(pathAt(' 42', 0)).toBe('$')
  })

  it('简单键名点号连接，特殊键名（含空格/引号）退回转义括号', () => {
    expect(pathAt('{"a-b": 1, "q\\"r": 2}', 8)).toBe('$["a-b"]')
    expect(pathAt('{"a-b": 1, "q\\"r": 2}', 17)).toBe('$["q\\"r"]')
    expect(pathAt('[{"k": [true, null]}]', 3)).toBe('$[0].k')
    expect(pathAt('[{"k": [true, null]}]', 9)).toBe('$[0].k[0]')
  })

  it('非法文本返回 null；根为基本类型返回 $', () => {
    expect(pathAt('{"a":', 3)).toBeNull()
    expect(pathAt('', 0)).toBeNull()
    expect(pathAt('42', 0)).toBe('$')
    expect(pathAt('"s"', 2)).toBe('$')
  })
})

describe('composeIncomingPayload（进入插件时的草稿合成）', () => {
  it('合法 query 替换草稿', () => {
    expect(composeIncomingPayload('{"a":1}', '{"b":2}', '')).toBe('{"b":2}')
  })

  it('无输入保留草稿', () => {
    expect(composeIncomingPayload('{"a":1}', '', '')).toBe('{"a":1}')
  })

  it('query 与文件并存且均合法时文件优先', () => {
    expect(composeIncomingPayload('{"a":1}', '{"b":2}', '{"c":3}')).toBe('{"c":3}')
  })

  it('非 JSON 残留 query 不覆盖草稿（防 junk 经 DRAFT_KEY 落盘不可恢复）', () => {
    expect(composeIncomingPayload('{"a":1}', 'foo', '')).toBe('{"a":1}')
  })

  it('文件非法时回退 query；两者均非法保留草稿', () => {
    expect(composeIncomingPayload('{"a":1}', '{"b":2}', 'not-json')).toBe('{"b":2}')
    expect(composeIncomingPayload('{"a":1}', 'foo', 'bar')).toBe('{"a":1}')
  })

  it('无草稿：合法 query 直接采用，残留丢弃给空编辑器', () => {
    expect(composeIncomingPayload('', '[1,2]', '')).toBe('[1,2]')
    expect(composeIncomingPayload('', 'foo', '')).toBe('')
  })
})
