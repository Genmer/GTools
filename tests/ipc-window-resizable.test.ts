import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  app: {
    getPath: vi.fn(() => 'C:\\tmp\\gtools-test'),
    isPackaged: true,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn()
  },
  globalShortcut: { register: vi.fn(), unregister: vi.fn(), unregisterAll: vi.fn() },
  screen: { on: vi.fn() },
  powerMonitor: { on: vi.fn() }
}))

vi.mock('../src/main/window', () => ({
  allLiveWindows: vi.fn(() => []),
  applyHideOnBlur: vi.fn(),
  applyThemeToWindow: vi.fn(),
  getSearchWindow: vi.fn(() => null),
  hideSearchWindow: vi.fn(),
  isTransparentWindow: vi.fn(() => false),
  restoreSearchWindowSize: vi.fn(),
  resizeSearchWindowBy: vi.fn(),
  setSearchWindowHeight: vi.fn(),
  setSearchWindowResizable: vi.fn(),
  showSearchWindow: vi.fn(),
  suspendBlurHide: vi.fn((fn: () => unknown) => fn())
}))
vi.mock('../src/main/logo-skin', () => ({ applyAppLogoSkin: vi.fn(), logoIconPath: vi.fn(() => null) }))
vi.mock('../src/main/tray', () => ({ createTray: vi.fn(), applyTraySkin: vi.fn(), destroyTray: vi.fn() }))
vi.mock('../src/main/clipboard-flyout-window', () => ({
  isClipboardFlyoutSender: vi.fn(() => false),
  getClipboardFlyoutWindow: vi.fn(() => null),
  setClipboardFlyoutPosition: vi.fn(),
  reanchorClipboardFlyout: vi.fn(),
  applyThemeToClipboardFlyout: vi.fn(),
  createClipboardFlyoutWindow: vi.fn(() => null),
  showClipboardFlyout: vi.fn(),
  hideClipboardFlyout: vi.fn(),
  closeClipboardFlyout: vi.fn()
}))

import { ipcMain } from 'electron'
import { setupIpc } from '../src/main/services/ipc'
import { AppLog } from '../src/main/services/app-log'
import {
  getSearchWindow,
  isTransparentWindow,
  restoreSearchWindowSize,
  setSearchWindowResizable
} from '../src/main/window'
import { SettingsStore, type FsLike } from '../src/main/settings-store'

type HostReply = { ok: boolean; data?: unknown; error?: string }
type Host = (e: { sender: { id: number } }, req: { api: string; payload?: unknown }) => Promise<HostReply>

const noopFs: FsLike = {
  readFile: vi.fn(async () => {
    throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
  }),
  writeFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {})
}

function makeLoader() {
  const entries = new Map<string, { manifest: { id: string }; enabled: boolean }>()
  return {
    loader: {
      registry: {
        all: () => [...entries.values()],
        get: (id: string) => entries.get(id)
      },
      issues: [] as { pluginId: string; field: string; message: string }[],
      externalDetected: [] as { manifest: { id: string; name: string } }[],
      ensureBackendStarted: vi.fn(async () => undefined),
      setEnabled: vi.fn(async () => ({ ok: true }))
    }
  }
}

/** setupIpc 后从 ipcMain.handle 取 gtools:host 处理器（只测 window:set-resizable，其余依赖给最小假件） */
async function boot(): Promise<Host> {
  const store = new SettingsStore('C:\\tmp\\gtools-test', noopFs, 1)
  const { loader } = makeLoader()
  setupIpc({
    loader,
    settings: store,
    appLog: new AppLog(),
    services: {
      window: { float: { closeAllForPlugin: vi.fn() } },
      storage: { dumpAll: vi.fn(async () => ({})), replaceAll: vi.fn(async () => {}) },
      app: { platform: 'darwin', version: '0.0.0' },
      clipboard: { readText: vi.fn(async () => '') },
      net: { fetch: vi.fn() }
    },
    apiCenter: { config: {}, sanitized: () => ({}), replaceAll: vi.fn(async () => {}) },
    nativeApps: {},
    detached: { applyThemeToAll: vi.fn(), closeForPlugin: vi.fn(), open: vi.fn(), closeByWebContents: vi.fn(), setAlwaysOnTopFor: vi.fn() },
    onHotkeyToggle: vi.fn()
  } as unknown as Parameters<typeof setupIpc>[0])
  const call = (ipcMain.handle as unknown as Mock).mock.calls.find(([ch]) => ch === 'gtools:host')
  if (!call) throw new Error('gtools:host 未注册')
  return call[1] as Host
}

// 假主窗 webContents.id=1 与 sender() 对齐过 isSearchWindowSender；on/removeListener 防误触 TypeError
function withFakeWindow(): void {
  const fake = { webContents: { id: 1, on: vi.fn(), send: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false } }
  vi.mocked(getSearchWindow).mockReturnValue(fake as unknown as ReturnType<typeof getSearchWindow>)
}

beforeEach(() => {
  // clearAllMocks 不清实现，mockReturnValue 跨用例会泄漏：统一还原
  vi.clearAllMocks()
  vi.mocked(getSearchWindow).mockReturnValue(null)
  vi.mocked(isTransparentWindow).mockReturnValue(false)
})

// 门控平台条件读 process.platform，套件统一钉 win32；darwin 用例就地切换并还原
const realPlatform = process.platform
beforeAll(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
})
afterAll(() => {
  Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true })
})

describe('gtools:host window:set-resizable win32 透明窗门控', () => {
  it('win32 透明窗 resizable:true 被拒：ok:false 且不碰 setSearchWindowResizable', async () => {
    const host = await boot()
    withFakeWindow()
    vi.mocked(isTransparentWindow).mockReturnValue(true)
    const r = await host({ sender: { id: 1 } }, {
      api: 'window:set-resizable',
      payload: { resizable: true, minWidth: 520, minHeight: 360 }
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('透明窗')
    expect(vi.mocked(setSearchWindowResizable)).not.toHaveBeenCalled()
  })

  it('win32 透明窗 resizable:false 恒放行：setSearchWindowResizable(false) + restoreSearchWindowSize 复原', async () => {
    const host = await boot()
    withFakeWindow()
    vi.mocked(isTransparentWindow).mockReturnValue(true)
    const r = await host({ sender: { id: 1 } }, { api: 'window:set-resizable', payload: { resizable: false } })
    expect(r.ok).toBe(true)
    expect(vi.mocked(setSearchWindowResizable)).toHaveBeenCalledWith(false, undefined, undefined)
    expect(vi.mocked(restoreSearchWindowSize)).toHaveBeenCalled()
  })

  it('win32 不透明窗 resizable:true 放行：透传最小尺寸（既有行为不回归）', async () => {
    const host = await boot()
    withFakeWindow()
    vi.mocked(isTransparentWindow).mockReturnValue(false)
    const r = await host({ sender: { id: 1 } }, {
      api: 'window:set-resizable',
      payload: { resizable: true, minWidth: 520, minHeight: 360 }
    })
    expect(r.ok).toBe(true)
    expect(vi.mocked(setSearchWindowResizable)).toHaveBeenCalledWith(true, 520, 360)
  })

  it('darwin 透明窗 resizable:true 放行（macOS 无透明拉伸约束）', async () => {
    const host = await boot()
    withFakeWindow()
    vi.mocked(isTransparentWindow).mockReturnValue(true)
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    try {
      const r = await host({ sender: { id: 1 } }, {
        api: 'window:set-resizable',
        payload: { resizable: true, minWidth: 520, minHeight: 360 }
      })
      expect(r.ok).toBe(true)
      expect(vi.mocked(setSearchWindowResizable)).toHaveBeenCalledWith(true, 520, 360)
    } finally {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    }
  })
})
