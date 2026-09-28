import { describe, expect, it, vi } from 'vitest'
import { compareVersions, createUpdater, parseLatestRelease, parseLatestReleaseFeed, pickAsset, REPO_URL, type UpdaterFetch } from '../src/main/services/updater'

const ok200 = (body: string): { ok: boolean; status: number; body: string } => ({ ok: true, status: 200, body })

const feedBody = (tag: string): string =>
  `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Release notes</title><entry>` +
  `<id>tag:github.com,2008:Repository/1385365197/${tag}</id><updated>2026-09-25T12:59:55Z</updated>` +
  `<link rel="alternate" type="text/html" href="https://github.com/Genmer/GTools/releases/tag/${tag}"/>` +
  `<title>${tag}</title></entry></feed>`

function releaseBody(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    tag_name: 'v0.0.23',
    html_url: 'https://github.com/Genmer/GTools/releases/tag/v0.0.23',
    assets: [
      { name: 'GTools-0.0.23.dmg', browser_download_url: 'https://github.com/Genmer/GTools/releases/download/v0.0.23/GTools-0.0.23.dmg' },
      { name: 'GTools.Setup.0.0.23.exe', browser_download_url: 'https://github.com/Genmer/GTools/releases/download/v0.0.23/GTools.Setup.0.0.23.exe' }
    ],
    ...over
  })
}

const asset = (name: string): { name: string; browser_download_url: string } => ({
  name,
  browser_download_url: `https://github.com/Genmer/GTools/releases/download/v0.0.23/${name}`
})

describe('compareVersions', () => {
  it('数字段比较而非字符串比较：0.0.9 < 0.0.10', () => {
    expect(compareVersions('0.0.9', '0.0.10')).toBe(-1)
    expect(compareVersions('0.0.10', '0.0.9')).toBe(1)
  })
  it('剥 v 前缀：v0.0.23 == 0.0.23', () => {
    expect(compareVersions('v0.0.23', '0.0.23')).toBe(0)
  })
  it('多段与补零：1.0.0 > 0.99.99、0.1 == 0.1.0', () => {
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1)
    expect(compareVersions('0.1', '0.1.0')).toBe(0)
  })
})

describe('pickAsset', () => {
  it('darwin 只认 .dmg：唯一命中即取，.exe 不参与', () => {
    const url = pickAsset([asset('GTools.Setup.0.0.23.exe'), asset('GTools-0.0.23.dmg')], { platform: 'darwin', arch: 'x64' })
    expect(url).toBe('https://github.com/Genmer/GTools/releases/download/v0.0.23/GTools-0.0.23.dmg')
  })
  it('win32 只认 .exe', () => {
    const url = pickAsset([asset('GTools-0.0.23.dmg'), asset('GTools.Setup.0.0.23.exe')], { platform: 'win32', arch: 'x64' })
    expect(url).toBe('https://github.com/Genmer/GTools/releases/download/v0.0.23/GTools.Setup.0.0.23.exe')
  })
  it('多资产按 arch 消歧：arm64 → arm64 资产', () => {
    const url = pickAsset([asset('GTools-0.0.23-x64.dmg'), asset('GTools-0.0.23-arm64.dmg')], { platform: 'darwin', arch: 'arm64' })
    expect(url).toContain('arm64.dmg')
  })
  it('多资产 arch 消歧：非 arm64 归 x64', () => {
    const url = pickAsset([asset('GTools-0.0.23-x64.dmg'), asset('GTools-0.0.23-arm64.dmg')], { platform: 'darwin', arch: 'x64' })
    expect(url).toContain('x64.dmg')
  })
  it('多资产 universal 优先于 arch token', () => {
    const url = pickAsset([asset('GTools-0.0.23-x64.dmg'), asset('GTools-0.0.23-universal.dmg')], { platform: 'darwin', arch: 'arm64' })
    expect(url).toContain('universal.dmg')
  })
  it('多资产无 universal 且无 arch token 可辨时回退 null', () => {
    expect(pickAsset([asset('GTools-0.0.23.dmg'), asset('GTools-beta.dmg')], { platform: 'darwin', arch: 'x64' })).toBeNull()
  })
  it('无平台匹配资产返回 null', () => {
    expect(pickAsset([asset('GTools.Setup.0.0.23.exe')], { platform: 'darwin', arch: 'x64' })).toBeNull()
    expect(pickAsset([], { platform: 'win32', arch: 'x64' })).toBeNull()
  })
})

describe('parseLatestReleaseFeed', () => {
  it('取首个 entry：<id> 尾段剥 v 为版本，<link href> 为发布页', () => {
    const r = parseLatestReleaseFeed(feedBody('v0.0.24'))
    expect(r).toEqual({
      ok: true,
      release: { latest: '0.0.24', releaseUrl: 'https://github.com/Genmer/GTools/releases/tag/v0.0.24' }
    })
  })
  it('release 名与 tag 不一致时以 <id> 尾段为准（<title> 只是展示名）', () => {
    const body = feedBody('v1.2.3').replace('<title>v1.2.3</title>', '<title>首发纪念版</title>')
    const r = parseLatestReleaseFeed(body)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.release.latest).toBe('1.2.3')
  })
  it('无 entry / 版本非法 / 缺链接 分别落中文 error', () => {
    expect(parseLatestReleaseFeed('<feed></feed>').ok).toBe(false)
    expect(parseLatestReleaseFeed(feedBody('nightly')).ok).toBe(false)
    expect(parseLatestReleaseFeed(feedBody('v0.0.24').replace(/<link[^>]*>/, '')).ok).toBe(false)
  })
})

describe('parseLatestRelease', () => {
  it('正常 release：剥 v、透传 html_url、按平台取资产', () => {
    const r = parseLatestRelease(releaseBody(), { platform: 'darwin', arch: 'x64' })
    expect(r).toEqual({
      ok: true,
      release: {
        latest: '0.0.23',
        releaseUrl: 'https://github.com/Genmer/GTools/releases/tag/v0.0.23',
        downloadUrl: 'https://github.com/Genmer/GTools/releases/download/v0.0.23/GTools-0.0.23.dmg'
      }
    })
  })
  it('win32 平台取 .exe 资产', () => {
    const r = parseLatestRelease(releaseBody(), { platform: 'win32', arch: 'x64' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.release.downloadUrl).toContain('.exe')
  })
  it('非数字 tag（如 latest）拒绝，防 compareVersions 出 NaN 被误判已是最新', () => {
    const r = parseLatestRelease(releaseBody({ tag_name: 'latest' }), { platform: 'darwin', arch: 'x64' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('远端版本号格式异常：latest')
  })
  it('坏 JSON 与缺字段分别落中文 error', () => {
    expect(parseLatestRelease('not-json', { platform: 'darwin', arch: 'x64' })).toEqual({ ok: false, error: 'Release 响应不是有效 JSON' })
    const noTag = parseLatestRelease(releaseBody({ tag_name: undefined }), { platform: 'darwin', arch: 'x64' })
    expect(noTag.ok).toBe(false)
    if (!noTag.ok) expect(noTag.error).toBe('Release 缺少 tag_name 字段')
    const noUrl = parseLatestRelease(releaseBody({ html_url: undefined }), { platform: 'darwin', arch: 'x64' })
    expect(noUrl.ok).toBe(false)
    if (!noUrl.ok) expect(noUrl.error).toBe('Release 缺少 html_url 字段')
  })
  it('assets 缺失或非数组时 downloadUrl 为 null（回退 release 页）', () => {
    const r = parseLatestRelease(releaseBody({ assets: undefined }), { platform: 'darwin', arch: 'x64' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.release.downloadUrl).toBeNull()
  })
})

describe('createUpdater', () => {
  it('判新方向锁定：远程比本地新才 hasUpdate（current 0.0.23 vs latest 0.0.1 → 已是最新，不引导降级）', async () => {
    const fetch = vi.fn(async () => ok200(releaseBody({ tag_name: 'v0.0.1' }))) as unknown as UpdaterFetch
    const u = createUpdater({ fetch, version: '0.0.23', platform: 'darwin', arch: 'x64' })
    const r = await u.check()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.hasUpdate).toBe(false)
      expect(r.data.current).toBe('0.0.23')
      expect(r.data.latest).toBe('0.0.1')
    }
  })
  it('current 0.0.1 vs latest 0.0.23 → 有更新', async () => {
    const fetch = vi.fn(async () => ok200(releaseBody())) as unknown as UpdaterFetch
    const u = createUpdater({ fetch, version: '0.0.1', platform: 'win32', arch: 'x64' })
    const r = await u.check()
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.hasUpdate).toBe(true)
  })
  it('check 命中 GitHub API：带 Accept 头、返回契约字段', async () => {
    const fetch = vi.fn(async () => ok200(releaseBody())) as unknown as UpdaterFetch
    const u = createUpdater({ fetch, version: '0.0.1', platform: 'darwin', arch: 'x64' })
    const r = await u.check()
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/Genmer/GTools/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toEqual({
        current: '0.0.1',
        latest: '0.0.23',
        hasUpdate: true,
        releaseUrl: 'https://github.com/Genmer/GTools/releases/tag/v0.0.23',
        downloadUrl: 'https://github.com/Genmer/GTools/releases/download/v0.0.23/GTools-0.0.23.dmg'
      })
    }
  })
  it('HTTP 非 2xx 且 feed 兜底也失败：error 带 status 与限流提示', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 403, body: '' })) as unknown as UpdaterFetch
    const u = createUpdater({ fetch, version: '0.0.1', platform: 'darwin', arch: 'x64' })
    const r = await u.check()
    expect(r).toEqual({ ok: false, error: '检查更新失败（HTTP 403，接口限流（多为共享代理出口 IP 额度耗尽））' })
    expect(fetch).toHaveBeenCalledTimes(2) // API + feed 都试过
  })
  it('API 403（共享代理限流）→ atom feed 兜底成功：版本取 <id> 尾段，downloadUrl 空回退发布页', async () => {
    const feed = feedBody('v0.0.24')
    const fetch = vi
      .fn(async (url: string) =>
        url.includes('releases.atom') ? ok200(feed) : { ok: false, status: 403, body: '' }
      ) as unknown as UpdaterFetch
    const u = createUpdater({ fetch, version: '0.0.23', platform: 'darwin', arch: 'x64' })
    const r = await u.check()
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.latest).toBe('0.0.24')
      expect(r.data.hasUpdate).toBe(true)
      expect(r.data.downloadUrl).toBeNull()
      expect(r.data.releaseUrl).toBe('https://github.com/Genmer/GTools/releases/tag/v0.0.24')
    }
    const o = u.open('download')
    if (o.ok) expect(o.url).toBe('https://github.com/Genmer/GTools/releases/tag/v0.0.24')
  })
  it('网络层异常（fetch reject/超时）在 check() 内 catch 成中文，无英文技术串冒泡', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('This operation was aborted')
    }) as unknown as UpdaterFetch
    const u = createUpdater({ fetch, version: '0.0.1', platform: 'darwin', arch: 'x64' })
    const r = await u.check()
    expect(r).toEqual({ ok: false, error: '检查更新失败：网络连接失败或超时' })
    if (!r.ok) expect(r.error).not.toMatch(/[a-zA-Z]/)
  })
  it('open：repo 无需缓存直接放行仓库页', () => {
    const u = createUpdater({ fetch: vi.fn() as unknown as UpdaterFetch, version: '0.0.1', platform: 'darwin', arch: 'x64' })
    expect(u.open('repo')).toEqual({ ok: true, url: REPO_URL })
  })
  it('open：无缓存时 release/download 拒绝并提示先检查更新', () => {
    const u = createUpdater({ fetch: vi.fn() as unknown as UpdaterFetch, version: '0.0.1', platform: 'darwin', arch: 'x64' })
    expect(u.open('release')).toEqual({ ok: false, error: '请先检查更新' })
    expect(u.open('download')).toEqual({ ok: false, error: '请先检查更新' })
  })
  it('open：check 缓存后 release/download 取对应链接，downloadUrl 缺失回退 release 页', async () => {
    const fetch = vi.fn(async () => ok200(releaseBody({ assets: undefined }))) as unknown as UpdaterFetch
    const u = createUpdater({ fetch, version: '0.0.1', platform: 'darwin', arch: 'x64' })
    await u.check()
    expect(u.open('release')).toEqual({ ok: true, url: 'https://github.com/Genmer/GTools/releases/tag/v0.0.23' })
    expect(u.open('download')).toEqual({ ok: true, url: 'https://github.com/Genmer/GTools/releases/tag/v0.0.23' })
  })
  it('open：白名单拦截——缓存链接指向本仓库外时拒绝', async () => {
    const fetch = vi.fn(async () =>
      ok200(releaseBody({ html_url: 'https://evil.example.com/fake-release', assets: [{ name: 'GTools-0.0.23.dmg', browser_download_url: 'https://evil.example.com/dmg' }] }))
    ) as unknown as UpdaterFetch
    const u = createUpdater({ fetch, version: '0.0.1', platform: 'darwin', arch: 'x64' })
    await u.check()
    expect(u.open('release')).toEqual({ ok: false, error: '更新链接不在本仓库白名单内' })
    expect(u.open('download')).toEqual({ ok: false, error: '更新链接不在本仓库白名单内' })
  })
})
