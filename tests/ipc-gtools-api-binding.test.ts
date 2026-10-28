import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// 照 ipc-clipboard-peek.test.ts 的 electron/window mock 脚手架；本文件只测 gtools:api 的 sender 绑定
// （主窗放行、detached 窗 pluginId 一致放行 / 不一致 PLUGIN_MISMATCH、其余 FORBIDDEN_SENDER）
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

type ApiResult = { ok: boolean; data?: unknown; error?: string; message?: string }
type ApiInvoke = (e: { sender: { id: number } }, req: { pluginId: string; api: string; payload: unknown[] }) => Promise<ApiResult>

const call = (senderId: number): { sender: { id: number } } => ({ sender: { id: senderId } })

const noopFs: FsLike = {
  readFile: vi.fn(async () => {
    throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
  }),
  writeFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {})
}

interface Entry {
  manifest: { id: string; permissions: string[] }
  enabled: boolean
}

/** 注入指定 registry 条目与 detached 绑定 fake，返回 gtools:api 处理器 */
async function boot(entries: Record<string, Entry>, boundPlugin: string | null): Promise<{ api: ApiInvoke; bound: Mock }> {
  const store = new SettingsStore('C:\\tmp\\gtools-test', noopFs, 1)
  const loader = {
    registry: { all: () => Object.values(entries), get: (id: string) => entries[id] },
    issues: [],
    externalDetected: [],
    ensureBackendStarted: vi.fn(async () => undefined),
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
  const h = (ipcMain.handle as unknown as Mock).mock.calls.find(([ch]) => ch === 'gtools:api')
  if (!h) throw new Error('gtools:api 未注册')
  return { api: h[1] as ApiInvoke, bound }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSearchWindow).mockReturnValue(null)
})

/** 主窗假窗：webContents.id 必须与 sender id 一致（缺省 1） */
function withFakeWindow(): void {
  vi.mocked(getSearchWindow).mockReturnValue({
    webContents: { id: 1, on: vi.fn(), send: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false }
  } as unknown as ReturnType<typeof getSearchWindow>)
}

const REQ = (pluginId: string): { pluginId: string; api: string; payload: unknown[] } => ({ pluginId, api: 'app.version', payload: [] })
const ENABLED_CALC: Entry = { manifest: { id: 'calc', permissions: [] }, enabled: true }

describe('gtools:api sender 绑定', () => {
  it('非宿主窗 sender（非主窗且 detached 无登记）：FORBIDDEN_SENDER，不触 dispatch', async () => {
    const { api, bound } = await boot({ calc: ENABLED_CALC }, null)
    const r = await api(call(555), REQ('calc'))
    expect(r).toEqual({ ok: false, error: 'FORBIDDEN_SENDER', message: '非插件宿主窗口' })
    expect(bound).toHaveBeenCalledWith(555)
  })

  it('detached 窗 sender 且 pluginId 与登记一致：放行，dispatchApi 结果透传', async () => {
    const { api } = await boot({ calc: ENABLED_CALC }, 'calc')
    const r = await api(call(555), REQ('calc'))
    expect(r).toEqual({ ok: true, data: '0.0.1' })
  })

  it('detached 窗 sender 但 pluginId 冒用他窗插件：PLUGIN_MISMATCH', async () => {
    const { api } = await boot({ calc: ENABLED_CALC, other: { manifest: { id: 'other', permissions: [] }, enabled: true } }, 'other')
    const r = await api(call(555), REQ('calc'))
    expect(r).toEqual({ ok: false, error: 'PLUGIN_MISMATCH', message: '窗口与插件不一致' })
  })

  it('主窗 sender + 启用插件：放行（既有行为，detached 绑定不参与）', async () => {
    withFakeWindow()
    const { api, bound } = await boot({ calc: ENABLED_CALC }, null)
    const r = await api(call(1), REQ('calc'))
    expect(r).toEqual({ ok: true, data: '0.0.1' })
    expect(bound).not.toHaveBeenCalled()
  })

  it('主窗 sender + 禁用插件：dispatch 既有 PLUGIN_DISABLED 校验透传', async () => {
    withFakeWindow()
    const { api } = await boot({ calc: { manifest: { id: 'calc', permissions: [] }, enabled: false } }, null)
    const r = await api(call(1), REQ('calc'))
    expect(r.ok).toBe(false)
    expect(r.error).toBe('PLUGIN_DISABLED')
  })
})
