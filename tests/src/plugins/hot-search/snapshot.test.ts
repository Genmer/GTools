import { describe, expect, it } from 'vitest'
import { markNew, toKeys } from '../../../../src/plugins/hot-search/logic/snapshot'
import type { HotItem } from '../../../../src/plugins/hot-search/logic/types'

function item(key: string, extra: Partial<HotItem> = {}): HotItem {
  return { key, title: key, url: `https://example.com/${encodeURIComponent(key)}`, ...extra }
}

describe('快照对比『新上榜』标记', () => {
  it('prevKeys 为空（首次拉取）时全部不标新', () => {
    const out = markNew([item('a'), item('b')], [])
    expect(out.map((i) => i.isNew)).toEqual([false, false])
  })

  it('上一轮没有的条目标『新』，已有的不标', () => {
    const prev = [item('a'), item('b')]
    const current = [item('c'), item('a'), item('b'), item('d')]
    const out = markNew(current, toKeys(prev))
    expect(out.map((i) => [i.key, i.isNew === true])).toEqual([
      ['c', true],
      ['a', false],
      ['b', false],
      ['d', true]
    ])
  })

  it('不修改入参（纯函数），新列表是浅拷贝', () => {
    const current = [item('a', { isNew: true })]
    const out = markNew(current, ['a'])
    expect(out[0].isNew).toBe(false)
    expect(current[0].isNew).toBe(true)
  })

  it('toKeys 提取稳定键序列', () => {
    expect(toKeys([item('x'), item('y')])).toEqual(['x', 'y'])
    expect(toKeys([])).toEqual([])
  })
})
