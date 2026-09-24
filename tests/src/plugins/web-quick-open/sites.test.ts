import { describe, expect, it } from 'vitest'
import {
  BUILTIN_SITES,
  CATEGORY_LABELS,
  parseCustomSites,
  validateSiteForm,
  type SiteCategory
} from '../../../../src/plugins/web-quick-open/sites'
import { normalizeUserUrl } from '../../../../src/plugins/web-quick-open/open-url'

describe('BUILTIN_SITES 内置库完整性', () => {
  it('id 与名称均唯一', () => {
    expect(new Set(BUILTIN_SITES.map((s) => s.id)).size).toBe(BUILTIN_SITES.length)
    expect(new Set(BUILTIN_SITES.map((s) => s.name)).size).toBe(BUILTIN_SITES.length)
  })

  it('全部 url 为合法 http(s) 且归一化后不变（已是最简形态）', () => {
    for (const s of BUILTIN_SITES) {
      expect(normalizeUserUrl(s.url)).toBe(s.url)
    }
  })

  it('searchUrl 必含 {} 或 %s 占位符', () => {
    for (const s of BUILTIN_SITES) {
      if (s.searchUrl === undefined) continue
      expect(s.searchUrl.includes('{}') || s.searchUrl.includes('%s')).toBe(true)
      expect(normalizeUserUrl(s.searchUrl)).toBe(s.searchUrl)
    }
  })

  it('分类齐全且合法，别名非空', () => {
    const cats = new Set(Object.keys(CATEGORY_LABELS) as SiteCategory[])
    const present = new Set(BUILTIN_SITES.map((s) => s.category))
    for (const need of ['search', 'video', 'dev', 'social'] as SiteCategory[]) {
      expect(present.has(need)).toBe(true)
    }
    for (const s of BUILTIN_SITES) {
      expect(cats.has(s.category)).toBe(true)
      for (const a of s.aliases ?? []) expect(a.trim()).not.toBe('')
    }
  })
})

describe('parseCustomSites 持久化数据解析', () => {
  it('空与坏输入返回空数组', () => {
    expect(parseCustomSites(null)).toEqual([])
    expect(parseCustomSites(undefined)).toEqual([])
    expect(parseCustomSites('x')).toEqual([])
    expect(parseCustomSites([1, null, 'x'])).toEqual([])
  })

  it('逐项校验：坏行剔除、好行保留', () => {
    const out = parseCustomSites([
      { name: '淘宝', url: 'taobao.com', searchUrl: 'https://s.taobao.com/search?q={}', aliases: ['tb', ' ', ''] },
      { name: '', url: 'ok.com' },
      { name: '坏网址', url: 'x' },
      'junk'
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      category: 'custom',
      name: '淘宝',
      url: 'https://taobao.com',
      searchUrl: 'https://s.taobao.com/search?q={}',
      aliases: ['tb']
    })
  })

  it('无占位符的 searchUrl 丢弃；缺 id 自动生成', () => {
    const out = parseCustomSites([{ name: '站A', url: 'a.com', searchUrl: 'https://a.com/s' }])
    expect(out[0].searchUrl).toBeUndefined()
    expect(out[0].id).toBe('custom-0')
  })

  it('%s 占位符模板保留', () => {
    const out = parseCustomSites([{ name: '站B', url: 'b.com', searchUrl: 'https://b.com/s?q=%s' }])
    expect(out[0].searchUrl).toBe('https://b.com/s?q=%s')
  })
})

describe('validateSiteForm 表单校验', () => {
  const empty = { name: '', url: '', searchUrl: '', aliases: '' }

  it('名称与网址必填', () => {
    const r1 = validateSiteForm(empty)
    expect(r1.ok).toBe(false)
    if (!r1.ok) {
      expect(r1.errors).toContain('名称不能为空')
      expect(r1.errors.some((e) => e.includes('网址无效'))).toBe(true)
    }
    const r2 = validateSiteForm({ ...empty, name: '淘宝', url: 'taobao.com' })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.site.url).toBe('https://taobao.com')
  })

  it('搜索链接须含占位符，%s 兼容', () => {
    const r1 = validateSiteForm({ ...empty, name: 'A', url: 'a.com', searchUrl: 'https://a.com/s' })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.errors.some((e) => e.includes('占位符'))).toBe(true)
    const r2 = validateSiteForm({ ...empty, name: 'A', url: 'a.com', searchUrl: 'a.com/s?q=%s' })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.site.searchUrl).toBe('https://a.com/s?q=%s')
  })

  it('缩写按空白/中英文逗号切分，重复报错', () => {
    const r1 = validateSiteForm({ ...empty, name: 'A', url: 'a.com', aliases: 'tb 淘宝，tb' })
    expect(r1.ok).toBe(false)
    if (!r1.ok) expect(r1.errors.some((e) => e.includes('重复'))).toBe(true)
    const r2 = validateSiteForm({ ...empty, name: 'A', url: 'a.com', aliases: 'tb，淘宝 ' })
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.site.aliases).toEqual(['tb', '淘宝'])
  })
})
