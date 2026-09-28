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

import { app, ipcMain } from 'electron'
import { setupIpc } from '../src/main/services/ipc'
import { getSearchWindow } from '../src/main/window'
import { SettingsStore, type FsLike } from '../src/main/settings-store'
import { unregisterAllHotkeys } from '../src/main/shortcut'

type HostReply = { ok: boolean; data?: unknown; error?: string; warnings?: string[] }
type Host = (e: { sender: { id: number } }, req: { api: string; payload?: unknown }) => Promise<HostReply>

const sender = (): { sender: { id: number } } => ({ sender: { id: 1 } })

const noopFs: FsLike = {
  readFile: vi.fn(async () => {
    throw new Error('no file')
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

/** boot 时注入 fake net.fetch / shell.openExternal / app 三元组，返回其引用供断言 */
async function boot(): Promise<{ host: Host; fetch: Mock; openExternal: Mock }> {
  const store = new SettingsStore('C:\\tmp\\gtools-test', noopFs, 1)
  const loader = {
    registry: { all: () => [], get: vi.fn() },
    issues: [],
    externalDetected: [],
    ensureBackendStarted: vi.fn(async () => undefined),
    setEnabled: vi.fn(async () => ({ ok: true }))
  }
  const fetch = vi.fn(async () => ({ ok: true, status: 200, body: releaseBody() }))
  const openExternal = vi.fn(async () => {})
  unregisterAllHotkeys()
  setupIpc({
    loader,
    settings: store,
    services: {
      window: { float: { closeAllForPlugin: vi.fn() } },
      storage: { dumpAll: vi.fn(async () => ({})), replaceAll: vi.fn(async () => {}) },
      app: { version: '0.0.1', platform: 'darwin', arch: 'arm64' },
      clipboard: { readText: vi.fn(async () => '') },
      net: { fetch },
      shell: { openExternal }
    },
    apiCenter: { config: {}, sanitized: () => ({}), replaceAll: vi.fn(async () => {}) },
    nativeApps: {},
    detached: { applyThemeToAll: vi.fn(), closeForPlugin: vi.fn(), open: vi.fn(), closeByWebContents: vi.fn(), setAlwaysOnTopFor: vi.fn() },
    onHotkeyToggle: vi.fn()
  } as unknown as Parameters<typeof setupIpc>[0])
  const call = (ipcMain.handle as unknown as Mock).mock.calls.find(([ch]) => ch === 'gtools:host')
  if (!call) throw new Error('gtools:host 未注册')
  return { host: call[1] as Host, fetch, openExternal }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSearchWindow).mockReturnValue(null)
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

  it('主搜索窗口 sender：app.relaunch + app.exit(0) 拉起新进程', async () => {
    const { host } = await boot()
    withFakeWindow()
    const r = await host(sender(), { api: 'app:relaunch' })
    expect(r).toEqual({ ok: true, data: null })
    expect(app.relaunch).toHaveBeenCalledTimes(1)
    expect(app.exit).toHaveBeenCalledWith(0)
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
