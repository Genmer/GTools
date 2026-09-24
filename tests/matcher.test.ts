import { describe, expect, it } from 'vitest'
import { matchEntry, sortMatches } from '../src/renderer/src/core/matcher'
import type { PinyinIndexed, SearchEntry } from '../src/renderer/src/core/matcher'
import { matchEntryBest } from '../src/renderer/src/core/pinyin-index'
import { buildAppEntries } from '../src/renderer/src/core/entries'

const entry = (title: string, extra: Partial<SearchEntry> = {}): SearchEntry => ({
  key: `k:${title}`,
  title,
  icon: '🔧',
  pluginId: 'test',
  ...extra
})

// 手工构造索引：音节数据不依赖 pinyin-pro，锁死匹配算法行为
const jsonIdx = (title: string, syllables: string[], initials: string): PinyinIndexed => ({
  lower: title.toLowerCase(),
  syllables,
  initials
})

describe('matcher 四路匹配（手工索引）', () => {
  const e = entry('JSON 格式化')
  const idx = jsonIdx('JSON 格式化', ['json', ' ', 'ge', 'shi', 'hua'], 'json gsh')

  it('规则1：英文原文子串 json 命中，前缀位置得分低', () => {
    const s = matchEntry('json', e, idx)
    expect(s).not.toBeNull()
    expect(s!).toBeLessThan(10_000)
  })

  it('规则1：中文子串「格式化」命中', () => {
    expect(matchEntry('格式化', e, idx)).not.toBeNull()
  })

  it('规则2：全拼音节 geshi 按音节边界对齐命中', () => {
    const s = matchEntry('geshi', e, idx)
    expect(s).not.toBeNull()
    expect(s!).toBeGreaterThanOrEqual(10_000)
    expect(s!).toBeLessThan(20_000)
  })

  it('规则2：未对齐音节边界的拼音串不命中（gesh 跨界截断仍允许，gsh 误拼不中音节路）', () => {
    // 'gsh' 不是音节贪心序列（ge|shi 起点对齐失败），走规则3
    const s = matchEntry('gsrh', e, idx)
    expect(s).toBeNull()
  })

  it('规则3：首字母非连续子序列命中（kfz ⊆ kfzgj）', () => {
    const kfz = entry('开发者工具')
    const kfzIdx = jsonIdx('开发者工具', ['kai', 'fa', 'zhe', 'gong', 'ju'], 'kfzgj')
    const s = matchEntry('kfz', kfz, kfzIdx)
    expect(s).not.toBeNull()
    expect(s!).toBeGreaterThanOrEqual(20_000)
  })

  it('无命中返回 null', () => {
    expect(matchEntry('zzzz', e, idx)).toBeNull()
  })

  it('排序：规则1 < 规则2 < 规则3', () => {
    const kai = entry('开发者工具')
    const kaiIdx = jsonIdx('开发者工具', ['kai', 'fa', 'zhe', 'gong', 'ju'], 'kfzgj')
    const s1 = matchEntry('json', e, idx)!
    const s2 = matchEntry('geshi', e, idx)!
    const s3 = matchEntry('kfz', kai, kaiIdx)!
    const sorted = sortMatches([
      { score: s3 },
      { score: s1 },
      { score: s2 }
    ])
    expect(sorted.map((x) => x.score)).toEqual([s1, s2, s3])
  })
})

describe('matcher + pinyin-pro 集成（真实拼音数据）', () => {
  it('pinyinIndex 产出的索引使 geshi 命中「JSON 格式化」', () => {
    const e = entry('JSON 格式化')
    expect(matchEntryBest('geshi', e)).not.toBeNull()
    expect(matchEntryBest('json', e)).not.toBeNull()
    expect(matchEntryBest('格式化', e)).not.toBeNull()
  })

  it('kfz 命中「开发者工具」，gsh 命中「JSON 格式化」', () => {
    expect(matchEntryBest('kfz', entry('开发者工具'))).not.toBeNull()
    // DESIGN §7.1：gsrh 为笔误（应为 gsh），按可实现规则 gsh 必中
    expect(matchEntryBest('gsh', entry('JSON 格式化'))).not.toBeNull()
  })

  it('keywords 额外匹配词参与命中（sz 命中「设置」词条）', () => {
    expect(matchEntryBest('sz', entry('设置', { keywords: ['settings', 'shezhi', 'sz'] }))).not.toBeNull()
    expect(matchEntryBest('shezhi', entry('设置', { keywords: ['settings', 'shezhi', 'sz'] }))).not.toBeNull()
  })

  it('空 query 返回 0 分（全量展示）', () => {
    expect(matchEntryBest('', entry('任意'))).toBe(0)
  })

  it('100 词条规模全量匹配在毫秒级', () => {
    const entries = Array.from({ length: 100 }, (_, i) => entry(`词条${i}工具${i}`))
    const start = performance.now()
    for (const e of entries) matchEntryBest('gongju', e)
    const cost = performance.now() - start
    expect(cost).toBeLessThan(100)
  })

  it('本机应用检索：支持中文、拼音、首字母及英文别名', () => {
    const appEntries = buildAppEntries([
      { id: 'com.tencent.xinWeChat', name: '微信', path: '/Applications/WeChat.app', bundleId: 'com.tencent.xinWeChat' },
      { id: 'com.google.Chrome', name: 'Google Chrome', path: '/Applications/Google Chrome.app' },
      { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' }
    ])

    const wx = appEntries.find((e) => e.appId === 'com.tencent.xinWeChat')!
    expect(matchEntryBest('微信', wx)).not.toBeNull()
    expect(matchEntryBest('weixin', wx)).not.toBeNull()
    expect(matchEntryBest('wx', wx)).not.toBeNull()
    expect(matchEntryBest('wechat', wx)).not.toBeNull()

    const chrome = appEntries.find((e) => e.appId === 'com.google.Chrome')!
    expect(matchEntryBest('chrome', chrome)).not.toBeNull()
    expect(matchEntryBest('gc', chrome)).not.toBeNull()

    const vscode = appEntries.find((e) => e.appId === 'com.microsoft.VSCode')!
    expect(matchEntryBest('code', vscode)).not.toBeNull()
    expect(matchEntryBest('vscode', vscode)).not.toBeNull()
  })
})
