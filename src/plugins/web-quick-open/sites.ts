import { normalizeUserUrl } from './open-url'

export type SiteCategory = 'search' | 'video' | 'dev' | 'social' | 'custom'

export interface SiteEntry {
  id: string
  name: string
  /** 主页：无搜索词时 Enter 打开的地址 */
  url: string
  /** 搜索模板，含 {} 占位符（兼容 %s）；「缩写 关键词」直达搜索依赖它 */
  searchUrl?: string
  category: SiteCategory
  /** 精确触发缩写（小写比较），如 bd / gh / b站 */
  aliases?: string[]
}

export const CATEGORY_LABELS: Record<SiteCategory, string> = {
  search: '搜索',
  video: '视频',
  dev: '开发',
  social: '社交',
  custom: '自定义'
}

export const CUSTOM_SITES_STORAGE_KEY = 'customSites'

export const BUILTIN_SITES: readonly SiteEntry[] = [
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com', searchUrl: 'https://www.baidu.com/s?wd={}', category: 'search', aliases: ['bd'] },
  { id: 'bing', name: '必应', url: 'https://www.bing.com', searchUrl: 'https://www.bing.com/search?q={}', category: 'search', aliases: ['by'] },
  { id: 'google', name: 'Google', url: 'https://www.google.com', searchUrl: 'https://www.google.com/search?q={}', category: 'search', aliases: ['gg'] },
  { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com', searchUrl: 'https://duckduckgo.com/?q={}', category: 'search', aliases: ['ddg'] },
  { id: 'bilibili', name: '哔哩哔哩', url: 'https://www.bilibili.com', searchUrl: 'https://search.bilibili.com/all?keyword={}', category: 'video', aliases: ['bili', 'b站'] },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com', searchUrl: 'https://www.youtube.com/results?search_query={}', category: 'video', aliases: ['yt', '油管'] },
  { id: 'vqq', name: '腾讯视频', url: 'https://v.qq.com', searchUrl: 'https://v.qq.com/x/search/?q={}', category: 'video', aliases: ['txsp'] },
  { id: 'iqiyi', name: '爱奇艺', url: 'https://www.iqiyi.com', searchUrl: 'https://so.iqiyi.com/so/q_{}', category: 'video', aliases: ['aqy'] },
  { id: 'youku', name: '优酷', url: 'https://www.youku.com', searchUrl: 'https://so.youku.com/search_q_{}', category: 'video', aliases: ['yk'] },
  { id: 'github', name: 'GitHub', url: 'https://github.com', searchUrl: 'https://github.com/search?q={}', category: 'dev', aliases: ['gh'] },
  { id: 'stackoverflow', name: 'Stack Overflow', url: 'https://stackoverflow.com', searchUrl: 'https://stackoverflow.com/search?q={}', category: 'dev', aliases: ['so'] },
  { id: 'mdn', name: 'MDN', url: 'https://developer.mozilla.org', searchUrl: 'https://developer.mozilla.org/zh-CN/search?q={}', category: 'dev', aliases: ['mdn'] },
  { id: 'npm', name: 'npm', url: 'https://www.npmjs.com', searchUrl: 'https://www.npmjs.com/search?q={}', category: 'dev', aliases: ['npm'] },
  { id: 'v2ex', name: 'V2EX', url: 'https://www.v2ex.com', category: 'dev', aliases: ['v2'] },
  { id: 'juejin', name: '掘金', url: 'https://juejin.cn', searchUrl: 'https://juejin.cn/search?query={}', category: 'dev', aliases: ['jj'] },
  { id: 'weibo', name: '微博', url: 'https://weibo.com', searchUrl: 'https://s.weibo.com/weibo?q={}', category: 'social', aliases: ['wb'] },
  { id: 'zhihu', name: '知乎', url: 'https://www.zhihu.com', searchUrl: 'https://www.zhihu.com/search?q={}', category: 'social', aliases: ['zh'] },
  { id: 'x', name: 'X', url: 'https://x.com', searchUrl: 'https://x.com/search?q={}', category: 'social', aliases: ['twitter', '推特'] },
  { id: 'xiaohongshu', name: '小红书', url: 'https://www.xiaohongshu.com', category: 'social', aliases: ['xhs'] },
  { id: 'douban', name: '豆瓣', url: 'https://www.douban.com', searchUrl: 'https://www.douban.com/search?q={}', category: 'social', aliases: ['db'] }
]

/** 解析持久化的自定义站点：逐项校验剔除非法数据，坏行不影响整表 */
export function parseCustomSites(raw: unknown): SiteEntry[] {
  if (!Array.isArray(raw)) return []
  const out: SiteEntry[] = []
  raw.forEach((item, i) => {
    if (typeof item !== 'object' || item === null) return
    const r = item as Record<string, unknown>
    const name = typeof r.name === 'string' ? r.name.trim() : ''
    const url = typeof r.url === 'string' ? normalizeUserUrl(r.url) : null
    if (name === '' || url === null) return
    const searchUrlRaw = typeof r.searchUrl === 'string' ? r.searchUrl.trim() : ''
    const searchUrl = searchUrlRaw === '' ? null : normalizeUserUrl(searchUrlRaw)
    const site: SiteEntry = {
      id: typeof r.id === 'string' && r.id !== '' ? r.id : `custom-${i}`,
      name,
      url,
      category: 'custom',
      aliases: Array.isArray(r.aliases)
        ? r.aliases.filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim())
        : undefined
    }
    if (searchUrl !== null && (searchUrl.includes('{}') || searchUrl.includes('%s'))) site.searchUrl = searchUrl
    if (site.aliases !== undefined && site.aliases.length === 0) site.aliases = undefined
    out.push(site)
  })
  return out
}

export interface SiteFormInput {
  name: string
  url: string
  searchUrl: string
  aliases: string
}

export type SiteFormResult =
  | { ok: true; site: { name: string; url: string; searchUrl?: string; aliases?: string[] } }
  | { ok: false; errors: string[] }

/** 添加/编辑站点表单校验：name 与合法 http(s) url 必填；searchUrl 选填但须含 {} 或 %s 占位符 */
export function validateSiteForm(input: SiteFormInput): SiteFormResult {
  const errors: string[] = []
  const name = input.name.trim()
  if (name === '') errors.push('名称不能为空')

  const url = normalizeUserUrl(input.url)
  if (url === null) errors.push('网址无效：需形如 example.com 或 https://example.com')

  let searchUrl: string | undefined
  const searchRaw = input.searchUrl.trim()
  if (searchRaw !== '') {
    const s = normalizeUserUrl(searchRaw)
    if (s === null) errors.push('搜索链接无效')
    else if (!s.includes('{}') && !s.includes('%s')) errors.push('搜索链接须包含关键词占位符 {} 或 %s')
    else searchUrl = s
  }

  const aliases = input.aliases
    .split(/[\s,，]+/)
    .map((a) => a.trim())
    .filter((a) => a !== '')
  if (new Set(aliases.map((a) => a.toLowerCase())).size !== aliases.length) errors.push('缩写有重复')

  if (errors.length > 0 || url === null) return { ok: false, errors }
  return { ok: true, site: { name, url, searchUrl, aliases: aliases.length > 0 ? aliases : undefined } }
}
