import { describe, expect, it } from 'vitest'
import {
  HISTORY_MAX_CHARS,
  HISTORY_MAX_ITEMS,
  normalizePinHistory,
  pushPinHistory,
  type PinHistoryItem
} from '../../../../src/plugins/float-image/logic/history'

const PNG = 'data:image/png;base64,'
const item = (n: number, len = 100): PinHistoryItem => ({
  dataUrl: `${PNG}${String(n)}${'a'.repeat(len)}`,
  label: `图${n}`,
  natural: { width: n * 10, height: n * 5 },
  thumb: `${PNG}${'t'.repeat(40)}`,
  at: 1700000000000 + n * 1000
})

describe('pushPinHistory', () => {
  it('新图置顶入列', () => {
    const got = pushPinHistory([item(1)], item(2))
    expect(got.map((x) => x.label)).toEqual(['图2', '图1'])
  })

  it('同图重复贴：去重并置顶，不产生重复行', () => {
    const got = pushPinHistory([item(1), item(2)], item(1))
    expect(got.map((x) => x.label)).toEqual(['图1', '图2'])
  })

  it('条数封顶从最旧（尾部）丢', () => {
    const base = Array.from({ length: HISTORY_MAX_ITEMS }, (_, i) => item(i + 1))
    const got = pushPinHistory(base, item(99))
    expect(got).toHaveLength(HISTORY_MAX_ITEMS)
    expect(got[0]?.label).toBe('图99')
    expect(got.some((x) => x.label === `图${HISTORY_MAX_ITEMS}`)).toBe(false)
  })

  it('总字符封顶从最旧丢（大图挤掉旧图）', () => {
    const small = Array.from({ length: 5 }, (_, i) => item(i + 1, 100))
    const big = item(99, 4_799_800)
    const got = pushPinHistory(small, big, HISTORY_MAX_ITEMS, 4_800_000)
    expect(got[0]?.label).toBe('图99')
    expect(got.length).toBeLessThan(small.length + 1)
    const total = got.reduce((s, x) => s + x.dataUrl.length + x.thumb.length, 0)
    expect(total).toBeLessThanOrEqual(4_800_000)
  })

  it('单条自身超总预算不入列：存量 12 条全保留，不连自身弹空', () => {
    const base = Array.from({ length: HISTORY_MAX_ITEMS }, (_, i) => item(i + 1))
    const oversized = item(99, HISTORY_MAX_CHARS)
    expect(oversized.dataUrl.length + oversized.thumb.length).toBeGreaterThan(HISTORY_MAX_CHARS)
    const got = pushPinHistory(base, oversized)
    expect(got).toEqual(base)
  })

  it('正常大小大图照旧入列并从最旧淘汰（回归）', () => {
    const base = Array.from({ length: HISTORY_MAX_ITEMS }, (_, i) => item(i + 1, 300_000))
    const big = item(99, 3_000_000)
    const got = pushPinHistory(base, big)
    expect(got[0]?.label).toBe('图99')
    expect(got.some((x) => x.label === '图1')).toBe(true)
    const total = got.reduce((s, x) => s + x.dataUrl.length + x.thumb.length, 0)
    expect(total).toBeLessThanOrEqual(HISTORY_MAX_CHARS)
  })
})

describe('normalizePinHistory', () => {
  it('非法载荷/字段缺失的条目整条丢弃', () => {
    const good = item(1)
    const got = normalizePinHistory([
      good,
      { ...good, dataUrl: 'javascript:alert(1)' },
      { ...good, dataUrl: 123 },
      { ...good, natural: { width: 0, height: 5 } },
      'junk',
      null
    ])
    expect(got).toHaveLength(1)
    expect(got[0]?.label).toBe('图1')
  })

  it('label 缺省回退、thumb 非法置空、at 非数字归零', () => {
    const got = normalizePinHistory([{ ...item(1), label: '', thumb: 'not-a-data-url', at: 'x' }])
    expect(got[0]?.label).toBe('悬浮图片')
    expect(got[0]?.thumb).toBe('')
    expect(got[0]?.at).toBe(0)
  })

  it('非数组输入返回空表', () => {
    expect(normalizePinHistory(null)).toEqual([])
    expect(normalizePinHistory('x')).toEqual([])
  })
})
