import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// 照 ipc-gtools-api-binding.test.ts 脚手架；本文件只锁 plugin:enter 的绑定守卫
// （主窗放行、detached 窗只许自报本窗登记插件、陌生窗拒绝）——它是唯一能跨窗拉起他人 backend 的入口
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

import { ipcMain } from 'electron'
import { setupIpc } from '../src/main/services/ipc'
import { getSearchWindow } from '../src/main/window'
import { SettingsStore, type FsLike } from '../src/main/settings-store'
import { unregisterAllHotkeys } from '../src/main/shortcut'

type ApiResult = { ok: boolean; data?: unknown; error?: string }
type HostInvoke = (
  e: { sender: { id: number } },
  req: { api: string; payload?: unknown }
) => Promise<ApiResult>

const call = (senderId: number): { sender: { id: number } } => ({ sender: { id: senderId } })

const noopFs: FsLike = {
  readFile: vi.fn(async () => {
    throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
  }),
  writeFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {})
}

async function boot(boundPlugin: string | null): Promise<{ host: HostInvoke; ensure: Mock; bound: Mock }> {
  const store = new SettingsStore('C:\\tmp\\gtools-test', noopFs, 1)
  const ensure = vi.fn(async () => undefined)
  const loader = {
    registry: { all: () => [], get: (id: string) => ({ manifest: { id, permissions: [] }, enabled: true }) },
    issues: [],
    externalDetected: [],
    ensureBackendStarted: ensure,
    setEnabled: vi.fn(async () => ({ ok: true }))
  }
  const bound = vi.fn(() => boundPlugin)
  unregisterAllHotkeys()
  setupIpc({
    loader,
    settings: store,
    services: {
      window: { float: { closeAllForPlugin: vi.fn() } },
      storage: { dumpAll: vi.fn(async () => ({})), replaceAll: vi.fn(async () => {}) },
      app: { version: '0.0.1', platform: 'darwin', arch: 'arm64' },
      clipboard: { readText: vi.fn(async () => '') },
      net: { fetch: vi.fn(async () => ({ ok: true, status: 200, body: '' })) },
      shell: { openExternal: vi.fn(async () => {}) }
    },
    apiCenter: { config: {}, sanitized: () => ({}), replaceAll: vi.fn(async () => {}) },
    nativeApps: {},
    detached: { applyThemeToAll: vi.fn(), closeForPlugin: vi.fn(), open: vi.fn(), closeByWebContents: vi.fn(), setAlwaysOnTopFor: vi.fn(), pluginIdForWebContents: bound },
    onHotkeyToggle: vi.fn()
  } as unknown as Parameters<typeof setupIpc>[0])
  const h = (ipcMain.handle as unknown as Mock).mock.calls.find(([ch]) => ch === 'gtools:host')
  if (!h) throw new Error('gtools:host 未注册')
  return { host: h[1] as HostInvoke, ensure, bound }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSearchWindow).mockReturnValue(null)
})

/** 主窗假窗：webContents.id 与 sender id 一致（缺省 1） */
function withFakeWindow(): void {
  vi.mocked(getSearchWindow).mockReturnValue({
    webContents: { id: 1, on: vi.fn(), send: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false }
  } as unknown as ReturnType<typeof getSearchWindow>)
}

const ENTER = (id?: string): { api: string; payload?: { id: string } } =>
  id === undefined ? { api: 'plugin:enter' } : { api: 'plugin:enter', payload: { id } }

describe('plugin:enter 绑定守卫', () => {
  it('主窗 sender：任意插件 id 放行，backend 拉起', async () => {
    withFakeWindow()
    const { host, ensure, bound } = await boot('other')
    const r = await host(call(1), ENTER('calc'))
    expect(r).toEqual({ ok: true, data: null })
    expect(ensure).toHaveBeenCalledWith('calc')
    expect(bound).not.toHaveBeenCalled()
  })

  it('detached 窗自报本窗登记插件：放行，backend 拉起', async () => {
    const { host, ensure } = await boot('file-search')
    const r = await host(call(555), ENTER('file-search'))
    expect(r).toEqual({ ok: true, data: null })
    expect(ensure).toHaveBeenCalledWith('file-search')
  })

  it('detached 窗冒用他窗插件：拒绝，backend 不拉起', async () => {
    const { host, ensure, bound } = await boot('file-search')
    const r = await host(call(555), ENTER('launcher'))
    expect(r.ok).toBe(false)
    expect(ensure).not.toHaveBeenCalled()
    expect(bound).toHaveBeenCalledWith(555)
  })

  it('陌生窗（非主窗且 detached 无登记）：拒绝', async () => {
    const { host, ensure } = await boot(null)
    const r = await host(call(777), ENTER('calc'))
    expect(r.ok).toBe(false)
    expect(ensure).not.toHaveBeenCalled()
  })

  it('主窗 sender 无 id 载荷：放行 no-op（不炸、不拉 backend）', async () => {
    withFakeWindow()
    const { host, ensure } = await boot(null)
    const r = await host(call(1), ENTER())
    expect(r).toEqual({ ok: true, data: null })
    expect(ensure).not.toHaveBeenCalled()
  })
})
