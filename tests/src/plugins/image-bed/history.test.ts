import { describe, expect, it } from 'vitest'
import {
  addEntries,
  makeEntryId,
  normalizeHistory,
  normalizeHistoryEntry,
  removeEntry
} from '../../../../src/plugins/image-bed/logic/history'
import type { HistoryEntry } from '../../../../src/plugins/image-bed/logic/history'

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: makeEntryId(),
    url: 'https://a.com/x.png',
    filename: 'x.png',
    uploadedAt: 1000,
    providerId: 'smms',
    ...overrides
  }
}

describe('image-bed history', () => {
  it('新增置顶、按容量淘汰最旧', () => {
    const base = [entry({ id: 'old', uploadedAt: 1 }), entry({ id: 'mid', uploadedAt: 2 })]
    const next = addEntries(base, [entry({ id: 'new1', uploadedAt: 3 }), entry({ id: 'new2', uploadedAt: 4 })], 3)
    expect(next.map((e) => e.id)).toEqual(['new1', 'new2', 'old'])
    expect(addEntries(base, [entry({ id: 'new1' })], 2).map((e) => e.id)).toEqual(['new1', 'old'])
  })

  it('同 id 去重（与存量重复的新条目跳过，存量保留原位）', () => {
    const base = [entry({ id: 'a' }), entry({ id: 'b' })]
    const next = addEntries(base, [entry({ id: 'a' }), entry({ id: 'a' }), entry({ id: 'c' })], 10)
    expect(next.map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('按 id 删除', () => {
    const list = [entry({ id: 'a' }), entry({ id: 'b' })]
    expect(removeEntry(list, 'a').map((e) => e.id)).toEqual(['b'])
    expect(removeEntry(list, 'ghost')).toEqual(list)
  })

  it('脏条目丢弃：非对象/缺 http url/坏数字字段', () => {
    expect(normalizeHistoryEntry(null)).toBeNull()
    expect(normalizeHistoryEntry('x')).toBeNull()
    expect(normalizeHistoryEntry({ url: 'ftp://a' })).toBeNull()
    expect(normalizeHistoryEntry({ url: 'https://a.com/1.png', width: -5, bytes: 'big', thumb: 'javascript:alert(1)' })).toEqual({
      id: expect.any(String),
      url: 'https://a.com/1.png',
      filename: 'image',
      uploadedAt: 0,
      providerId: 'unknown'
    })
  })

  it('normalizeHistory 过滤 + 去重 + 封顶', () => {
    const raw = [
      { id: 'a', url: 'https://a.com/1.png' },
      { id: 'a', url: 'https://a.com/1.png' },
      'garbage',
      { id: 'b', url: 'https://a.com/2.png', filename: '2.png', uploadedAt: 5, thumb: 'data:image/jpeg;base64,AAA' }
    ]
    const out = normalizeHistory(raw, 2)
    expect(out.map((e) => e.id)).toEqual(['a', 'b'])
    expect(out[1].thumb).toBe('data:image/jpeg;base64,AAA')
    expect(out[0].thumb).toBeUndefined()
    expect(normalizeHistory(undefined)).toEqual([])
    expect(normalizeHistory('nope')).toEqual([])
  })

  it('id 形态：时间基 + 随机段', () => {
    const id = makeEntryId(123456789, 0.5)
    expect(id).toBe(`${(123456789).toString(36)}-${(0.5).toString(36).slice(2, 8)}`)
    expect(makeEntryId()).not.toBe(makeEntryId())
  })
})
