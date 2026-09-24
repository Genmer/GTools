import { describe, expect, it } from 'vitest'
import { ALL_ENTRIES, ENTRY_BY_ID } from '../../../../src/plugins/dev-manual/data'
import { favoriteEntries, normalizeFavorites, toggleFavorite } from '../../../../src/plugins/dev-manual/logic/favorites'

const byId = ENTRY_BY_ID

describe('dev-manual favorites', () => {
  it('normalizeFavorites 只认结构合法的 ids，去重保序', () => {
    expect(normalizeFavorites(null)).toEqual([])
    expect(normalizeFavorites(undefined)).toEqual([])
    expect(normalizeFavorites('x')).toEqual([])
    expect(normalizeFavorites({})).toEqual([])
    expect(normalizeFavorites({ v: 1, ids: 'not-array' })).toEqual([])
    expect(normalizeFavorites({ v: 1, ids: ['a', '', 3, 'a', 'b'] })).toEqual(['a', 'b'])
  })

  it('toggleFavorite 增删幂等', () => {
    expect(toggleFavorite([], 'x')).toEqual(['x'])
    expect(toggleFavorite(['a', 'x'], 'x')).toEqual(['a'])
    expect(toggleFavorite(toggleFavorite(['a'], 'b'), 'b')).toEqual(['a'])
  })

  it('favoriteEntries 按收藏顺序输出并过滤失效 id', () => {
    const first = ALL_ENTRIES[5]
    const second = ALL_ENTRIES[0]
    const ids = [first.id, 'gone:removed', second.id]
    const list = favoriteEntries(ids, byId)
    expect(list.map((e) => e.id)).toEqual([first.id, second.id])
    expect(byId.get('gone:removed')).toBeUndefined()
  })
})
