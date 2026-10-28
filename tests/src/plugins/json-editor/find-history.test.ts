import { describe, expect, it } from 'vitest'
import {
  FIND_HISTORY_MAX,
  FIND_HISTORY_TEXT_MAX,
  parseFindHistory,
  pushFindHistory
} from '../../../../src/plugins/json-editor/logic/find-history'

describe('parseFindHistory', () => {
  it('非数组返回空', () => {
    expect(parseFindHistory(null)).toEqual([])
    expect(parseFindHistory(undefined)).toEqual([])
    expect(parseFindHistory('abc')).toEqual([])
    expect(parseFindHistory({})).toEqual([])
  })

  it('正常字符串数组保序返回', () => {
    expect(parseFindHistory(['name', 'id'])).toEqual(['name', 'id'])
  })

  it('非字符串与空白元素跳过', () => {
    expect(parseFindHistory(['a', 1, null, true, {}, '  ', '\t\n', 'b'])).toEqual(['a', 'b'])
  })

  it('trim 后超 FIND_HISTORY_TEXT_MAX 的词跳过', () => {
    const long = 'x'.repeat(FIND_HISTORY_TEXT_MAX + 1)
    const ok = 'y'.repeat(FIND_HISTORY_TEXT_MAX)
    expect(parseFindHistory([long, ok])).toEqual([ok])
  })

  it('trim 后同词去重保序', () => {
    expect(parseFindHistory(['name', ' id ', 'name', 'id'])).toEqual(['name', 'id'])
  })

  it('超过 FIND_HISTORY_MAX 截断', () => {
    const words = Array.from({ length: FIND_HISTORY_MAX + 5 }, (_, i) => `w${i}`)
    expect(parseFindHistory(words)).toHaveLength(FIND_HISTORY_MAX)
    expect(parseFindHistory(words).slice(-1)).toEqual([`w${FIND_HISTORY_MAX - 1}`])
  })

  it('恰好 FIND_HISTORY_MAX 条全有效时原样返回', () => {
    const words = Array.from({ length: FIND_HISTORY_MAX }, (_, i) => `w${i}`)
    expect(parseFindHistory(words)).toEqual(words)
  })
})

describe('pushFindHistory', () => {
  it('trim 空不入并返回原数组浅拷贝', () => {
    const records = ['a', 'b']
    const out = pushFindHistory(records, '   ')
    expect(out).toEqual(['a', 'b'])
    expect(out).not.toBe(records)
  })

  it('trim 后超长不入', () => {
    const out = pushFindHistory(['a'], 'z'.repeat(FIND_HISTORY_TEXT_MAX + 1))
    expect(out).toEqual(['a'])
  })

  it('trim 后恰好 FIND_HISTORY_TEXT_MAX 的词接受（100/101 边界）', () => {
    const ok = 'y'.repeat(FIND_HISTORY_TEXT_MAX)
    expect(pushFindHistory(['a'], ok)).toEqual([ok, 'a'])
  })

  it('新词顶置', () => {
    expect(pushFindHistory(['a', 'b'], 'c')).toEqual(['c', 'a', 'b'])
  })

  it('同词移除后顶置', () => {
    expect(pushFindHistory(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
  })

  it('入词两侧空白被 trim', () => {
    expect(pushFindHistory(['a'], '  name  ')).toEqual(['name', 'a'])
  })

  it('超过 FIND_HISTORY_MAX 截断', () => {
    const records = Array.from({ length: FIND_HISTORY_MAX }, (_, i) => `w${i}`)
    const out = pushFindHistory(records, 'new')
    expect(out).toEqual(['new', ...records.slice(0, FIND_HISTORY_MAX - 1)])
  })

  it('满 FIND_HISTORY_MAX 条时重复词顶置且长度不变', () => {
    const records = Array.from({ length: FIND_HISTORY_MAX }, (_, i) => `w${i}`)
    const out = pushFindHistory(records, `w${FIND_HISTORY_MAX - 1}`)
    expect(out).toHaveLength(FIND_HISTORY_MAX)
    expect(out).toEqual([`w${FIND_HISTORY_MAX - 1}`, ...records.slice(0, FIND_HISTORY_MAX - 1)])
  })

  it('空历史记第一笔', () => {
    expect(pushFindHistory([], 'first')).toEqual(['first'])
  })
})
