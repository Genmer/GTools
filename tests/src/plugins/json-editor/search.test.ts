import { describe, expect, it } from 'vitest'
import { MAX_MATCHES, findMatches } from '../../../../src/plugins/json-editor/logic/search'

describe('findMatches', () => {
  it('空关键词零命中且不截断', () => {
    expect(findMatches('{"a":1}', '')).toEqual({ matches: [], truncated: false })
  })

  it('多命中按文档序给 offset 区间与 1 起行号', () => {
    const text = '{\n  "a": "foo",\n  "b": "foo"\n}'
    const r = findMatches(text, 'foo')
    expect(r.truncated).toBe(false)
    expect(r.matches.map((m) => [m.start, m.end, m.line])).toEqual([
      [10, 13, 2],
      [24, 27, 3]
    ])
  })

  it('大小写开关：默认不敏感，开启后仅精确命中', () => {
    const text = 'aA Aa aa'
    expect(findMatches(text, 'aa').matches).toHaveLength(3)
    expect(findMatches(text, 'aa', true).matches.map((m) => m.start)).toEqual([6])
  })

  it('大小写不敏感不误吃非 ASCII 大小写（中文原样匹配）', () => {
    expect(findMatches('「中文」测试中文', '中文').matches.map((m) => m.start)).toEqual([1, 6])
  })

  it('匹配按关键词长度推进，不产出重叠命中', () => {
    const r = findMatches('aaaa', 'aa')
    expect(r.matches.map((m) => m.start)).toEqual([0, 2])
  })

  it('命中数达上限截断并标记 truncated', () => {
    const text = 'ab'.repeat(MAX_MATCHES + 3)
    const r = findMatches(text, 'ab')
    expect(r.matches.length).toBe(MAX_MATCHES)
    expect(r.truncated).toBe(true)
    expect(r.matches[0]).toMatchObject({ start: 0, end: 2, line: 1 })
  })

  it('恰好达上限但无更多命中时 truncated 为 false', () => {
    const text = 'ab'.repeat(MAX_MATCHES)
    const r = findMatches(text, 'ab')
    expect(r.matches.length).toBe(MAX_MATCHES)
    expect(r.truncated).toBe(false)
  })
})
