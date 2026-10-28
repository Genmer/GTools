import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// 照 ipc-hotkey-settings.test.ts 的 electron/window mock 脚手架；本文件只测 broadcast 的投递定向
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  app: {
    getPath: vi.fn(() => 'C:\\tmp\\gtools-test'),
    isPackaged: true,
    getLoginItemSettings: vi.fn(() => ({ openAtLogin: false })),
    setLoginItemSettings: vi.fn()
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
vi.mock('../src/main/clipboard-flyout-window', () => ({
  isClipboardFlyoutSender: vi.fn(() => false),
  getClipboardFlyoutWindow: vi.fn(() => null),
  setClipboardFlyoutPosition: vi.fn(),
  reanchorClipboardFlyout: vi.fn(),
  applyThemeToClipboardFlyout: vi.fn()
}))

import { broadcast } from '../src/main/services/ipc'
import { allLiveWindows, getSearchWindow } from '../src/main/window'

function fakeWin(id: number): { webContents: { id: number; send: Mock } } {
  return { webContents: { id, send: vi.fn() } }
}

beforeEach(() => {
  // clearAllMocks 只清调用记录不清实现，假窗显式还原防跨用例泄漏
  vi.clearAllMocks()
  vi.mocked(getSearchWindow).mockReturnValue(null)
  vi.mocked(allLiveWindows).mockReturnValue([])
})

describe('broadcast 投递定向（P0-14）', () => {
  it('全窗通道 plugin-state-changed / api-services-changed 发给所有存活窗口（含 detached）', () => {
    const main = fakeWin(1)
    const detached = fakeWin(2)
    vi.mocked(getSearchWindow).mockReturnValue(main as unknown as ReturnType<typeof getSearchWindow>)
    vi.mocked(allLiveWindows).mockReturnValue([main, detached] as unknown as ReturnType<typeof allLiveWindows>)

    broadcast('plugin-state-changed', { id: 'a', enabled: false, plugins: [] })
    expect(main.webContents.send).toHaveBeenCalledWith('plugin-state-changed', { id: 'a', enabled: false, plugins: [] })
    expect(detached.webContents.send).toHaveBeenCalledWith('plugin-state-changed', {
      id: 'a',
      enabled: false,
      plugins: []
    })

    broadcast('api-services-changed', null)
    expect(main.webContents.send).toHaveBeenCalledWith('api-services-changed', null)
    expect(detached.webContents.send).toHaveBeenCalledWith('api-services-changed', null)
  })

  it('settings-changed / command-hotkey / 未登记通道只发主窗，绝不发 detached', () => {
    const main = fakeWin(1)
    const detached = fakeWin(2)
    vi.mocked(getSearchWindow).mockReturnValue(main as unknown as ReturnType<typeof getSearchWindow>)
    vi.mocked(allLiveWindows).mockReturnValue([main, detached] as unknown as ReturnType<typeof allLiveWindows>)

    broadcast('settings-changed', { theme: 'dark' })
    broadcast('command-hotkey', { pluginId: 'a', commandId: 'c1' })
    broadcast('unregistered-channel', 1)

    expect(main.webContents.send).toHaveBeenCalledTimes(3)
    expect(main.webContents.send).toHaveBeenCalledWith('settings-changed', { theme: 'dark' })
    expect(main.webContents.send).toHaveBeenCalledWith('command-hotkey', { pluginId: 'a', commandId: 'c1' })
    expect(main.webContents.send).toHaveBeenCalledWith('unregistered-channel', 1)
    expect(detached.webContents.send).not.toHaveBeenCalled()
  })

  it('主窗销毁（getSearchWindow 返回 null）时主窗定向通道静默 no-op 不抛', () => {
    expect(() => broadcast('settings-changed', {})).not.toThrow()
    expect(() => broadcast('command-hotkey', { pluginId: 'a', commandId: 'c1' })).not.toThrow()
  })
})
