import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  MAX_ITEMS_PER_BOARD,
  normalizeSettings,
  parseCache,
  toCache,
  type HotItem
} from '../../../../src/plugins/hot-search/logic/types'

function item(key: string): HotItem {
  return { key, title: key, url: `https://example.com/${encodeURIComponent(key)}` }
}

describe('normalizeSettings（storage 坏数据回落默认值）', () => {
  it('null/非对象/缺字段回落默认值', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('x')).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ autoRefreshMin: 999 })).toEqual(DEFAULT_SETTINGS) // 非法间隔回落 5 分钟
  })

  it('合法值透传，关注词去空白/去重（大小写不敏感）/限量', () => {
    const out = normalizeSettings({
      watchKeywords: ['小米', ' 小米 ', '', 'iPhone', 'iphone'],
      watchOnly: true,
      autoRefreshMin: 3
    })
    expect(out).toEqual({ watchKeywords: ['小米', 'iPhone'], watchOnly: true, autoRefreshMin: 3 })
  })

  it('关注词超量截断到 50', () => {
    const out = normalizeSettings({ watchKeywords: Array.from({ length: 80 }, (_, i) => `k${i}`) })
    expect(out.watchKeywords).toHaveLength(50)
  })
})

describe('parseCache（storage 读回逐层校验）', () => {
  it('null/缺 version/坏 boards 结构返回 null', () => {
    expect(parseCache(null)).toBeNull()
    expect(parseCache({ boards: {} })).toBeNull()
    expect(parseCache({ version: 2, boards: {} })).toBeNull()
    expect(parseCache({ version: 1, boards: [] })).toBeNull()
  })

  it('条目缺 key/title/url 或榜单为空则整块丢弃，全不可信返回 null', () => {
    expect(parseCache({ version: 1, boards: { weibo: { fetchedAt: 1, items: [{ key: 'a', title: 'a' }] } } })).toBeNull()
    expect(parseCache({ version: 1, boards: { weibo: { fetchedAt: 1, items: [] } } })).toBeNull()
    expect(parseCache({ version: 1, boards: { weibo: { items: [item('a')] } } })).toBeNull() // 缺 fetchedAt
  })

  it('合法缓存透传并保留 isNew 标记（重启后『新』标记延续到下次刷新）', () => {
    const cache = parseCache({
      version: 1,
      boards: {
        weibo: { fetchedAt: 123, items: [item('a'), { ...item('b'), isNew: true }] },
        bad: { fetchedAt: 'x', items: [item('c')] } // 坏平台整块丢弃
      }
    })
    expect(cache).not.toBeNull()
    expect(Object.keys(cache!.boards)).toEqual(['weibo'])
    expect(cache!.boards.weibo.items[1].isNew).toBe(true)
  })
})

describe('toCache（写入前截断）', () => {
  it('每平台条数截断到 MAX_ITEMS_PER_BOARD，字段保序', () => {
    const many = Array.from({ length: MAX_ITEMS_PER_BOARD + 30 }, (_, i) => item(`k${i}`))
    const cache = toCache({ weibo: { fetchedAt: 9, items: many } })
    expect(cache.version).toBe(1)
    expect(cache.boards.weibo.items).toHaveLength(MAX_ITEMS_PER_BOARD)
    expect(cache.boards.weibo.items[0].key).toBe('k0')
    expect(cache.boards.weibo.fetchedAt).toBe(9)
  })
})
