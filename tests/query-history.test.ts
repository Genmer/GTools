import { describe, expect, it } from 'vitest'
import { parseQueryHistory, pushQueryHistory, QUERY_HISTORY_MAX } from '../src/renderer/src/shell/query-history'

describe('parseQueryHistory', () => {
  it('坏 JSON 与非数组返回 []', () => {
    expect(parseQueryHistory(null)).toEqual([])
    expect(parseQueryHistory('not json{')).toEqual([])
    expect(parseQueryHistory('{"a":1}')).toEqual([])
    expect(parseQueryHistory('"str"')).toEqual([])
  })

  it('非字符串与空白词跳过，其余 trim 归一', () => {
    expect(parseQueryHistory(JSON.stringify(['json', 42, '  ', 'jsq ', null]))).toEqual(['json', 'jsq'])
  })

  it('同词去重保序（历史 chips 以词作 :key，重复词会产生重复 key）', () => {
    expect(parseQueryHistory(JSON.stringify(['json', 'jsq', 'json', ' json ']))).toEqual(['json', 'jsq'])
  })

  it('cap 10：与 pushQueryHistory 截断语义对齐', () => {
    const raw = JSON.stringify(Array.from({ length: 14 }, (_, i) => `q${i + 1}`))
    const out = parseQueryHistory(raw)
    expect(out.length).toBe(QUERY_HISTORY_MAX)
    expect(out[0]).toBe('q1')
  })
})

describe('pushQueryHistory', () => {
  it('同词去重并顶置', () => {
    expect(pushQueryHistory(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('trim 非空才入：空白词原列表原样返回（不触发持久化语义变化）', () => {
    expect(pushQueryHistory(['a'], '   ')).toEqual(['a'])
    expect(pushQueryHistory(['a'], '  x ')).toEqual(['x', 'a'])
  })

  it('cap 10：超出截掉最旧', () => {
    let list: string[] = []
    for (let i = 1; i <= 12; i++) list = pushQueryHistory(list, `q${i}`)
    expect(list.length).toBe(QUERY_HISTORY_MAX)
    expect(list[0]).toBe('q12')
    expect(list).toEqual(['q12', 'q11', 'q10', 'q9', 'q8', 'q7', 'q6', 'q5', 'q4', 'q3'])
  })
})
