import { describe, expect, it } from 'vitest'
import { filterApps, indexName, matchName } from '../../../../src/plugins/launcher/match'
import type { AppEntry } from '../../../../src/plugins/launcher/types'

const apps: AppEntry[] = [
  { name: 'Safari', path: '/Applications/Safari.app' },
  { name: '微信', path: '/Applications/WeChat.app' },
  { name: '微信读书', path: '/Applications/WeChatReader.app' },
  { name: 'Google Chrome', path: '/Applications/Google Chrome.app' },
  { name: '网易云音乐', path: '/Applications/NeteaseMusic.app' },
  { name: 'wxTool', path: '/Applications/wxTool.app' }
]

describe('应用名拼音/英文模糊匹配', () => {
  it('英文子串命中（大小写不敏感）', () => {
    expect(filterApps('saf', apps).map((r) => r.app.name)).toEqual(['Safari'])
    expect(filterApps('chrome', apps).map((r) => r.app.name)).toEqual(['Google Chrome'])
  })

  it('中文子串命中', () => {
    expect(filterApps('微信', apps).map((r) => r.app.name)).toEqual(['微信', '微信读书'])
  })

  it('全拼命中（音节对齐，含音节内部前缀）', () => {
    expect(filterApps('weixin', apps).map((r) => r.app.name)).toEqual(['微信', '微信读书'])
    expect(filterApps('weixin', apps)[0].app.name).toBe('微信') // 同分时短名优先
    expect(filterApps('yinyue', apps).map((r) => r.app.name)).toEqual(['网易云音乐'])
    expect(filterApps('geshi', apps)).toEqual([])
  })

  it('首字母子序列命中', () => {
    // 原文子串优先于首字母；'wx' 同时是 'wxds'（微信读书）的首字母子序列
    expect(filterApps('wx', apps).map((r) => r.app.name)).toEqual(['wxTool', '微信', '微信读书'])
    expect(filterApps('wyyy', apps).map((r) => r.app.name)).toEqual(['网易云音乐'])
  })

  it('空查询返回全部（缓存序），无命中返回空', () => {
    expect(filterApps('', apps)).toHaveLength(6)
    expect(filterApps('', apps).every((r) => r.score === 0)).toBe(true)
    expect(filterApps('zzzzz', apps)).toEqual([])
  })

  it('indexName：音节数组与首字母串', () => {
    const idx = indexName('微信')
    expect(idx.lower).toBe('微信')
    expect(idx.syllables).toEqual(['wei', 'xin'])
    expect(idx.initials).toBe('wx')
  })

  it('matchName 评分规则序：原文 < 全拼 < 首字母', () => {
    const wx = matchName('wx', indexName('wxTool'))!
    const pinyin = matchName('weixin', indexName('微信'))!
    const initial = matchName('wx', indexName('微信'))!
    expect(wx).toBeLessThan(pinyin)
    expect(pinyin).toBeLessThan(initial)
  })
})
