import { afterEach, describe, expect, it, vi } from 'vitest'
import { matchEntryBest, pinyinIndex, warmupPinyinIndex } from '../src/renderer/src/core/pinyin-index'
import type { SearchEntry } from '../src/renderer/src/core/matcher'

const entry = (title: string): SearchEntry => ({ key: `k:${title}`, title, icon: '🔧', pluginId: 'test' })

// 黄金值与旧「两次 pinyin() 调用」口径逐字一致（合并为单次 type:'all' 后不回归）
describe('pinyinIndex 单次调用合并（type:all 重建全拼与首字母）', () => {
  it('纯中文：全拼音节与首字母', () => {
    const idx = pinyinIndex('微信')
    expect(idx.syllables).toEqual(['wei', 'xin'])
    expect(idx.initials).toBe('wx')
    expect(idx.lower).toBe('微信')
  })

  it('中英混排：非中文按连续段整体保留（含尾随空格），首字母英文保留原文', () => {
    const idx = pinyinIndex('JSON 格式化')
    expect(idx.syllables).toEqual(['JSON ', 'ge', 'shi', 'hua'])
    expect(idx.initials).toBe('json gsh')
  })

  it('英文紧贴中文：json 段不拆散、不逐字母化', () => {
    const idx = pinyinIndex('json格式化')
    expect(idx.syllables).toEqual(['json', 'ge', 'shi', 'hua'])
    expect(idx.initials).toBe('jsongsh')
  })

  it('compact 去全部空白', () => {
    expect(pinyinIndex('PDF 工具').compact).toBe('pdf工具')
  })

  it('同 title 复用缓存（同引用）', () => {
    expect(pinyinIndex('计算器')).toBe(pinyinIndex('计算器'))
  })

  it('matchEntryBest 经合并索引仍按首字母路命中', () => {
    expect(matchEntryBest('jsq', entry('计算器'))).not.toBeNull()
  })
})

describe('warmupPinyinIndex 空闲预建', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('分批建索引，建完即停，重复调用已建标题不再排程（node 无 requestIdleCallback，走 setTimeout 路）', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'setTimeout')
    const titles = Array.from({ length: 90 }, (_, i) => `预建词条${i}`) // 批大小 40 → 40+40+10 共 3 批

    warmupPinyinIndex(titles)
    expect(spy).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(16)
    expect(spy).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(16)
    expect(spy).toHaveBeenCalledTimes(3)
    vi.advanceTimersByTime(16)
    expect(spy).toHaveBeenCalledTimes(3) // 全部建完不再续排

    warmupPinyinIndex(titles) // 已全部入缓存：不触发新排程
    expect(spy).toHaveBeenCalledTimes(3)
    expect(pinyinIndex('预建词条0')).toBe(pinyinIndex('预建词条0'))
  })

  it('空标题不排队', () => {
    vi.useFakeTimers()
    const spy = vi.spyOn(globalThis, 'setTimeout')
    warmupPinyinIndex(['', ''])
    expect(spy).not.toHaveBeenCalled()
  })
})
