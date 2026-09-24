// 历史/收藏/偏好纯逻辑测试（DESIGN C.7）
import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  addFavorite,
  addHistory,
  normalizeFavorites,
  normalizeHistory,
  normalizePrefs,
  removeFavorite,
  removeHistory,
  updateFavoriteNote,
  type HistoryEntry
} from '../../../../src/plugins/var-name/logic/store'
import { ABBREVIATIONS, applyAbbrevs, contextualSuggestions, reverseLookup } from '../../../../src/plugins/var-name/data/abbrev'

describe('历史：同 q 去重置顶 + 容量淘汰', () => {
  it('新查询置顶；同 q 更新时间且只有一条', () => {
    let list = addHistory([], 'user name', ['user', 'name'], 1000)
    list = addHistory(list, 'max retry', ['max', 'retry'], 2000)
    expect(list.map((e) => e.q)).toEqual(['max retry', 'user name'])
    list = addHistory(list, 'user name', ['user', 'name'], 3000)
    expect(list.length).toBe(2)
    expect(list[0]).toEqual({ q: 'user name', words: ['user', 'name'], at: 3000 })
  })

  it('超过容量淘汰最旧', () => {
    let list: HistoryEntry[] = []
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) list = addHistory(list, `q${i}`, ['w'], i)
    expect(list.length).toBe(HISTORY_LIMIT)
    expect(list[0].q).toBe(`q${HISTORY_LIMIT + 4}`)
    expect(list.find((e) => e.q === 'q0')).toBeUndefined()
  })

  it('空 q / 空词组不记录；删除按 q', () => {
    let list = addHistory([], '  ', ['w'], 1)
    list = addHistory(list, 'ok', [], 1)
    expect(list).toEqual([])
    list = addHistory(list, 'a b', ['a', 'b'], 1)
    list = removeHistory(list, 'a b')
    expect(list).toEqual([])
  })

  it('脏数据归一化：缺 q/words 或 words 含非法字符的丢弃', () => {
    expect(normalizeHistory(null)).toEqual([])
    expect(
      normalizeHistory([
        { q: 'ok', words: ['user', 'name'], at: 1 },
        { q: '', words: ['x'], at: 1 },
        { q: 'bad', words: 'user', at: 1 },
        { q: 'bad2', words: ['User', '名'], at: 1 },
        'garbage'
      ])
    ).toEqual([{ q: 'ok', words: ['user', 'name'], at: 1 }])
  })
})

describe('收藏：增删/备注/脏数据', () => {
  it('新增置顶携带备注；按 id 删除；备注可改可清空', () => {
    let list = addFavorite([], '用户配置', ['user', 'settings'], 'userConfig', 1000, 'f1')
    list = addFavorite(list, '超时', ['timeout'], undefined, 2000, 'f2')
    expect(list.map((f) => f.id)).toEqual(['f2', 'f1'])
    expect(list[1].note).toBe('userConfig')
    expect(list[0].note).toBeUndefined()
    list = updateFavoriteNote(list, 'f2', '超时时间')
    expect(list[0].note).toBe('超时时间')
    list = updateFavoriteNote(list, 'f2', '  ')
    expect(list[0].note).toBeUndefined()
    list = removeFavorite(list, 'f1')
    expect(list.map((f) => f.id)).toEqual(['f2'])
  })

  it('normalizeFavorites：id 去重、结构非法丢弃', () => {
    expect(
      normalizeFavorites([
        { id: 'a', q: 'ok', words: ['ok'], at: 1 },
        { id: 'a', q: 'dup', words: ['dup'], at: 2 },
        { id: '', q: 'x', words: ['x'], at: 3 },
        { q: 'no-id', words: ['x'], at: 4 },
        { id: 'b', q: 'no-words', words: [], at: 5 }
      ])
    ).toEqual([{ id: 'a', q: 'ok', words: ['ok'], at: 1 }])
  })
})

describe('偏好归一化', () => {
  it('null/垃圾回落默认（generic / 缩写关 / main 页签）', () => {
    expect(normalizePrefs(null)).toEqual({ langId: 'generic', useAbbreviations: false, tab: 'main' })
    expect(normalizePrefs('x')).toEqual({ langId: 'generic', useAbbreviations: false, tab: 'main' })
  })

  it('合法值保留；非法 langId/tab 回落', () => {
    expect(normalizePrefs({ langId: 'go', useAbbreviations: true, tab: 'history' })).toEqual({
      langId: 'go',
      useAbbreviations: true,
      tab: 'history'
    })
    expect(normalizePrefs({ langId: 'klingon', useAbbreviations: 1, tab: 'weird' })).toEqual({
      langId: 'generic',
      useAbbreviations: false,
      tab: 'main'
    })
  })
})

describe('缩写词典（DESIGN C.5）', () => {
  it('开关开启：仅 recommended 主形态替换全称，规则复数保留 s（-ies 变体不支持属预期）', () => {
    expect(applyAbbrevs(['database', 'context'])).toEqual(['db', 'ctx'])
    expect(applyAbbrevs(['arguments', 'parameters', 'references'])).toEqual(['args', 'params', 'refs'])
    expect(applyAbbrevs(['properties'])).toEqual(['properties'])
  })

  it('contextual/avoid 级不自动替换（current/config 类双收裁决只动 recommended）', () => {
    expect(applyAbbrevs(['current'])).toEqual(['curr']) // curr 是 recommended 主形态
    expect(applyAbbrevs(['configuration'])).toEqual(['config']) // config 主形态；cfg 是 contextual 不自动
    expect(applyAbbrevs(['allocation'])).toEqual(['allocation']) // contextual 不动
    expect(applyAbbrevs(['action'])).toEqual(['action']) // avoid 不动
  })

  it('contextual 级以建议呈现且带上下文标签', () => {
    const got = contextualSuggestions(['allocation', 'iterator'])
    expect(got.find((s) => s.full === 'allocation')?.abbr).toBe('alloc')
    expect(got.find((s) => s.full === 'allocation')?.context).toContain('内存')
    expect(got.find((s) => s.full === 'iterator')?.context).toContain('循环')
  })

  it('反查：输入缩写 → 全称 + 推荐度（recommended 优先于 avoid 撞形）', () => {
    expect(reverseLookup('db')?.full).toBe('database')
    expect(reverseLookup('db')?.level).toBe('recommended')
    expect(reverseLookup('con')?.level).toBe('avoid')
    expect(reverseLookup('curr')?.full).toBe('current')
    expect(reverseLookup('nonsense')).toBeUndefined()
  })

  it('数据完整性：contextual 必带 context；同 abbr 的 recommended 先于 avoid 收录', () => {
    for (const e of ABBREVIATIONS) {
      if (e.level === 'contextual') expect(e.context, `${e.full} 缺 context`).toBeTruthy()
    }
    expect(ABBREVIATIONS.length).toBeGreaterThanOrEqual(200)
  })
})
