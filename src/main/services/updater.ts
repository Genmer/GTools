// 更新检测纯逻辑：fetch/version/platform/arch 构造注入，零 electron import（node 环境可单测）

export const REPO_URL = 'https://github.com/Genmer/GTools'
const RELEASE_PREFIX = 'https://github.com/Genmer/GTools/releases/'
const LATEST_RELEASE_API = 'https://api.github.com/repos/Genmer/GTools/releases/latest'
const RELEASES_FEED = 'https://github.com/Genmer/GTools/releases.atom'

/** 版本比较（a<b 返回 -1）：剥 'v' 前缀、按 '.' 切数字段、长度不等补零；须用本函数而非字符串比较（0.0.9 < 0.0.10） */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

export interface ReleaseAsset {
  name: string
  browser_download_url: string
}

/**
 * 平台资产消歧：darwin 取 name 以 .dmg 结尾、win32 以 .exe 结尾；恰 1 个即取；
 * 多个时优先 name 含 'universal'，否则匹配当前 arch token（arm64→'arm64'，其余→'x64'），仍歧义返回 null（回退 release 页）。
 */
export function pickAsset(assets: ReleaseAsset[], opts: { platform: string; arch: string }): string | null {
  const ext = opts.platform === 'darwin' ? '.dmg' : '.exe'
  const matched = assets.filter((a) => typeof a.name === 'string' && a.name.toLowerCase().endsWith(ext))
  if (matched.length === 0) return null
  if (matched.length === 1) return matched[0].browser_download_url
  const lower = (s: string): string => s.toLowerCase()
  const universal = matched.find((a) => lower(a.name).includes('universal'))
  if (universal) return universal.browser_download_url
  const token = opts.arch === 'arm64' ? 'arm64' : 'x64'
  const byArch = matched.filter((a) => lower(a.name).includes(token))
  return byArch.length === 1 ? byArch[0].browser_download_url : null
}

export interface ParsedRelease {
  latest: string
  releaseUrl: string
  downloadUrl: string | null
}

/** tag_name 剥 'v' 后强校验纯数字段：非数字 tag（如 'latest'）会让 compareVersions 出 NaN 被误判「已是最新」，在此拒绝 */
export function parseLatestRelease(
  body: string,
  opts: { platform: string; arch: string }
): { ok: true; release: ParsedRelease } | { ok: false; error: string } {
  let data: { tag_name?: unknown; html_url?: unknown; assets?: unknown }
  try {
    data = JSON.parse(body)
  } catch {
    return { ok: false, error: 'Release 响应不是有效 JSON' }
  }
  if (typeof data !== 'object' || data === null) return { ok: false, error: 'Release 响应格式异常' }
  if (typeof data.tag_name !== 'string' || data.tag_name === '') return { ok: false, error: 'Release 缺少 tag_name 字段' }
  const ver = data.tag_name.replace(/^v/, '')
  if (!/^\d+(\.\d+)*$/.test(ver)) return { ok: false, error: `远端版本号格式异常：${data.tag_name}` }
  if (typeof data.html_url !== 'string' || data.html_url === '') return { ok: false, error: 'Release 缺少 html_url 字段' }
  const assets: ReleaseAsset[] = Array.isArray(data.assets)
    ? data.assets.filter(
        (a): a is ReleaseAsset =>
          typeof a === 'object' && a !== null && typeof (a as ReleaseAsset).name === 'string' && typeof (a as ReleaseAsset).browser_download_url === 'string'
      )
    : []
  return { ok: true, release: { latest: ver, releaseUrl: data.html_url, downloadUrl: pickAsset(assets, opts) } }
}

export interface UpdateCheckResult {
  current: string
  latest: string
  hasUpdate: boolean
  releaseUrl: string
  downloadUrl: string | null
}

/** atom feed 兜底解析：版本取 <id> 尾段 tag（<title> 是 release 名，可能与 tag 不一致），链接取 <link href>；feed 无资产清单，downloadUrl 由调用方置空 */
export function parseLatestReleaseFeed(
  body: string
): { ok: true; release: { latest: string; releaseUrl: string } } | { ok: false; error: string } {
  const entry = /<entry>[\s\S]*?<\/entry>/.exec(body)?.[0]
  if (entry === undefined) return { ok: false, error: 'Release feed 无条目（可能还没有任何发布）' }
  const raw = /<id>[^<]*\/([^/<]+)<\/id>/.exec(entry)?.[1] ?? /<title>([^<]+)<\/title>/.exec(entry)?.[1] ?? ''
  const releaseUrl = /<link[^>]*href="([^"]+)"/.exec(entry)?.[1] ?? ''
  const ver = raw.trim().replace(/^v/, '')
  if (releaseUrl === '') return { ok: false, error: 'Release feed 缺少链接' }
  if (!/^\d+(\.\d+)*$/.test(ver)) return { ok: false, error: `远端版本号格式异常：${raw}` }
  return { ok: true, release: { latest: ver, releaseUrl } }
}

export type UpdaterFetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; body: string }>

/**
 * 闭包缓存最近一次成功检测的 { releaseUrl, downloadUrl }（重启前恒有效）；
 * check() 按 fetchViaNet 契约分支：HTTP 非 2xx 返回 ok:false 不抛错，网络层异常/超时在此 catch 转中文
 * （对齐 api-center fetchChecked 的分类处理，勿让英文技术串冒到 ipc.ts 外层 catch）。
 */
export function createUpdater(deps: { fetch: UpdaterFetch; version: string; platform: string; arch: string }): {
  check(): Promise<{ ok: true; data: UpdateCheckResult } | { ok: false; error: string }>
  open(target: 'repo' | 'release' | 'download'): { ok: true; url: string } | { ok: false; error: string }
} {
  let cached: { releaseUrl: string; downloadUrl: string | null } | null = null
  return {
    async check() {
      try {
        const res = await deps.fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
        if (!res.ok) {
          // API 匿名额度 60 次/时按出口 IP 计（共享代理环境常态 403/429）：atom feed 走 github.com 网页端无此限额
          const feed = await deps.fetch(RELEASES_FEED)
          if (feed.ok) {
            const parsed = parseLatestReleaseFeed(feed.body)
            if (parsed.ok) {
              cached = { releaseUrl: parsed.release.releaseUrl, downloadUrl: null }
              return {
                ok: true,
                data: {
                  current: deps.version,
                  latest: parsed.release.latest,
                  hasUpdate: compareVersions(parsed.release.latest, deps.version) > 0,
                  releaseUrl: parsed.release.releaseUrl,
                  downloadUrl: null
                }
              }
            }
          }
          const hint = res.status === 403 || res.status === 429 ? '，接口限流（多为共享代理出口 IP 额度耗尽）' : ''
          return { ok: false, error: `检查更新失败（HTTP ${res.status}${hint}）` }
        }
        const parsed = parseLatestRelease(res.body, { platform: deps.platform, arch: deps.arch })
        if (!parsed.ok) return parsed
        const { latest, releaseUrl, downloadUrl } = parsed.release
        cached = { releaseUrl, downloadUrl }
        return {
          ok: true,
          data: { current: deps.version, latest, hasUpdate: compareVersions(latest, deps.version) > 0, releaseUrl, downloadUrl }
        }
      } catch {
        // fetchViaNet 的网络层异常/超时（AbortSignal.timeout reject 的普通 Error）在此消化成中文
        return { ok: false, error: '检查更新失败：网络连接失败或超时' }
      }
    },
    open(target) {
      if (target === 'repo') return { ok: true, url: REPO_URL }
      if (cached === null) return { ok: false, error: '请先检查更新' }
      const url = target === 'release' ? cached.releaseUrl : (cached.downloadUrl ?? cached.releaseUrl)
      // openExternal 前的 URL 白名单：只放行本仓库主页与 releases 前缀（openExternal 自带 assertHttpUrl 双保险）
      if (url !== REPO_URL && !url.startsWith(RELEASE_PREFIX)) return { ok: false, error: '更新链接不在本仓库白名单内' }
      return { ok: true, url }
    }
  }
}
