import { describe, expect, it } from 'vitest'
import { looseJsonText, normalizeLooseJson } from '@sdk/loose-json'

const MONGO_DOC = `{
	"_id" : ObjectId("5db8f8ab6409b80264c5b684"),
	"createTime" : ISODate("2019-10-30T10:42:51.323+08:00"),
	"n" : NumberLong("123"),
	"areaStatus" : -1,
	"remark" : "",
}`

describe('normalizeLooseJson', () => {
  it('Mongo 包裹语法换成参数本身、尾随逗号删除后可解析', () => {
    const n = normalizeLooseJson(MONGO_DOC)
    expect(n).toContain('"_id" : "5db8f8ab6409b80264c5b684"')
    expect(n).toContain('"createTime" : "2019-10-30T10:42:51.323+08:00"')
    expect(n).toContain('"n" : "123"')
    expect(n.endsWith('}')).toBe(true)
    expect(JSON.parse(n)).toBeTruthy()
  })

  it('未加引号的数字参数保持数字', () => {
    expect(normalizeLooseJson('{"a": NumberLong(5)}')).toBe('{"a": 5}')
    expect(normalizeLooseJson('{"a": NumberDecimal(-1.5)}')).toBe('{"a": -1.5}')
  })

  it('new Date 同样归一化', () => {
    expect(normalizeLooseJson('{"t": new Date("2020-01-01")}')).toBe('{"t": "2020-01-01"}')
  })

  it('字符串字面量内的内容一律不动（字符串分支优先）', () => {
    expect(normalizeLooseJson('{"k":"a,}b"}')).toBe('{"k":"a,}b"}')
    expect(normalizeLooseJson('{"k":"ObjectId(\\"x\\")"}')).toBe('{"k":"ObjectId(\\"x\\")"}')
    expect(normalizeLooseJson('{"k":"ISODate(\\"2020\\") and new Date(x)"}')).toBe('{"k":"ISODate(\\"2020\\") and new Date(x)"}')
  })

  it('嵌套尾随逗号全部删除（数组内/对象内/换行与 ] 之间，换行本身保留）', () => {
    expect(normalizeLooseJson('{"a":[1,2,],"b":{"c":3,}}')).toBe('{"a":[1,2],"b":{"c":3}}')
    expect(normalizeLooseJson('{"a":[1,2,\n]}')).toBe('{"a":[1,2\n]}')
    expect(looseJsonText('{"a":[1,2,],"b":{"c":3,}}')).toBe('{"a":[1,2],"b":{"c":3}}')
  })

  it('键名恰为 Date/ISODate 等包裹名：键不动，值上的包裹照常归一化', () => {
    expect(normalizeLooseJson('{ "Date": Date("2020-01-01"), "ISODate": ISODate("x") }')).toBe(
      '{ "Date": "2020-01-01", "ISODate": "x" }'
    )
  })

  it('无参与双参包裹不匹配（Date()/ISODate()/Timestamp(1,2)），保持不可解析', () => {
    expect(normalizeLooseJson('{ "t": Timestamp(1,2) }')).toBe('{ "t": Timestamp(1,2) }')
    expect(looseJsonText('{ "t": Timestamp(1,2), "u": 1 }')).toBeNull()
    expect(looseJsonText('{ "t": Date() }')).toBeNull()
  })
})

describe('looseJsonText', () => {
  it('严格合法直接原样返回', () => {
    expect(looseJsonText('  {"a":1}  ')).toBe('{"a":1}')
  })

  it('Mongo 单文档 + 结尾逗号 → 归一化对象', () => {
    const out = looseJsonText(MONGO_DOC + ',')
    expect(out).not.toBeNull()
    expect(JSON.parse(out!)).toBeTruthy()
  })

  it('多文档逗号清单 → 数组包裹', () => {
    const out = looseJsonText(MONGO_DOC + ',\n' + MONGO_DOC)
    expect(JSON.parse(out!)).toHaveLength(2)
  })

  it('末文档后仍带 EOF 逗号的清单（去 EOF 逗号 + 数组包裹链式生效）', () => {
    expect(JSON.parse(looseJsonText('{"a":1},{"b":2},{"c":3},')!)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  })

  it('多闭合括号等仍非法不被归一化救活', () => {
    expect(looseJsonText('{"a":1,}}')).toBeNull()
  })

  it('数组内尾随逗号归一化', () => {
    expect(looseJsonText('[1,2,]')).toBe('[1,2]')
  })

  it('不可解析返回 null', () => {
    expect(looseJsonText('{bad')).toBeNull()
    expect(looseJsonText('')).toBeNull()
    expect(looseJsonText('hello')).toBeNull()
  })
})
