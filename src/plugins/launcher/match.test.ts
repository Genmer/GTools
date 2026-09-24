// 应用名匹配评分单测：pinyin 音节/首字母对齐（期望值已按 pinyin-pro 实际输出校准）。
import { describe, expect, it } from 'vitest'
import { filterApps, indexName, matchName } from './match'
import type { AppEntry } from './types'

const app = (name: string, path = `/${name}.app`): AppEntry => ({ name, path })
const names = (result: { app: AppEntry }[]): string[] => result.map((r) => r.app.name)

describe('indexName', () => {
  it('中文转无声调音节数组，英文单词整体保留', () => {
    expect(indexName('微信')).toEqual({ lower: '微信', syllables: ['wei', 'xin'], initials: 'wx' })
    expect(indexName('Chrome')).toEqual({ lower: 'chrome', syllables: ['Chrome'], initials: 'chrome' })
    expect(indexName('网易云音乐')).toMatchObject({ initials: 'wyyyy' })
  })

  it('同名缓存命中（同一引用）', () => {
    expect(indexName('缓存探测')).toBe(indexName('缓存探测'))
  })
})

describe('matchName 评分', () => {
  it('空查询恒 0 分；前缀命中 0 分；中缀命中加位次与惩罚', () => {
    expect(matchName('', indexName('Safari'))).toBe(0)
    expect(matchName('safari', indexName('Safari'))).toBe(0)
    expect(matchName('afari', indexName('Safari'))).toBe(500 + 10) // pos 1
    expect(matchName('der', indexName('Finder'))).toBe(500 + 30) // pos 3
  })

  it('查询大小写不敏感', () => {
    expect(matchName('SAFARI', indexName('Safari'))).toBe(0)
  })

  it('全拼音节对齐：完整消耗或终止于音节内部前缀', () => {
    expect(matchName('weixin', indexName('微信'))).toBe(10_000)
    expect(matchName('weix', indexName('微信'))).toBe(10_000) // wei + xin 的前缀 x
    expect(matchName('geshi', indexName('格式化'))).toBe(10_000) // ge + shi 前缀
    expect(matchName('jisuanq', indexName('计算器'))).toBe(10_000) // ji + suan + qi 的前缀 q
    expect(matchName('weixinn', indexName('微信'))).toBeNull() // 多余字符无法消耗
    expect(matchName('jisq', indexName('计算器'))).toBeNull() // 音节内部前缀只允许出现在最后一个音节
  })

  it('从中间音节起对齐也命中（分数带起始位次惩罚）', () => {
    const idx = indexName('网易云音乐')
    expect(matchName('yiyun', idx)).toBe(10_000 + 10) // 从第 2 个音节 yi 起
    expect(matchName('yunyin', idx)).toBe(10_000 + 20)
  })

  it('首字母子序列：span 为首尾距离，跳跃越远分数越高', () => {
    expect(matchName('wx', indexName('微信'))).toBe(20_001) // first 0, span 1（连续）
    expect(matchName('wyy', indexName('网易云音乐'))).toBe(20_002) // first 0, span 2（跳过 yi）
    expect(matchName('wyyyy', indexName('网易云音乐'))).toBe(20_004) // first 0, span 4（5 字符连续命中）
  })

  it('匹配不上返回 null', () => {
    expect(matchName('zzzz', indexName('微信'))).toBeNull()
    expect(matchName('qq', indexName('Chrome'))).toBeNull()
    expect(matchName('纯英文查询对中文', indexName('微信'))).toBeNull()
  })
})

describe('filterApps 过滤排序', () => {
  const apps = [app('网易云音乐'), app('Chrome'), app('微信'), app('微信读书')]

  it('空查询原样全量返回 score 0，顺序保持', () => {
    const result = filterApps('  ', apps)
    expect(names(result)).toEqual(['网易云音乐', 'Chrome', '微信', '微信读书'])
    expect(result.every((r) => r.score === 0)).toBe(true)
  })

  it('拼音匹配按分数排序，同分按名长', () => {
    const result = filterApps('w', apps)
    expect(names(result)).toEqual(['微信', '微信读书', '网易云音乐'])
  })

  it('字面前缀优先于中缀与拼音', () => {
    const result = filterApps('chrome', [app('微信'), app('Chrome'), app('I love Chrome')])
    expect(names(result)).toEqual(['Chrome', 'I love Chrome'])
  })

  it('无命中返回空数组', () => {
    expect(filterApps('nomatch', apps)).toEqual([])
  })

  it('查询先 trim 再匹配（前后空白不影响）', () => {
    expect(names(filterApps(' weixin ', apps))).toEqual(['微信', '微信读书']) // 读书也含 weixin 音节前缀
  })
})
