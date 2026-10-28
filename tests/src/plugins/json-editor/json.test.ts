import { describe, expect, it } from 'vitest'
import { countLines, expandIfJson, parseJson, posToLineCol, reformat, topLevelSegments, windowRange } from '../../../../src/plugins/json-editor/logic/json'
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

describe('topLevelSegments（顶层切段）', () => {
  it('单段切一段，多段按直拼/空白分隔切多段，首尾空白不产生空段', () => {
    expect(topLevelSegments('{"a":1}')).toEqual(['{"a":1}'])
    expect(topLevelSegments('[1]{"a":1}')).toEqual(['[1]', '{"a":1}'])
    expect(topLevelSegments('  {"a":1}\n\t [2]  ')).toEqual(['{"a":1}', '[2]'])
  })

  it('嵌套只切顶层：深层括号不归零切段', () => {
    expect(topLevelSegments('{"a":{"b":[1,{"c":2}]}}[3]')).toEqual(['{"a":{"b":[1,{"c":2}]}}', '[3]'])
  })

  it('引号内括号不切段、转义引号与转义反斜杠不提前闭串', () => {
    expect(topLevelSegments('{"k":"a]{b"}[1]')).toEqual(['{"k":"a]{b"}', '[1]'])
    expect(topLevelSegments('{"k":"a\\"}{"x":1}')).toEqual(['{"k":"a\\"}{"x":1}'])
    expect(topLevelSegments('{"k":"a\\\\b"}[1]')).toEqual(['{"k":"a\\\\b"}', '[1]'])
  })

  it('段间/段前出现非空白字符返回 null（垃圾文本、多余闭合）', () => {
    expect(topLevelSegments('{"a":1} x [2]')).toBeNull()
    expect(topLevelSegments('x {"a":1}')).toBeNull()
    expect(topLevelSegments('{"a":1}}[2]')).toBeNull()
  })

  it('未闭合尾段原样入列，交逐段 reformat 兜底判失败', () => {
    expect(topLevelSegments('{"a":1}{"b":2')).toEqual(['{"a":1}', '{"b":2'])
    expect(topLevelSegments('{"a":1}[2,')).toEqual(['{"a":1}', '[2,'])
  })

  it('空串与纯空白返回空段列表', () => {
    expect(topLevelSegments('')).toEqual([])
    expect(topLevelSegments('  \n\t ')).toEqual([])
  })
})

describe('expandIfJson', () => {
  it('压缩 object 展开（2 空格缩进），首尾空白容忍', () => {
    expect(expandIfJson('{"a":1,"b":[2,3]}')).toBe(JSON.stringify({ a: 1, b: [2, 3] }, null, 2))
    expect(expandIfJson('  \n{"a":1}\n  ')).toBe(JSON.stringify({ a: 1 }, null, 2))
  })

  it('压缩数组展开', () => {
    expect(expandIfJson('[1,{"k":"v"}]')).toBe(JSON.stringify([1, { k: 'v' }], null, 2))
  })

  it('非法 JSON 原样返回（含 { 开头但解析失败的文本）', () => {
    const bad = '{"a":1,}'
    expect(expandIfJson(bad)).toBe(bad)
    expect(expandIfJson('not json')).toBe('not json')
  })

  it('顶层标量原样返回（与宿主 looksLikeJson 口径一致：只展开顶层 object/array）', () => {
    expect(expandIfJson('123')).toBe('123')
    expect(expandIfJson('"str"')).toBe('"str"')
    expect(expandIfJson('true')).toBe('true')
  })

  it('空串与空白原样返回', () => {
    expect(expandIfJson('')).toBe('')
    expect(expandIfJson('   ')).toBe('   ')
  })

  it('超 1MB 不展开（防大文本同步 parse 卡顿）', () => {
    const big = '["' + 'x'.repeat(1_000_000) + '"]'
    expect(big.length).toBeGreaterThan(1_000_000)
    expect(expandIfJson(big)).toBe(big)
  })

  it('恰 1MB（含）仍展开：上限判定为严格大于', () => {
    // 前缀 {"k":" 6 字符 + 后缀 "} 2 字符 = 8 字符壳
    const exact = '{"k":"' + 'x'.repeat(1_000_000 - 8) + '"}'
    expect(exact.length).toBe(1_000_000)
    expect(expandIfJson(exact)).toBe(JSON.stringify({ k: 'x'.repeat(1_000_000 - 8) }, null, 2))
  })

  it('幂等：已展开文本再入参返回等值，不再变形', () => {
    const once = expandIfJson('{"a":1,"b":[{"c":true},null]}')
    expect(expandIfJson(once)).toBe(once)
    // 带首尾空白的已展开文本同样收敛到同一份展开结果
    expect(expandIfJson(`\n${once}\n`)).toBe(once)
  })

  it('16 位以上连续数字保守跳过（往返会改写 >2^53 整数，如 snowflake ID 静默进位）', () => {
    const big = '{"id":1234567890123456789}'
    expect(expandIfJson(big)).toBe(big)
  })

  it('科学计数法形状保守跳过（溢出指数往返变 null）', () => {
    const exp = '{"big":1e999}'
    expect(expandIfJson(exp)).toBe(exp)
    const smallExp = '{"s":2.5e-3}'
    expect(expandIfJson(smallExp)).toBe(smallExp)
  })

  it('16 位以下正常数字照常展开', () => {
    expect(expandIfJson('{"n":123456789012345}')).toBe(JSON.stringify({ n: 123456789012345 }, null, 2))
  })

  it('字符串值含长数字照常展开（字符串重排原样保留无损，剥字符串后只剩安全数字 token）', () => {
    const s = '{"order":"1234567890123456789"}'
    expect(expandIfJson(s)).toBe(JSON.stringify({ order: '1234567890123456789' }, null, 2))
  })

  it('真实日志回归：字符串里 19 位 trace id + 13 位毫秒时间戳数字值，整体展开', () => {
    const raw =
      '{"id":"2607080222582615858aaa6487d8ae7b","requestDateTtl":1783448578000,"cityId":31113}'
    expect(expandIfJson(raw)).toBe(
      JSON.stringify({ id: '2607080222582615858aaa6487d8ae7b', requestDateTtl: 1783448578000, cityId: 31113 }, null, 2)
    )
  })

  it('字符串里的科学计数法形状照常展开；数字 token 的仍跳过', () => {
    const s = '{"note":"1e999"}'
    expect(expandIfJson(s)).toBe(JSON.stringify({ note: '1e999' }, null, 2))
    const n = '{"big":1e999}'
    expect(expandIfJson(n)).toBe(n)
  })

  it('含转义引号的字符串剥净后不影响判定（数字 token 16 位仍跳过）', () => {
    const s = '{"msg":"say \\"big 12345678901234567890\\" ok"}'
    expect(expandIfJson(s)).toBe(JSON.stringify({ msg: 'say "big 12345678901234567890" ok' }, null, 2))
    const n = `{"msg":"plain","id":12345678901234567890}`
    expect(expandIfJson(n)).toBe(n)
  })

  it('多段拼接：逐段 2 空格展开后换行连接', () => {
    const a = JSON.stringify({ a: 1, b: [2, 3] }, null, 2)
    const b = JSON.stringify([4, 5], null, 2)
    expect(expandIfJson('{"a":1,"b":[2,3]}[4,5]')).toBe(`${a}\n${b}`)
    expect(expandIfJson('{"a":1,"b":[2,3]}\n\n  [4,5]')).toBe(`${a}\n${b}`)
    // 引号内括号不切段
    expect(expandIfJson('{"k":"a]{b"}[2]')).toBe(
      `${JSON.stringify({ k: 'a]{b' }, null, 2)}\n${JSON.stringify([2], null, 2)}`
    )
  })

  it('多段拼接危险数字形状：该段原样保留、安全段照常展开', () => {
    const raw = '{"id":1234567890123456789}{"n":1}'
    expect(expandIfJson(raw)).toBe('{"id":1234567890123456789}\n' + JSON.stringify({ n: 1 }, null, 2))
    // 科学计数法段同理
    const exp = '{"big":1e999}[1]'
    expect(expandIfJson(exp)).toBe('{"big":1e999}\n' + JSON.stringify([1], null, 2))
  })

  it('多段拼接任一段非法整体原样返回（含未闭合、危险形状的非法段）', () => {
    const bad = '{"a":1}{bad}'
    expect(expandIfJson(bad)).toBe(bad)
    const unclosed = '{"a":1}{"b":2'
    expect(expandIfJson(unclosed)).toBe(unclosed)
    // 非法且带危险数字形状的尾段不能被「原样保留」误放行
    const badDanger = '{"a":1}{"id":12345678901234567890'
    expect(expandIfJson(badDanger)).toBe(badDanger)
  })
})

describe('windowRange', () => {
  it('常规窗口含 overscan 缓冲', () => {
    expect(windowRange(1000, 0, 480, 24)).toEqual({ start: 0, end: 28 })
    expect(windowRange(1000, 24 * 100, 480, 24)).toEqual({ start: 92, end: 128 })
  })

  it('边界：滚过头/零视口/空列表钳制', () => {
    expect(windowRange(10, 99999, 480, 24)).toEqual({ start: 10, end: 10 })
    expect(windowRange(0, 100, 480, 24)).toEqual({ start: 0, end: 0 })
    expect(windowRange(100, -5, 0, 24)).toEqual({ start: 0, end: 8 })
  })
})
