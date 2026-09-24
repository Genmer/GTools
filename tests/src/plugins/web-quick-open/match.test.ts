import { describe, expect, it } from 'vitest'
import {
  filterSites,
  indexText,
  matchSite,
  pinKeys,
  resolvePin
} from '../../../../src/plugins/web-quick-open/match'
import { BUILTIN_SITES, type SiteEntry } from '../../../../src/plugins/web-quick-open/sites'

function site(partial: Partial<SiteEntry> & Pick<SiteEntry, 'id' | 'name' | 'url'>): SiteEntry {
  return { category: 'custom', ...partial }
}

const taobao = site({
  id: 'custom-taobao',
  name: '淘宝',
  url: 'https://www.taobao.com',
  searchUrl: 'https://s.taobao.com/search?q={}',
  aliases: ['tb']
})

describe('indexText 拼音索引（锁定 pinyin-pro 行为）', () => {
  it('中文名：全拼数组的音节切分 + 首字母拼接', () => {
    expect(indexText('百度').syllables).toEqual(['bai', 'du'])
    expect(indexText('百度').initials).toBe('bd')
    expect(indexText('哔哩哔哩').initials).toBe('blbl')
    expect(indexText('腾讯视频').initials).toBe('txsp')
  })

  it('英文名整体保留（nonZh consecutive），不逐字母拆音节', () => {
    expect(indexText('GitHub').syllables).toEqual(['GitHub'])
    expect(indexText('Stack Overflow').syllables).toEqual(['Stack Overflow'])
    expect(indexText('Stack Overflow').lower).toBe('stack overflow')
  })
})

describe('matchSite 站点匹配', () => {
  it('原文 / 全拼 / 首字母 / 别名 / host 各路径命中', () => {
    const byId = (id: string): SiteEntry => BUILTIN_SITES.find((s) => s.id === id) as SiteEntry
    expect(matchSite('百度', byId('baidu'))).not.toBeNull()
    expect(matchSite('baidu', byId('baidu'))).not.toBeNull()
    expect(matchSite('bd', byId('baidu'))).not.toBeNull()
    expect(matchSite('blbl', byId('bilibili'))).not.toBeNull()
    expect(matchSite('bili', byId('bilibili'))).not.toBeNull()
    expect(matchSite('zhihu', byId('zhihu'))).not.toBeNull()
    expect(matchSite('github.com', byId('github'))).not.toBeNull()
    expect(matchSite('taobao', taobao)).not.toBeNull()
    expect(matchSite('tb', taobao)).not.toBeNull()
    expect(matchSite('完全不相关', byId('github'))).toBeNull()
  })

  it('别名/host 前缀命中优先于首字母子序列（分值更低）', () => {
    const byId = (id: string): SiteEntry => BUILTIN_SITES.find((s) => s.id === id) as SiteEntry
    expect(matchSite('bd', byId('baidu'))).toBe(0) // 别名精确命中
    expect(matchSite('baidu', byId('baidu'))).toBe(0) // host baidu.com 前缀命中
    expect(matchSite('blbl', byId('bilibili'))).toBeGreaterThanOrEqual(20_000) // 首字母子序列档
  })
})

describe('filterSites 过滤排序', () => {
  it('空查询原序全量返回', () => {
    const out = filterSites('', [...BUILTIN_SITES, taobao])
    expect(out.map((x) => x.site.id)).toEqual([...BUILTIN_SITES.map((s) => s.id), 'custom-taobao'])
    expect(out.every((x) => x.score === 0)).toBe(true)
  })

  it('单字母候选：b 命中含 b 音节/字母的站点（host 含 b 的 GitHub/YouTube 也参与）', () => {
    const names = new Set(filterSites('b', [...BUILTIN_SITES]).map((x) => x.site.name))
    for (const n of ['百度', '必应', '哔哩哔哩', '微博', '豆瓣', 'GitHub', 'YouTube']) {
      expect(names.has(n)).toBe(true)
    }
    expect(names.has('知乎')).toBe(false)
    expect(names.has('掘金')).toBe(false)
  })

  it('精确别名只命中一个站点', () => {
    const out = filterSites('bd', [...BUILTIN_SITES])
    expect(out.map((x) => x.site.id)).toEqual(['baidu'])
  })
})

describe('pinKeys 精确锁定词表', () => {
  it('内置库两两不相交（「缩写 关键词」直达不歧义的前提）', () => {
    const owner = new Map<string, string>()
    for (const s of BUILTIN_SITES) {
      for (const k of pinKeys(s)) {
        const prev = owner.get(k)
        if (prev !== undefined && prev !== s.id) {
          throw new Error(`pinKey「${k}」同时属于 ${prev} 与 ${s.id}`)
        }
        owner.set(k, s.id)
      }
    }
    expect(owner.get('bd')).toBe('baidu')
    expect(owner.get('x')).toBe('x')
    expect(owner.get('bilibili.com')).toBe('bilibili')
  })
})

describe('resolvePin「缩写 关键词」直达', () => {
  const all = [...BUILTIN_SITES, taobao]

  it('别名/名称/首字母/host 精确锁定，剩余词为搜索词', () => {
    expect(resolvePin('bd 天气', all)).toMatchObject({ site: { id: 'baidu' }, term: '天气' })
    expect(resolvePin('知乎 electron', all)).toMatchObject({ site: { id: 'zhihu' }, term: 'electron' })
    expect(resolvePin('gh vue 3', all)).toMatchObject({ site: { id: 'github' }, term: 'vue 3' })
    expect(resolvePin('tb 雨伞', all)).toMatchObject({ site: { id: 'custom-taobao' }, term: '雨伞' })
    expect(resolvePin('bilibili.com 三体', all)).toMatchObject({ site: { id: 'bilibili' }, term: '三体' })
  })

  it('强匹配（原文/音节级）唯一也可锁定', () => {
    expect(resolvePin('bilibili 三体', all)).toMatchObject({ site: { id: 'bilibili' }, term: '三体' })
    expect(resolvePin('zhihu 前端', all)).toMatchObject({ site: { id: 'zhihu' }, term: '前端' })
  })

  it('单词条/未知词/歧义词不锁定', () => {
    expect(resolvePin('bd', all)).toBeNull()
    expect(resolvePin('bd ', all)).toBeNull()
    expect(resolvePin('', all)).toBeNull()
    expect(resolvePin('zzz xyz', all)).toBeNull()
    expect(resolvePin('b x', all)).toBeNull()
  })

  it('自定义站点别名撞内置库时不锁定（回退列表过滤）', () => {
    const clash = site({ id: 'c2', name: '我的站', url: 'https://mine.com', aliases: ['bd'] })
    expect(resolvePin('bd 天气', [...BUILTIN_SITES, clash])).toBeNull()
  })
})
