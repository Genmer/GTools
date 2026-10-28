import { describe, expect, it, vi, type Mock } from 'vitest'
import type { AppLog } from '../src/main/services/app-log'

// index.ts 全量 mock 面最小化：只锁「登录项同步挪出启动关键路径 + 失败入 appLog」两个行为，
// 其余宿主装配（窗口/托盘/插件装载）全部打桩；app-log 用真实现（断言对象即 setupIpc 收到的实例）
const state = vi.hoisted(() => ({
  readyResolve: null as null | (() => void),
  syncImpl: null as null | ((...args: unknown[]) => unknown)
}))

const seedSettings = vi.hoisted(() => ({
  disabledPlugins: [] as string[],
  hideOnBlur: true,
  windowPos: null,
  theme: 'light',
  transparency: { enabled: false, opacity: 55, blur: false, glassFrost: 45 },
  appLogoSkin: 'default',
  clipboardPanel: { position: 'off' },
  hotkey: { darwin: 'Alt+Space', win32: 'Alt+Space' },
  launchAtLogin: true
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => 'C:\\tmp\\gtools-idx-test'),
    getVersion: vi.fn(() => '0.0.0-test'),
    isPackaged: true,
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(() => new Promise<void>((resolve) => { state.readyResolve = resolve })),
    on: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    dock: { hide: vi.fn() }
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  nativeImage: {},
  Notification: vi.fn(function () { return { show: vi.fn() } }),
  screen: { getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 800, height: 600 } })) },
  shell: { openPath: vi.fn() }
}))

vi.mock('../src/main/login-item', () => ({
  syncLoginItem: vi.fn((...args: unknown[]) => (state.syncImpl ? state.syncImpl(...args) : 'applied'))
}))
// 构造类 mock 须用 function 实现（vi.fn 箭头实现不可 new）
vi.mock('../src/main/settings-store', () => ({
  SettingsStore: vi.fn(function () {
    return {
      settings: seedSettings,
      load: vi.fn(async () => {}),
      update: vi.fn(async () => seedSettings),
      flush: vi.fn(async () => {})
    }
  })
}))
vi.mock('../src/main/plugin-loader', () => ({
  PluginLoader: vi.fn(function () {
    return {
      load: vi.fn(async () => {}),
      startResidentBackends: vi.fn(async () => {}),
      disposeAll: vi.fn(async () => {}),
      externalDetected: [],
      registry: { all: () => [], get: () => undefined }
    }
  })
}))
vi.mock('../src/main/services/electron-services', () => ({
  createElectronServices: vi.fn(() => ({
    clipboard: { readText: vi.fn(), writeText: vi.fn(), readImage: vi.fn(), writeImage: vi.fn(), isTextExempted: vi.fn() },
    window: { float: { closeAll: vi.fn() } },
    net: { fetch: vi.fn() },
    app: { platform: process.platform, version: '0.0.0-test' },
    storage: {}
  })),
  createNativeAppsIconDecoder: vi.fn(() => vi.fn()),
  fetchViaNet: vi.fn(),
  PluginStorageService: vi.fn()
}))
vi.mock('../src/main/services/native-apps', () => ({ NativeAppsService: vi.fn(function () { return {} }) }))
vi.mock('../src/main/services/api-center', () => ({
  ApiCenterService: vi.fn(function () {
    return {
      load: vi.fn(async () => {}),
      sanitized: vi.fn(() => ({})),
      isTranslateEmpty: vi.fn(() => true),
      adoptMigratedProvider: vi.fn(async () => {}),
      flush: vi.fn(async () => {})
    }
  }),
  migrateLegacyTranslate: vi.fn(async () => {})
}))
vi.mock('../src/main/services/clipboard-history', () => ({
  ClipboardHistoryService: vi.fn(function () {
    return { start: vi.fn(), setEnabled: vi.fn() }
  })
}))
vi.mock('../src/main/services/background', () => ({ BackgroundService: vi.fn(function () { return {} }) }))
vi.mock('../src/main/services/dispatch', () => ({ createBackendContext: vi.fn() }))
vi.mock('../src/main/services/ipc', () => ({ setupIpc: vi.fn(), broadcast: vi.fn() }))
vi.mock('../src/main/services/update-downloader', () => ({ sweepUpdateCache: vi.fn(async () => {}) }))
vi.mock('../src/main/window', () => ({
  applyHideOnBlur: vi.fn(),
  bindWindowPositionSink: vi.fn(),
  createSearchWindow: vi.fn(),
  createDetachedWindow: vi.fn(),
  detachedEntryUrl: vi.fn(),
  applyThemeToWindow: vi.fn(),
  setRememberedWindowPos: vi.fn(),
  toggleSearchWindow: vi.fn(),
  showSearchWindow: vi.fn(),
  hideSearchWindow: vi.fn(),
  getSearchWindow: vi.fn(() => null)
}))
vi.mock('../src/main/clipboard-flyout-window', () => ({ closeClipboardFlyout: vi.fn(), setClipboardFlyoutPosition: vi.fn() }))
vi.mock('../src/main/detached-window-manager', () => ({
  DetachedWindowManager: vi.fn(function () {
    return { applyThemeToAll: vi.fn(), markQuitting: vi.fn(), closeAll: vi.fn() }
  })
}))
vi.mock('../src/main/shortcut', () => ({ registerHotkey: vi.fn(() => ({ ok: true })), unregisterAllHotkeys: vi.fn() }))
vi.mock('../src/main/tray', () => ({ createTray: vi.fn() }))
vi.mock('../src/main/logo-skin', () => ({ applyAppLogoSkin: vi.fn() }))

interface IdxCtx {
  syncLoginItem: Mock
  setupIpc: Mock
  app: { getVersion: () => string }
}

/** 每用例独立模块图：reset 后先取同图 mock 实例再加载 index（求值即注册 whenReady 回调），appLog 从 setupIpc 入参捕获 */
async function bootIndex(): Promise<IdxCtx> {
  vi.resetModules()
  vi.clearAllMocks()
  state.readyResolve = null
  const login = await import('../src/main/login-item')
  const ipc = await import('../src/main/services/ipc')
  const electron = await import('electron')
  await import('../src/main/index')
  return {
    syncLoginItem: login.syncLoginItem as unknown as Mock,
    setupIpc: ipc.setupIpc as unknown as Mock,
    app: electron.app as unknown as { getVersion: () => string }
  }
}

/** 只排微任务直到条件满足（引导链全部依赖即时 resolve，不碰宏任务）；上限给足，满载 worker 下链会变深 */
async function drainMicrotasks(until: () => boolean, max = 2000): Promise<void> {
  for (let i = 0; i < max && !until(); i++) await Promise.resolve()
}

/** 放行若干轮 setImmediate 宏任务，让被推迟的登录项同步落地 */
async function flushMacrotasks(rounds = 3): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

describe('主进程启动登录项同步（index.ts 引导链）', () => {
  // 引导链 mock 全即时 resolve，但全量并行 worker 饱和时调度延迟可超 vitest 默认 5s（CI 双核更甚），给足超时
  it('同步挪出启动关键路径：引导链微任务内（IPC 已注册）不跑 syncLoginItem，setImmediate 后才跑且 want 取自 settings', async () => {
    const ctx = await bootIndex()
    expect(ctx.setupIpc).not.toHaveBeenCalled() // whenReady 未 resolve，bootstrap 未启动
    state.readyResolve!()
    await drainMicrotasks(() => ctx.setupIpc.mock.calls.length > 0)
    expect(ctx.setupIpc).toHaveBeenCalledTimes(1) // 引导链已走到 IPC 注册（先于登录项同步的代码位）
    expect(ctx.syncLoginItem).not.toHaveBeenCalled() // 关键锁：不得在引导链内同步执行
    await flushMacrotasks()
    expect(ctx.syncLoginItem).toHaveBeenCalledTimes(1)
    expect(ctx.syncLoginItem).toHaveBeenCalledWith(ctx.app, true) // 种子 launchAtLogin: true
  }, 20000)

  it('同步失败被接住入 appLog：error/main 条目带版本号与错误信息，不杀宿主', async () => {
    state.syncImpl = () => {
      throw new Error('osascript timeout')
    }
    try {
      const ctx = await bootIndex()
      state.readyResolve!()
      await flushMacrotasks()
      expect(ctx.setupIpc).toHaveBeenCalledTimes(1) // 失败不影响引导链本身
      const deps = ctx.setupIpc.mock.calls[0][0] as { appLog: AppLog }
      const hit = deps.appLog.entries(0).items.find((e) => e.text.includes('开机启动设置失败'))
      expect(hit).toBeDefined()
      expect(hit).toMatchObject({ level: 'error', source: 'main' })
      expect(hit?.text).toContain('v0.0.0-test')
      expect(hit?.text).toContain('osascript timeout')
    } finally {
      state.syncImpl = null
    }
  }, 20000)
})
