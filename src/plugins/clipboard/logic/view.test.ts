// 视图层纯逻辑单测：条目分类、固定/隐藏 UI 状态、demo 示例数据形态。
import { describe, expect, it } from 'vitest'
import type { ClipboardImageRecord, ClipboardTextRecord } from './history'
import {
  EMPTY_UI_STATE,
  buildDemoEntries,
  entryKindOf,
  filterByTab,
  hideRecord,
  orderRecords,
  parseUiState,
  pruneUiState,
  togglePin
} from './view'

let seq = 0
const textRec = (text: string, over: Partial<ClipboardTextRecord> = {}): ClipboardTextRecord => ({
  id: `t${++seq}`,
  kind: 'text',
  ts: 100,
  ...over,
  text
})
const imgRec = (over: Partial<ClipboardImageRecord> = {}): ClipboardImageRecord => ({
  id: `i${++seq}`,
  kind: 'image',
  ts: 100,
  hash: 'h',
  width: 8,
  height: 8,
  bytes: 8,
  dataUrl: null,
  ...over
})

describe('entryKindOf 条目分类', () => {
  it('图片记录恒为 image；多行文本恒为 text（含多行 URL/路径不误判）', () => {
    expect(entryKindOf(imgRec())).toBe('image')
    expect(entryKindOf(textRec('https://a.com\n第二行'))).toBe('text')
    expect(entryKindOf(textRec('/usr/bin\n/usr/local'))).toBe('text')
  })

  it('单行 http(s) URL 为 link（前后空白容忍）', () => {
    expect(entryKindOf(textRec('https://electronjs.org/docs'))).toBe('link')
    expect(entryKindOf(textRec('  http://a.com/x  '))).toBe('link')
  })

  it('绝对路径/file:///~/盘符为 file；单级 POSIX 与普通文本回落 text', () => {
    expect(entryKindOf(textRec('file:///Users/a/b.png'))).toBe('file')
    expect(entryKindOf(textRec('~/Documents/report.pdf'))).toBe('file')
    expect(entryKindOf(textRec('/Users/a/b/c.txt'))).toBe('file')
    expect(entryKindOf(textRec('C:\\Users\\a\\b.txt'))).toBe('file')
    expect(entryKindOf(textRec('/tmp'))).toBe('text')
    expect(entryKindOf(textRec('普通文本 123'))).toBe('text')
  })
})

describe('UI 状态（固定/隐藏）', () => {
  it('togglePin 新固定插到最前，再点取消', () => {
    let s = EMPTY_UI_STATE
    s = togglePin(s, 'a')
    s = togglePin(s, 'b')
    expect(s.pinned).toEqual(['b', 'a'])
    expect(togglePin(s, 'a').pinned).toEqual(['b'])
  })

  it('hideRecord 同时摘出 pinned；重复隐藏幂等（同引用）', () => {
    const s = togglePin(EMPTY_UI_STATE, 'a')
    const hidden = hideRecord(s, 'a')
    expect(hidden).toEqual({ pinned: [], hidden: ['a'] })
    expect(hideRecord(hidden, 'a')).toBe(hidden)
  })

  it('pruneUiState 清悬空 id；无变化返回原引用', () => {
    const alive = textRec('x')
    const s: { pinned: string[]; hidden: string[] } = { pinned: ['gone', alive.id], hidden: ['gone2'] }
    expect(pruneUiState(s, [alive])).toEqual({ pinned: [alive.id], hidden: [] })
    const clean = { pinned: [alive.id], hidden: [] }
    expect(pruneUiState(clean, [alive])).toBe(clean)
  })

  it('parseUiState 防御式解析：非对象/非字符串项丢弃', () => {
    expect(parseUiState(null)).toEqual(EMPTY_UI_STATE)
    expect(parseUiState('x')).toEqual(EMPTY_UI_STATE)
    expect(parseUiState({ pinned: ['a', 1, null], hidden: 'no' })).toEqual({ pinned: ['a'], hidden: [] })
  })
})

describe('排序与过滤', () => {
  const a = textRec('a', { id: 'a', ts: 300 })
  const b = textRec('b', { id: 'b', ts: 200 })
  const c = textRec('c', { id: 'c', ts: 100 })

  it('orderRecords 固定置顶、组内保持时间序；无固定项返回原引用', () => {
    expect(orderRecords([a, b, c], new Set(['c']))).toEqual([c, a, b])
    const untouched = [a, b]
    expect(orderRecords(untouched, new Set())).toBe(untouched)
  })

  it('filterByTab all 原样返回，其余按分类过滤', () => {
    const link = textRec('https://a.com', { id: 'l' })
    const img = imgRec({ id: 'im' })
    const all = [a, link, img]
    expect(filterByTab(all, 'all')).toBe(all)
    expect(filterByTab(all, 'link')).toEqual([link])
    expect(filterByTab(all, 'image')).toEqual([img])
    expect(filterByTab(all, 'text')).toEqual([a])
    expect(filterByTab(all, 'file')).toEqual([])
  })
})

describe('buildDemoEntries demo 示例数据', () => {
  const now = 1_700_000_000_000
  const { entries, pinnedIds } = buildDemoEntries(now)

  it('6 条、id 唯一、时间在入页时刻之前且 48h 内', () => {
    expect(entries).toHaveLength(6)
    expect(new Set(entries.map((e) => e.record.id)).size).toBe(6)
    for (const e of entries) {
      expect(e.record.ts).toBeLessThan(now)
      expect(e.record.ts).toBeGreaterThan(now - 48 * 3_600_000)
    }
  })

  it('构成 = 2 文本 + 1 链接 + 1 图片占位 + 1 文件 + 1 置顶（置顶单独计）', () => {
    const kinds = entries.map((e) => entryKindOf(e.record))
    const byKind = { text: 0, link: 0, image: 0, file: 0 } as Record<string, number>
    for (const k of kinds) byKind[k] += 1
    expect(byKind).toEqual({ text: 3, link: 1, image: 1, file: 1 })
    const image = entries.find((e) => e.record.kind === 'image')
    expect(image?.record.kind === 'image' && image.record.dataUrl).toBeNull()
  })

  it('置顶 id 指向存在的文本条目，且每个条目带来源应用示例值', () => {
    expect(pinnedIds).toEqual(['demo-pin'])
    expect(entries.some((e) => e.record.id === 'demo-pin' && e.record.kind === 'text')).toBe(true)
    for (const e of entries) expect(e.sourceApp.length).toBeGreaterThan(0)
  })
})
