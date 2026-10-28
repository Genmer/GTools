import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// 照 ipc-hotkey-settings.test.ts 的 electron/window mock 脚手架；app 增补 relaunch/exit（app:relaunch 用例）
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  app: {
    getPath: vi.fn(() => 'C:\\tmp\\gtools-test'),
    isPackaged: true,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn()
  },
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn(),
    unregisterAll: vi.fn()
  },
  screen: { on: vi.fn() },
  powerMonitor: { on: vi.fn() }
}))

vi.mock('../src/main/window', () => ({
  allLiveWindows: vi.fn(() => []),
  applyHideOnBlur: vi.fn(),
  applyThemeToWindow: vi.fn(),
  getSearchWindow: vi.fn(() => null),
  hideSearchWindow: vi.fn(),
  restoreSearchWindowSize: vi.fn(),
  setSearchWindowHeight: vi.fn(),
  setSearchWindowResizable: vi.fn(),
  showSearchWindow: vi.fn(),
  suspendBlurHide: vi.fn((fn: () => unknown) => fn())
}))
vi.mock('../src/main/logo-skin', () => ({ applyAppLogoSkin: vi.fn(), logoIconPath: vi.fn(() => null) }))
vi.mock('../src/main/tray', () => ({ createTray: vi.fn(), applyTraySkin: vi.fn(), destroyTray: vi.fn() }))

// update-downloader 整模块桩化：ipc 层只验装配/守卫/透传，下载会话纯逻辑由 update-downloader.test.ts 覆盖
const { downloaderFake, downloaderDeps } = vi.hoisted(() => ({
  downloaderFake: { start: vi.fn(), cancel: vi.fn(), status: vi.fn() },
  downloaderDeps: { current: null as { onProgress?: (snap: unknown) => void } | null }
}))
vi.mock('../src/main/services/update-downloader', () => ({
  createUpdateDownloader: vi.fn((deps: unknown) => {
    downloaderDeps.current = deps as { onProgress?: (snap: unknown) => void }
    return downloaderFake
  }),
  sweepUpdateCache: vi.fn(async () => {})
}))
// update:install win32 分支的安装器拉起
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: vi.fn() }
})

import { app, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import { setupIpc } from '../src/main/services/ipc'
import { AppLog } from '../src/main/services/app-log'
import { getSearchWindow } from '../src/main/window'
import { SettingsStore, type FsLike } from '../src/main/settings-store'
import { unregisterAllHotkeys } from '../src/main/shortcut'
import type { UpdateDownloadSnapshot } from '../src/main/services/update-downloader'

const spawnMock = spawn as unknown as Mock

const snapIdle = (): UpdateDownloadSnapshot => ({
  state: 'idle',
  receivedBytes: 0,
  totalBytes: null,
  speedBps: null,
  fileName: null,
  installerPath: null,
  error: null
})

const snapDownloaded = (installerPath: string): UpdateDownloadSnapshot => ({
  state: 'downloaded',
  receivedBytes: 1048576,
  totalBytes: 1048576,
  speedBps: null,
  fileName: installerPath.slice(installerPath.lastIndexOf('/') + 1),
  installerPath,
  error: null
})

type HostReply = { ok: boolean; data?: unknown; error?: string; warnings?: string[] }
type Host = (e: { sender: { id: number } }, req: { api: string; payload?: unknown }) => Promise<HostReply>

const sender = (): { sender: { id: number } } => ({ sender: { id: 1 } })

const noopFs: FsLike = {
  readFile: vi.fn(async () => {
    throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
  }),
  writeFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {})
}

const releaseBody = (): string =>
  JSON.stringify({
    tag_name: 'v9.9.9',
    html_url: 'https://github.com/Genmer/GTools/releases/tag/v9.9.9',
    assets: [
      { name: 'GTools-9.9.9.dmg', browser_download_url: 'https://github.com/Genmer/GTools/releases/download/v9.9.9/GTools-9.9.9.dmg' },
      { name: 'GTools.Setup.9.9.9.exe', browser_download_url: 'https://github.com/Genmer/GTools/releases/download/v9.9.9/GTools.Setup.9.9.9.exe' }
    ]
  })

/** boot 时注入 fake net.fetch / shell.openExternal / app 三元组，返回其引用供断言；readText 可覆写（clipboard:peek 用例） */
async function boot(
  readText: () => Promise<string> = async () => '',
  opts: { platform?: string } = {}
): Promise<{
  host: Host
  fetch: Mock
  openExternal: Mock
  openPath: Mock
  cleanupOrder: string[]
}> {
  const store = new SettingsStore('C:\\tmp\\gtools-test', noopFs, 1)
  const cleanupOrder: string[] = []
  const loader = {
    registry: { all: () => [], get: vi.fn() },
    issues: [],
    externalDetected: [],
    ensureBackendStarted: vi.fn(async () => undefined),
    setEnabled: vi.fn(async () => ({ ok: true })),
    disposeAll: vi.fn(async () => {
      cleanupOrder.push('disposeAll')
    })
  }
  const fetch = vi.fn(async () => ({ ok: true, status: 200, body: releaseBody() }))
  const openExternal = vi.fn(async () => {})
  const openPath = vi.fn(async () => {})
  // settings.flush 走实例 spy 记序（真实实现本就用 noopFs，替换无副作用）
  vi.spyOn(store, 'flush').mockImplementation(async () => {
    cleanupOrder.push('settings.flush')
  })
  const apiFlush = vi.fn(async () => {
    cleanupOrder.push('apiCenter.flush')
  })
  const floatCloseAll = vi.fn(() => {
    cleanupOrder.push('float.closeAll')
  })
  const detachedCloseAll = vi.fn(() => {
    cleanupOrder.push('detached.closeAll')
  })
  unregisterAllHotkeys()
  setupIpc({
    loader,
    settings: store,
    appLog: new AppLog(),
    services: {
      window: { float: { closeAllForPlugin: vi.fn(), closeAll: floatCloseAll } },
      storage: { dumpAll: vi.fn(async () => ({})), replaceAll: vi.fn(async () => {}) },
      app: { version: '0.0.1', platform: opts.platform ?? 'darwin', arch: 'arm64' },
      clipboard: { readText: vi.fn(readText) },
      net: { fetch, fetchStream: vi.fn() },
      shell: { openExternal, openPath }
    },
    apiCenter: { config: {}, sanitized: () => ({}), replaceAll: vi.fn(async () => {}), flush: apiFlush },
    nativeApps: {},
    detached: {
      applyThemeToAll: vi.fn(),
      closeForPlugin: vi.fn(),
      closeAll: detachedCloseAll,
      open: vi.fn(),
      closeByWebContents: vi.fn(),
      setAlwaysOnTopFor: vi.fn()
    },
    onHotkeyToggle: vi.fn()
  } as unknown as Parameters<typeof setupIpc>[0])
  const call = (ipcMain.handle as unknown as Mock).mock.calls.find(([ch]) => ch === 'gtools:host')
  if (!call) throw new Error('gtools:host 未注册')
  return { host: call[1] as Host, fetch, openExternal, openPath, cleanupOrder }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSearchWindow).mockReturnValue(null)
  downloaderFake.start.mockImplementation(async () => ({ ok: true, data: snapIdle() }))
  downloaderFake.cancel.mockImplementation(() => snapIdle())
  downloaderFake.status.mockImplementation(() => snapIdle())
  downloaderDeps.current = null
})

function withFakeWindow(): void {
  vi.mocked(getSearchWindow).mockReturnValue({
    webContents: { id: 1, on: vi.fn(), send: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false }
  } as unknown as ReturnType<typeof getSearchWindow>)
}

describe('gtools:host update:*', () => {
  it('update:check 成功契约：current/latest/hasUpdate/releaseUrl/downloadUrl 齐备且带 Accept 头', async () => {
    const { host, fetch } = await boot()
    const r = await host(sender(), { api: 'update:check' })
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({
      current: '0.0.1',
      latest: '9.9.9',
      hasUpdate: true,
      releaseUrl: 'https://github.com/Genmer/GTools/releases/tag/v9.9.9',
      downloadUrl: 'https://github.com/Genmer/GTools/releases/download/v9.9.9/GTools-9.9.9.dmg'
    })
    expect(fetch).toHaveBeenCalledWith('https://api.github.com/repos/Genmer/GTools/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' }
    })
  })

  it('update:check 网络异常（fetch reject）落中文 error，不冒英文技术串', async () => {
    const { host } = await bootWithFetch(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED')
    })
    const r = await host(sender(), { api: 'update:check' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('检查更新失败：网络连接失败或超时')
  })

  it('update:check HTTP 403（限流）按 status 落中文 error；feed 兜底同样失败时附限流提示', async () => {
    const { host } = await bootWithFetch(async () => ({ ok: false, status: 403, body: '' }))
    const r = await host(sender(), { api: 'update:check' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('检查更新失败（HTTP 403，接口限流（多为共享代理出口 IP 额度耗尽））')
  })

  it('update:open 非法 target 拒绝且不触 openExternal', async () => {
    const { host, openExternal } = await boot()
    const r = await host(sender(), { api: 'update:open', payload: { target: 'https://evil.example.com' } })
    expect(r).toEqual({ ok: false, error: 'target 必须是 repo/release/download' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('update:open 未检查更新（无缓存）时拒绝', async () => {
    const { host } = await boot()
    const r = await host(sender(), { api: 'update:open', payload: { target: 'download' } })
    expect(r).toEqual({ ok: false, error: '请先检查更新' })
  })

  it('update:open repo 打开仓库页；check 后 download 打开平台资产直链', async () => {
    const { host, openExternal } = await boot()
    const repo = await host(sender(), { api: 'update:open', payload: { target: 'repo' } })
    expect(repo.ok).toBe(true)
    expect(openExternal).toHaveBeenCalledWith('https://github.com/Genmer/GTools')
    await host(sender(), { api: 'update:check' })
    const dl = await host(sender(), { api: 'update:open', payload: { target: 'download' } })
    expect(dl.ok).toBe(true)
    expect(openExternal).toHaveBeenLastCalledWith('https://github.com/Genmer/GTools/releases/download/v9.9.9/GTools-9.9.9.dmg')
  })

  it('update:open URL 前缀白名单：缓存链接指向仓库外时拦截（不进 openExternal）', async () => {
    const { host, openExternal } = await bootWithFetch(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        tag_name: 'v9.9.9',
        html_url: 'https://evil.example.com/release',
        assets: [{ name: 'GTools-9.9.9.dmg', browser_download_url: 'https://evil.example.com/dmg' }]
      })
    }))
    await host(sender(), { api: 'update:check' })
    const r = await host(sender(), { api: 'update:open', payload: { target: 'download' } })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('更新链接不在本仓库白名单内')
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('gtools:host app:relaunch', () => {
  it('非主搜索窗口 sender 被守卫拒绝，relaunch/exit 不被调', async () => {
    const { host } = await boot()
    // getSearchWindow 默认 null（无主窗）→ isSearchWindowSender 恒 false
    const r = await host(sender(), { api: 'app:relaunch' })
    expect(r).toEqual({ ok: false, error: '仅主搜索窗口可调用' })
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('主搜索窗口 sender：relaunch 后先执行与 will-quit 相同的清理链再 exit(0)', async () => {
    const { host, cleanupOrder } = await boot()
    withFakeWindow()
    const r = await host(sender(), { api: 'app:relaunch' })
    expect(r).toEqual({ ok: true, data: null })
    expect(app.relaunch).toHaveBeenCalledTimes(1)
    // app.exit 不触发 will-quit：清序 = 浮窗/独立窗回收 → backend disposeAll → settings/apiCenter flush → exit
    expect(cleanupOrder).toEqual(['float.closeAll', 'detached.closeAll', 'disposeAll', 'settings.flush', 'apiCenter.flush'])
    expect(app.exit).toHaveBeenCalledWith(0)
    expect(app.exit).toHaveBeenCalledTimes(1)
  })
})

describe('gtools:host update:download/cancel/install', () => {
  it('未检查更新直接 update:download → 请先检查更新', async () => {
    const { host } = await boot()
    withFakeWindow()
    const r = await host(sender(), { api: 'update:download' })
    expect(r).toEqual({ ok: false, error: '请先检查更新' })
    expect(downloaderFake.start).not.toHaveBeenCalled()
  })

  it('check 失败（403）不写缓存：update:download 仍提示先检查更新', async () => {
    const { host } = await bootWithFetch(async () => ({ ok: false, status: 403, body: '' }))
    withFakeWindow()
    const check = await host(sender(), { api: 'update:check' })
    expect(check.ok).toBe(false)
    const r = await host(sender(), { api: 'update:download' })
    expect(r).toEqual({ ok: false, error: '请先检查更新' })
    expect(downloaderFake.start).not.toHaveBeenCalled()
  })

  it('check 成功后 update:download 透传缓存 URL 给 downloader', async () => {
    const { host } = await boot()
    withFakeWindow()
    const downloading = { state: 'downloading', receivedBytes: 0 } as UpdateDownloadSnapshot
    downloaderFake.start.mockImplementation(async () => ({ ok: true, data: downloading }))
    await host(sender(), { api: 'update:check' })
    const r = await host(sender(), { api: 'update:download' })
    expect(r).toEqual({ ok: true, data: downloading })
    expect(downloaderFake.start).toHaveBeenCalledWith('https://github.com/Genmer/GTools/releases/download/v9.9.9/GTools-9.9.9.dmg')
  })

  it('缓存 URL 指向仓库外 → 白名单拦截，不进 downloader', async () => {
    const { host } = await bootWithFetch(async () => ({
      ok: true,
      status: 200,
      body: JSON.stringify({
        tag_name: 'v9.9.9',
        html_url: 'https://github.com/Genmer/GTools/releases/tag/v9.9.9',
        assets: [{ name: 'GTools-9.9.9.dmg', browser_download_url: 'https://evil.example.com/dmg' }]
      })
    }))
    withFakeWindow()
    await host(sender(), { api: 'update:check' })
    const r = await host(sender(), { api: 'update:download' })
    expect(r).toEqual({ ok: false, error: '更新链接不在本仓库白名单内' })
    expect(downloaderFake.start).not.toHaveBeenCalled()
  })

  it('download/cancel/install 非主窗 sender 拒绝；download-status 只读无守卫', async () => {
    const { host } = await boot()
    // getSearchWindow 默认 null → isSearchWindowSender 恒 false
    expect(await host(sender(), { api: 'update:download' })).toEqual({ ok: false, error: '仅主搜索窗口可调用' })
    expect(await host(sender(), { api: 'update:cancel' })).toEqual({ ok: false, error: '仅主搜索窗口可调用' })
    expect(await host(sender(), { api: 'update:install' })).toEqual({ ok: false, error: '仅主搜索窗口可调用' })
    const status = await host(sender(), { api: 'update:download-status' })
    expect(status.ok).toBe(true)
    expect(status.data).toEqual(snapIdle())
  })

  it('check 成功后再 check 失败：缓存不清，update:download 仍用旧缓存 URL', async () => {
    let call = 0
    const { host } = await bootWithFetch(async () => {
      call++
      return call === 1 ? { ok: true, status: 200, body: releaseBody() } : { ok: false, status: 403, body: '' }
    })
    withFakeWindow()
    const first = await host(sender(), { api: 'update:check' })
    expect(first.ok).toBe(true)
    const second = await host(sender(), { api: 'update:check' })
    expect(second.ok).toBe(false)
    const r = await host(sender(), { api: 'update:download' })
    expect(r.ok).toBe(true)
    expect(downloaderFake.start).toHaveBeenCalledWith('https://github.com/Genmer/GTools/releases/download/v9.9.9/GTools-9.9.9.dmg')
  })

  it('check 成功但 downloadUrl=null（feed 兜底无资产）→ update:download 拒绝且不进 downloader（UI 回退发布页）', async () => {
    const feed = (tag: string): string =>
      `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry>` +
      `<id>tag:github.com,2008:Repository/1385365197/${tag}</id>` +
      `<link rel="alternate" type="text/html" href="https://github.com/Genmer/GTools/releases/tag/${tag}"/>` +
      `<title>${tag}</title></entry></feed>`
    let call = 0
    const { host } = await bootWithFetch(async () => {
      call++
      return call === 1 ? { ok: false, status: 403, body: '' } : { ok: true, status: 200, body: feed('v9.9.9') }
    })
    withFakeWindow()
    const check = await host(sender(), { api: 'update:check' })
    expect(check.ok && (check.data as { downloadUrl: string | null }).downloadUrl).toBeNull()
    const r = await host(sender(), { api: 'update:download' })
    expect(r).toEqual({ ok: false, error: '请先检查更新' })
    expect(downloaderFake.start).not.toHaveBeenCalled()
  })

  it('update:download 启动后主窗立即收到首帧广播（downloading 快照）', async () => {
    const { host } = await boot()
    const send = vi.fn()
    vi.mocked(getSearchWindow).mockReturnValue({
      webContents: { id: 1, on: vi.fn(), send, removeListener: vi.fn(), isDestroyed: () => false }
    } as unknown as ReturnType<typeof getSearchWindow>)
    const first: UpdateDownloadSnapshot = {
      state: 'downloading',
      receivedBytes: 0,
      totalBytes: null,
      speedBps: null,
      fileName: 'GTools-9.9.9.dmg',
      installerPath: null,
      error: null
    }
    downloaderFake.start.mockImplementation(async () => {
      downloaderDeps.current?.onProgress?.(first)
      return { ok: true, data: first }
    })
    await host(sender(), { api: 'update:check' })
    const r = await host(sender(), { api: 'update:download' })
    expect(r.ok).toBe(true)
    expect(send).toHaveBeenCalledWith('update-download-progress', first)
  })

  it('update:cancel 返回 downloader.cancel() 快照', async () => {
    const { host } = await boot()
    withFakeWindow()
    const cancelled = { state: 'idle', receivedBytes: 0 } as UpdateDownloadSnapshot
    downloaderFake.cancel.mockImplementation(() => cancelled)
    const r = await host(sender(), { api: 'update:cancel' })
    expect(r).toEqual({ ok: true, data: cancelled })
    expect(downloaderFake.cancel).toHaveBeenCalledTimes(1)
  })

  it('install win32：detached+ignore+windowsHide 拉起、unref、once(spawn/error) 双等待、清序与 app:relaunch 相同、exit(0) 且不 relaunch', async () => {
    const { host, cleanupOrder } = await boot(async () => '', { platform: 'win32' })
    withFakeWindow()
    const installerPath = 'C:\\tmp\\gtools-test\\update-cache\\GTools.Setup.9.9.9.exe'
    downloaderFake.status.mockImplementation(() => snapDownloaded(installerPath))
    // spawn 事件到达 = 拉起成功（真实 ChildProcess spawn 成功后必发该事件）
    const child = {
      unref: vi.fn(),
      once: vi.fn((ev: string, fn: () => void) => {
        if (ev === 'spawn') fn()
      })
    }
    spawnMock.mockImplementation(() => child)
    const r = await host(sender(), { api: 'update:install' })
    expect(r).toEqual({ ok: true, data: null })
    expect(spawnMock).toHaveBeenCalledWith(installerPath, [], { detached: true, stdio: 'ignore', windowsHide: true })
    expect(child.once).toHaveBeenCalledWith('spawn', expect.any(Function))
    expect(child.once).toHaveBeenCalledWith('error', expect.any(Function)) // error 监听常驻：异步失败不冒泡 uncaughtException
    expect(child.unref).toHaveBeenCalledTimes(1)
    expect(cleanupOrder).toEqual(['float.closeAll', 'detached.closeAll', 'disposeAll', 'settings.flush', 'apiCenter.flush'])
    expect(app.exit).toHaveBeenCalledWith(0)
    expect(app.relaunch).not.toHaveBeenCalled()
  })

  it('install win32 单飞：spawn 等待窗口内二次调用拒绝，不双拉安装器', async () => {
    const { host, cleanupOrder } = await boot(async () => '', { platform: 'win32' })
    withFakeWindow()
    downloaderFake.status.mockImplementation(() => snapDownloaded('C:\\tmp\\gtools-test\\update-cache\\GTools.Setup.9.9.9.exe'))
    const handlers: Record<string, () => void> = {}
    const child = {
      unref: vi.fn(),
      once: vi.fn((ev: string, fn: () => void) => {
        handlers[ev] = fn
      })
    }
    spawnMock.mockImplementation(() => child)
    const first = host(sender(), { api: 'update:install' })
    await new Promise((r) => setTimeout(r, 0)) // 宏任务一拍：首笔确定进入 spawn 等待窗口
    const second = await host(sender(), { api: 'update:install' })
    expect(second).toEqual({ ok: false, error: '安装正在进行' })
    expect(spawnMock).toHaveBeenCalledTimes(1)
    handlers.spawn?.()
    expect(await first).toEqual({ ok: true, data: null })
    expect(cleanupOrder).toEqual(['float.closeAll', 'detached.closeAll', 'disposeAll', 'settings.flush', 'apiCenter.flush'])
    expect(app.exit).toHaveBeenCalledWith(0)
  })

  it('install win32 异步 error（杀软锁文件/EACCES）：ok:false 不清理不退出（UI 停在 downloaded 可重试）', async () => {
    const { host, cleanupOrder } = await boot(async () => '', { platform: 'win32' })
    withFakeWindow()
    downloaderFake.status.mockImplementation(() => snapDownloaded('C:\\tmp\\gtools-test\\update-cache\\GTools.Setup.9.9.9.exe'))
    const child = {
      unref: vi.fn(),
      once: vi.fn((ev: string, fn: () => void) => {
        if (ev === 'error') fn()
      })
    }
    spawnMock.mockImplementation(() => child)
    const r = await host(sender(), { api: 'update:install' })
    expect(r).toEqual({ ok: false, error: '安装器拉起失败' })
    expect(child.unref).toHaveBeenCalledTimes(1)
    expect(cleanupOrder).toEqual([])
    expect(app.exit).not.toHaveBeenCalled()
    expect(app.relaunch).not.toHaveBeenCalled()
  })

  it('install 非 downloaded 态拒绝：不拉安装器不退出', async () => {
    const { host, cleanupOrder } = await boot(async () => '', { platform: 'win32' })
    withFakeWindow()
    const r = await host(sender(), { api: 'update:install' })
    expect(r).toEqual({ ok: false, error: '安装包尚未下载完成' })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(cleanupOrder).toEqual([])
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('install win32 spawn 抛错：ok:false 带原文，不清理不退出', async () => {
    const { host, cleanupOrder } = await boot(async () => '', { platform: 'win32' })
    withFakeWindow()
    downloaderFake.status.mockImplementation(() => snapDownloaded('C:\\tmp\\gtools-test\\update-cache\\GTools.Setup.9.9.9.exe'))
    spawnMock.mockImplementation(() => {
      throw new Error('spawn ENOENT')
    })
    const r = await host(sender(), { api: 'update:install' })
    expect(r).toEqual({ ok: false, error: '安装器拉起失败：spawn ENOENT' })
    expect(cleanupOrder).toEqual([])
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('install darwin 非 downloaded 态拒绝：不 openPath 不退出', async () => {
    const { host, openPath } = await boot()
    withFakeWindow()
    const r = await host(sender(), { api: 'update:install' })
    expect(r).toEqual({ ok: false, error: '安装包尚未下载完成' })
    expect(openPath).not.toHaveBeenCalled()
    expect(app.exit).not.toHaveBeenCalled()
  })

  it('install darwin：openPath 打开安装包、不退出', async () => {
    const { host, openPath } = await boot()
    withFakeWindow()
    const installerPath = '/Users/test/Library/Application Support/GTools/update-cache/GTools-9.9.9.dmg'
    downloaderFake.status.mockImplementation(() => snapDownloaded(installerPath))
    const r = await host(sender(), { api: 'update:install' })
    expect(r).toEqual({ ok: true, data: null })
    expect(openPath).toHaveBeenCalledWith(installerPath)
    expect(app.exit).not.toHaveBeenCalled()
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('onProgress 快照经主窗广播 update-download-progress 通道', async () => {
    await boot()
    const send = vi.fn()
    vi.mocked(getSearchWindow).mockReturnValue({
      webContents: { id: 1, on: vi.fn(), send, removeListener: vi.fn(), isDestroyed: () => false }
    } as unknown as ReturnType<typeof getSearchWindow>)
    const snap = snapDownloaded('/cache/GTools-9.9.9.dmg')
    downloaderDeps.current?.onProgress?.(snap)
    expect(send).toHaveBeenCalledWith('update-download-progress', snap)
  })
})

describe('gtools:host clipboard:peek', () => {
  it('超出 64K 的剪贴板文本被截断到 64K', async () => {
    const { host } = await boot(async () => 'x'.repeat(70_000))
    withFakeWindow()
    const r = await host(sender(), { api: 'clipboard:peek' })
    expect(r.ok).toBe(true)
    expect(r.data).toBe('x'.repeat(65_536))
  })

  it('短文本原样返回（不截断）', async () => {
    const { host } = await boot(async () => 'short')
    withFakeWindow()
    const r = await host(sender(), { api: 'clipboard:peek' })
    expect(r).toEqual({ ok: true, data: 'short' })
  })

  it('非主搜索窗口 sender 拒绝读取', async () => {
    const { host } = await boot(async () => 'x')
    const r = await host(sender(), { api: 'clipboard:peek' })
    expect(r).toEqual({ ok: false, error: '仅主搜索窗口可调用' })
  })
})

/** 定制 fetch 的 boot 变体：注入面走 ServiceBag（fake 不经 as 强转TS 不受限） */
async function bootWithFetch(
  fetchImpl: () => Promise<{ ok: boolean; status: number; body: string }>
): Promise<{ host: Host; openExternal: Mock }> {
  const store = new SettingsStore('C:\\tmp\\gtools-test', noopFs, 1)
  const loader = {
    registry: { all: () => [], get: vi.fn() },
    issues: [],
    externalDetected: [],
    ensureBackendStarted: vi.fn(async () => undefined),
    setEnabled: vi.fn(async () => ({ ok: true }))
  }
  const openExternal = vi.fn(async () => {})
  unregisterAllHotkeys()
  setupIpc({
    loader,
    settings: store,
    appLog: new AppLog(),
    services: {
      window: { float: { closeAllForPlugin: vi.fn() } },
      storage: { dumpAll: vi.fn(async () => ({})), replaceAll: vi.fn(async () => {}) },
      app: { version: '0.0.1', platform: 'darwin', arch: 'arm64' },
      clipboard: { readText: vi.fn(async () => '') },
      net: { fetch: fetchImpl },
      shell: { openExternal }
    },
    apiCenter: { config: {}, sanitized: () => ({}), replaceAll: vi.fn(async () => {}) },
    nativeApps: {},
    detached: { applyThemeToAll: vi.fn(), closeForPlugin: vi.fn(), open: vi.fn(), closeByWebContents: vi.fn(), setAlwaysOnTopFor: vi.fn() },
    onHotkeyToggle: vi.fn()
  } as unknown as Parameters<typeof setupIpc>[0])
  const call = (ipcMain.handle as unknown as Mock).mock.calls.find(([ch]) => ch === 'gtools:host')
  if (!call) throw new Error('gtools:host 未注册')
  return { host: call[1] as Host, openExternal }
}
