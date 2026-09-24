import { describe, expect, it } from 'vitest'
import { filterItems, matchesWatch } from '../../../../src/plugins/hot-search/logic/filter'
import type { HotItem } from '../../../../src/plugins/hot-search/logic/types'

function item(title: string): HotItem {
  return { key: title, title, url: `https://example.com/${encodeURIComponent(title)}` }
}

const items = [item('小米18Pro价格'), item('张展硕200米自由泳破纪录夺冠'), item('iPhone 18 爆料'), item('哪吒2票房')]

describe('关注词过滤', () => {
  it('matchesWatch：大小写不敏感、命中任一关键词即真，空词不命中', () => {
    expect(matchesWatch('iPhone 18 爆料', ['iphone'])).toBe(true)
    expect(matchesWatch('哪吒2票房', ['乒乓'])).toBe(false)
    expect(matchesWatch('随便什么', [''])).toBe(false)
    expect(matchesWatch('  哪吒2票房 ', [' 哪吒 '])).toBe(true)
    expect(matchesWatch('张展硕200米自由泳破纪录夺冠', ['200米', '乒乓球'])).toBe(true)
  })

  it('query 按标题子串过滤（大小写不敏感）', () => {
    const out = filterItems(items, { query: 'IPHONE', watchOnly: false, watchKeywords: [] })
    expect(out.map((i) => i.title)).toEqual(['iPhone 18 爆料'])
  })

  it('只看关注：命中关注词的条目保留；无关注词时不过滤（避免死胡同）', () => {
    const out = filterItems(items, { query: '', watchOnly: true, watchKeywords: ['哪吒', '小米'] })
    expect(out.map((i) => i.title)).toEqual(['小米18Pro价格', '哪吒2票房'])
    const all = filterItems(items, { query: '', watchOnly: true, watchKeywords: [] })
    expect(all).toHaveLength(4)
  })

  it('query 与只看关注叠加取交集，空白 query 不参与', () => {
    const out = filterItems(items, { query: '票房', watchOnly: true, watchKeywords: ['iPhone', '哪吒'] })
    expect(out.map((i) => i.title)).toEqual(['哪吒2票房'])
    const blank = filterItems(items, { query: '   ', watchOnly: false, watchKeywords: [] })
    expect(blank).toHaveLength(4)
  })
})
