export const SEARCH_PLACEHOLDER = '{}'

/**
 * 用户输入的 URL 归一化：补 https:// 前缀、去首尾空白。
 * 注意必须返回原始字符串而非 url.toString()：WHATWG URL 会把路径里的 {} 占位符编码成 %7B%7D，
 * 搜索模板（如 https://so.iqiyi.com/so/q_{}）就废了；URL 仅作合法性判据。
 */
export function normalizeUserUrl(input: string): string | null {
  const s = input.trim()
  if (s === '') return null
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`
  let u: URL
  try {
    u = new URL(withProto)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  const labels = host.split('.')
  const hostOk = host === 'localhost' || (labels.length >= 2 && labels.every((l) => l.length > 0))
  if (!hostOk) return null
  return withProto
}

/** 疑似网址（用于「直接打开」词条）：整词无空格，http(s) 前缀或 域名.后缀 形态 */
export function looksLikeUrl(q: string): boolean {
  const s = q.trim()
  if (s === '' || /\s/.test(s)) return false
  if (/^https?:\/\/\S+$/i.test(s)) return true
  const m = /^([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*)(?::\d+)?(?:[/?#]\S*)?$/i.exec(s)
  if (!m) return false
  const host = m[1].toLowerCase()
  const labels = host.split('.')
  if (labels.length < 2) return false
  const last = labels[labels.length - 1]
  // 末段纯数字只可能是 IPv4（拦截 3.1.4 之类版本号被当网址）
  return /^\d{1,3}$/.test(last) ? /^\d{1,3}(\.\d{1,3}){3}$/.test(host) : last.length >= 2
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** 用关键词填充搜索模板：替换首个 {}（兼容 %s）；无占位符或关键词为空返回 null */
export function fillSearchUrl(template: string, term: string): string | null {
  const t = term.trim()
  if (t === '') return null
  const placeholder = template.includes('{}') ? '{}' : template.includes('%s') ? '%s' : null
  if (placeholder === null) return null
  return template.replace(placeholder, encodeURIComponent(t))
}

/** Enter 实际打开的地址：有搜索模板且有词 → 搜索结果页，否则主页 */
export function buildOpenUrl(site: { url: string; searchUrl?: string }, term?: string): string {
  const t = term?.trim() ?? ''
  if (t !== '' && site.searchUrl !== undefined) {
    return fillSearchUrl(site.searchUrl, t) ?? site.url
  }
  return site.url
}
