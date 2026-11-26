import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 主窗 darwin 全屏覆盖回归（v0.0.67）：唤起时调 setVisibleOnAllWorkspaces(false) 未带 skipTransformProcessType，
// Electron 会把进程转回前台型且 1 秒内再开会跳过，窗口从此进不了别的应用的全屏空间（唤起被切回桌面）。
// 进程类型只由启动时 app.dock.hide() 定一次，主窗路径任何一次调用都不许再触发进程类型变换。

interface FakeWin {
  isDestroyed: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  getSize: ReturnType<typeof vi.fn>
  getPosition: ReturnType<typeof vi.fn>
  setPosition: ReturnType<typeof vi.fn>
  setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>
  setAlwaysOnTop: ReturnType<typeof vi.fn>
  showInactive: ReturnType<typeof vi.fn>
  moveTop: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  setVibrancy: ReturnType<typeof vi.fn>
  setBackgroundColor: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  webContents: {
    executeJavaScript: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
}

const state = vi.hoisted(() => ({ win: null as FakeWin | null }))

vi.mock('electron', () => ({
  // 普通函数返回对象即替换构造实例（非 function 实现过不了 new）
  BrowserWindow: vi.fn(function () {
    return state.win
  }),
  nativeTheme: { themeSource: 'system' },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 2560, height: 1400 } })),
    getCursorScreenPoint: vi.fn(() => ({ x: 1200, y: 600 })),
    getAllDisplays: vi.fn(() => [{ bounds: { x: 0, y: 0, width: 2560, height: 1440 }, workArea: { x: 0, y: 0, width: 2560, height: 1400 } }])
  }
}))

vi.mock('../src/main/logo-skin', () => ({ logoIconPath: vi.fn(() => null) }))

const realPlatform = process.platform
const setPlatform = (p: NodeJS.Platform): void => {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

function makeWin(): FakeWin {
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    getSize: vi.fn(() => [864, 371]),
    getPosition: vi.fn(() => [100, 200]),
    setPosition: vi.fn(),
    setVisibleOnAllWorkspaces: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    showInactive: vi.fn(),
    moveTop: vi.fn(),
    focus: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    setVibrancy: vi.fn(),
    setBackgroundColor: vi.fn(),
    once: vi.fn(),
    on: vi.fn(),
    loadFile: vi.fn(() => Promise.resolve()),
    webContents: {
      executeJavaScript: vi.fn(() => Promise.resolve(undefined)),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn()
    }
  }
}

type WorkspaceCall = [boolean, Record<string, unknown> | undefined]
const workspaceCalls = (): WorkspaceCall[] => state.win!.setVisibleOnAllWorkspaces.mock.calls as WorkspaceCall[]
/** 最近一次调用的序号，用于断言先后顺序 */
const lastOrder = (m: { mock: { invocationCallOrder: number[] } }): number => {
  const orders = m.mock.invocationCallOrder
  return orders[orders.length - 1]
}

let windowMod: typeof import('../src/main/window')
let win: FakeWin

async function createAndReady(platform: NodeJS.Platform): Promise<void> {
  setPlatform(platform)
  delete process.env.ELECTRON_RENDERER_URL
  vi.resetModules()
  windowMod = await import('../src/main/window')
  state.win = makeWin()
  windowMod.createSearchWindow()
  win = state.win
  // 首帧就绪门控：触发 ready-to-show 后唤起才真正显窗
  const ready = win.once.mock.calls.find((c) => c[0] === 'ready-to-show')?.[1] as (() => void) | undefined
  expect(ready).toBeTypeOf('function')
  ready?.()
}

beforeEach(() => {
  vi.clearAllMocks()
  state.win = null
})

afterEach(() => {
  setPlatform(realPlatform)
  delete process.env.ELECTRON_RENDERER_URL
})

describe('主窗 darwin 全屏覆盖（进程类型只由 app.dock.hide() 定型）', () => {
  it('建窗即挂全空间可见（含全屏空间），且不动进程类型', async () => {
    await createAndReady('darwin')
    expect(workspaceCalls()).toEqual([[true, { visibleOnFullScreen: true, skipTransformProcessType: true }]])
  })

  it('窗口隐藏时唤起：标志关→开一次重新归到当前空间', async () => {
    await createAndReady('darwin')
    win.setVisibleOnAllWorkspaces.mockClear()
    windowMod.showSearchWindow()
    expect(workspaceCalls()).toEqual([
      [false, { skipTransformProcessType: true }],
      [true, { visibleOnFullScreen: true, skipTransformProcessType: true }]
    ])
  })

  it('窗口已可见时唤起：不翻动标志（防把窗踢出所在空间）', async () => {
    await createAndReady('darwin')
    win.isVisible.mockReturnValue(true)
    win.setVisibleOnAllWorkspaces.mockClear()
    windowMod.showSearchWindow()
    expect(workspaceCalls()).toEqual([[true, { visibleOnFullScreen: true, skipTransformProcessType: true }]])
  })

  it('建窗+唤起全程没有任何一次调用缺 skipTransformProcessType（缺了进程会被转回前台型）', async () => {
    await createAndReady('darwin')
    windowMod.showSearchWindow()
    win.isVisible.mockReturnValue(false)
    windowMod.showSearchWindow()
    const calls = workspaceCalls()
    expect(calls.length).toBeGreaterThan(0)
    for (const [, opts] of calls) expect(opts?.skipTransformProcessType).toBe(true)
    // 关标志只会剥掉「含全屏空间」，开标志必须每次都把它挂回来
    for (const [visible, opts] of calls) {
      if (visible) expect(opts?.visibleOnFullScreen).toBe(true)
    }
  })

  it('唤起顺序：全空间可见 → 置顶 → 不激活显示 → 置顶序 → 取焦点（先落到当前空间再要键盘）', async () => {
    await createAndReady('darwin')
    windowMod.showSearchWindow()
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver', 1)
    expect(lastOrder(win.setVisibleOnAllWorkspaces)).toBeLessThan(lastOrder(win.setAlwaysOnTop))
    expect(lastOrder(win.setAlwaysOnTop)).toBeLessThan(lastOrder(win.showInactive))
    expect(lastOrder(win.showInactive)).toBeLessThan(lastOrder(win.moveTop))
    expect(lastOrder(win.moveTop)).toBeLessThan(lastOrder(win.focus))
    expect(win.show).not.toHaveBeenCalled()
    // 隐藏不再复位标志：复位走的 Electron 默认路径正是把进程转回前台型的入口
    windowMod.hideSearchWindow()
    expect(workspaceCalls().filter(([visible]) => !visible)).toHaveLength(1)
    expect(win.hide).toHaveBeenCalledTimes(1)
  })

  it('win32：不碰全空间标志，走 show + focus', async () => {
    await createAndReady('win32')
    windowMod.showSearchWindow()
    expect(win.setVisibleOnAllWorkspaces).not.toHaveBeenCalled()
    expect(win.show).toHaveBeenCalledTimes(1)
    expect(win.focus).toHaveBeenCalledTimes(1)
    expect(win.showInactive).not.toHaveBeenCalled()
  })
})
