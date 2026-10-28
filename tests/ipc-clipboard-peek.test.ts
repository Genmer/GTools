import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// 照 ipc-update.test.ts 的 electron/window mock 脚手架；本文件只测 clipboard:peek-* 的设置闸
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

type HostReply = { ok: boolean; data?: unknown; error?: string }
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

/** 注入可断言的 clipboard 读写 mock，返回 host 与 store 引用 */
async function boot(): Promise<{ host: Host; store: SettingsStore; readImage: Mock; readText: Mock }> {
  const store = new SettingsStore('C:\\tmp\\gtools-test', noopFs, 1)
  const loader = {
    registry: { all: () => [], get: vi.fn() },
    issues: [],
    externalDetected: [],
    ensureBackendStarted: vi.fn(async () => undefined),
    setEnabled: vi.fn(async () => ({ ok: true }))
  }
  const readImage = vi.fn(async () => ({ width: 220, height: 140 }))
  const readText = vi.fn(async () => '{"a":1}')
  unregisterAllHotkeys()
  setupIpc({
    loader,
    settings: store,
    services: {
      window: { float: { closeAllForPlugin: vi.fn() } },
      storage: { dumpAll: vi.fn(async () => ({})), replaceAll: vi.fn(async () => {}) },
      app: { version: '0.0.1', platform: 'darwin', arch: 'arm64' },
      clipboard: { readText, readImage, readImageThumb: vi.fn(async () => ({ thumb: 'data:image/png;base64,THUMB', width: 220, height: 140 })) },
      net: { fetch: vi.fn(async () => ({ ok: true, status: 200, body: '' })) },
      shell: { openExternal: vi.fn(async () => {}) }
    },
    apiCenter: { config: {}, sanitized: () => ({}), replaceAll: vi.fn(async () => {}) },
    nativeApps: {},
    detached: { applyThemeToAll: vi.fn(), closeForPlugin: vi.fn(), open: vi.fn(), closeByWebContents: vi.fn(), setAlwaysOnTopFor: vi.fn() },
    onHotkeyToggle: vi.fn()
  } as unknown as Parameters<typeof setupIpc>[0])
  const call = (ipcMain.handle as unknown as Mock).mock.calls.find(([ch]) => ch === 'gtools:host')
  if (!call) throw new Error('gtools:host 未注册')
  return { host: call[1] as Host, store, readImage, readText }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSearchWindow).mockReturnValue(null)
})

/** isSearchWindowSender 需要主窗 webContents.id 与 sender 一致（缺省 1） */
function withFakeWindow(): void {
  vi.mocked(getSearchWindow).mockReturnValue({
    webContents: { id: 1, on: vi.fn(), send: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false }
  } as unknown as ReturnType<typeof getSearchWindow>)
}

describe('gtools:host clipboard:peek-* 设置闸（clipboardSuggest）', () => {
  it('默认开：peek-image 回尺寸、peek-json 回非敏感 JSON 全文', async () => {
    withFakeWindow()
    const { host } = await boot()
    const img = await host(sender(), { api: 'clipboard:peek-image' })
    expect(img).toEqual({ ok: true, data: { thumb: 'data:image/png;base64,THUMB', width: 220, height: 140 } })
    const json = await host(sender(), { api: 'clipboard:peek-json' })
    expect(json).toEqual({ ok: true, data: '{"a":1}' })
  })

  it('clipboardSuggest=false：两 peek 拒绝且不触剪贴板读取（主进程闸，渲染层关不掉也读不到）', async () => {
    withFakeWindow()
    const { host, store, readImage, readText } = await boot()
    await store.update({ clipboardSuggest: false })
    const img = await host(sender(), { api: 'clipboard:peek-image' })
    expect(img).toEqual({ ok: false, error: '剪贴板推荐已关闭' })
    const json = await host(sender(), { api: 'clipboard:peek-json' })
    expect(json).toEqual({ ok: false, error: '剪贴板推荐已关闭' })
    expect(readImage).not.toHaveBeenCalled()
    expect(readText).not.toHaveBeenCalled()
  })

  it('非主窗 sender 仍被守卫拒绝（设置闸不放松既有边界）', async () => {
    withFakeWindow()
    const { host, readImage } = await boot()
    const r = await host({ sender: { id: 999 } }, { api: 'clipboard:peek-image' })
    expect(r).toEqual({ ok: false, error: '仅主搜索窗口可调用' })
    expect(readImage).not.toHaveBeenCalled()
  })
})
