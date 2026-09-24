import { describe, expect, it, vi, type Mock } from 'vitest'
import type { ThemeName } from '../src/main/settings-store'
import {
  DETACHED_DEFAULT_H,
  DETACHED_DEFAULT_W,
  DETACHED_THEME_EVENT,
  DetachedWindowManager,
  type DetachedWindowLike,
  type DetachedWindowOptions
} from '../src/main/detached-window-manager'

interface FakeWindow extends DetachedWindowLike {
  loadURL: Mock<(url: string) => void>
  show: Mock<() => void>
  focus: Mock<() => void>
  setAlwaysOnTop: Mock<(v: boolean, level?: 'floating') => void>
  applyTheme: Mock<(theme: ThemeName) => void>
  close: Mock<() => void>
  destroy: Mock<() => void>
  sent: { channel: string; payload: unknown }[]
  emitClosed(): void
  setDestroyed(): void
}

function makeFakeWindow(webContentsId: number): FakeWindow {
  const closedListeners: (() => void)[] = []
  const sent: { channel: string; payload: unknown }[] = []
  let destroyed = false
  const win: FakeWindow = {
    webContentsId,
    webContents: {
      send: (channel: string, payload: unknown): void => {
        if (destroyed) throw new Error('Object has been destroyed')
        sent.push({ channel, payload })
      }
    },
    loadURL: vi.fn((_url: string) => {}),
    show: vi.fn(() => {}),
    focus: vi.fn(() => {}),
    setAlwaysOnTop: vi.fn((_v: boolean, _level?: 'floating') => {}),
    // 与真实 BrowserWindow 一致：销毁后调用原生方法抛错，让 applyThemeToAll 的 try/catch 生效
    applyTheme: vi.fn((_theme: ThemeName) => {
      if (destroyed) throw new Error('Object has been destroyed')
    }),
    close: vi.fn(() => {
      destroyed = true
      for (const cb of [...closedListeners]) cb()
    }),
    destroy: vi.fn(() => {
      destroyed = true
    }),
    isDestroyed: () => destroyed,
    on: (event: 'closed', cb: () => void): void => {
      if (event === 'closed') closedListeners.push(cb)
    },
    sent,
    emitClosed: (): void => {
      destroyed = true
      for (const cb of [...closedListeners]) cb()
    },
    setDestroyed: (): void => {
      destroyed = true
    }
  }
  return win
}

function makeManager(windows: FakeWindow[]): {
  manager: DetachedWindowManager
  createWindow: Mock<(opts: DetachedWindowOptions) => DetachedWindowLike>
} {
  const createWindow: Mock<(opts: DetachedWindowOptions) => DetachedWindowLike> = vi.fn(
    (_opts: DetachedWindowOptions): DetachedWindowLike => {
      const w = makeFakeWindow(100 + windows.length)
      windows.push(w)
      return w
    }
  )
  const manager = new DetachedWindowManager({
    createWindow,
    getWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
    entryUrlFor: (pluginId, query) => `app://renderer/#detached=true&plugin=${pluginId}&query=${encodeURIComponent(query)}`
  })
  return { manager, createWindow }
}

describe('DetachedWindowManager 单实例查重聚焦', () => {
  it('同插件重复 open 只建一扇窗并聚焦复用', () => {
    const windows: FakeWindow[] = []
    const { manager, createWindow } = makeManager(windows)
    expect(manager.open('calc', '1+1')).toBe('created')
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(windows[0].loadURL).toHaveBeenCalledWith('app://renderer/#detached=true&plugin=calc&query=1%2B1')
    expect(windows[0].show).toHaveBeenCalled()
    expect(manager.has('calc')).toBe(true)

    expect(manager.open('calc', '2+2')).toBe('focused')
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(windows[0].focus).toHaveBeenCalled()
    // 聚焦复用不重载 URL，保持窗口内现场
    expect(windows[0].loadURL).toHaveBeenCalledTimes(1)
  })

  it('不同插件各建一扇窗，创建参数在工作区居中', () => {
    const windows: FakeWindow[] = []
    const { manager, createWindow } = makeManager(windows)
    manager.open('calc', '')
    manager.open('translate', 'hello')
    expect(createWindow).toHaveBeenCalledTimes(2)
    expect(manager.has('translate')).toBe(true)
    const opts = createWindow.mock.calls[0][0] as DetachedWindowOptions
    expect(opts.width).toBe(DETACHED_DEFAULT_W)
    expect(opts.height).toBe(DETACHED_DEFAULT_H)
    expect(opts.x).toBe(Math.round((1920 - DETACHED_DEFAULT_W) / 2))
    expect(opts.y).toBe(Math.round((1080 - DETACHED_DEFAULT_H) / 2))
    expect(opts.alwaysOnTop).toBe(false)
  })

  it('closed 事件自清理：窗口关掉后可再开新实例', () => {
    const windows: FakeWindow[] = []
    const { manager, createWindow } = makeManager(windows)
    manager.open('calc', '')
    windows[0].emitClosed()
    expect(manager.has('calc')).toBe(false)
    expect(manager.open('calc', 'again')).toBe('created')
    expect(createWindow).toHaveBeenCalledTimes(2)
  })
})

describe('DetachedWindowManager 批量关闭与主题同步', () => {
  it('closeForPlugin 只关目标插件；禁用联动后同插件可重开', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('calc', '')
    manager.open('markdown-notes', '')
    manager.closeForPlugin('calc')
    expect(windows[0].close).toHaveBeenCalled()
    expect(manager.has('calc')).toBe(false)
    expect(manager.has('markdown-notes')).toBe(true)
  })

  it('closeAll 全量清理且幂等（已销毁窗口只清注册表，不补刀 destroy）', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('calc', '')
    manager.open('translate', '')
    windows[1].setDestroyed()
    manager.closeAll()
    expect(windows[0].close).toHaveBeenCalled()
    expect(windows[1].destroy).not.toHaveBeenCalled()
    expect(manager.has('calc')).toBe(false)
    expect(manager.has('translate')).toBe(false)
    expect(() => manager.closeAll()).not.toThrow()
  })

  it('applyThemeToAll 同步原生主题并向所有存活窗口广播 detached:theme', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('calc', '')
    manager.open('markdown-notes', '')
    windows[1].setDestroyed()
    manager.applyThemeToAll('dark')
    expect(windows[0].applyTheme).toHaveBeenCalledWith('dark')
    expect(windows[0].sent).toEqual([{ channel: DETACHED_THEME_EVENT, payload: 'dark' }])
    // 已销毁窗口原生调用抛错被吞掉，CSS 事件也不再发送
    expect(windows[1].sent).toEqual([])
  })
})

describe('DetachedWindowManager 按 webContents 定位（独立窗口自管通道）', () => {
  it('closeByWebContents / setAlwaysOnTopFor 只作用于发送方窗口', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('calc', '')
    manager.open('translate', '')
    expect(manager.setAlwaysOnTopFor(windows[1].webContentsId, true)).toBe(true)
    expect(windows[1].setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(windows[0].setAlwaysOnTop).not.toHaveBeenCalled()
    expect(manager.closeByWebContents(windows[0].webContentsId)).toBe(true)
    expect(manager.has('calc')).toBe(false)
    expect(manager.closeByWebContents(99999)).toBe(false)
    expect(manager.setAlwaysOnTopFor(99999, true)).toBe(false)
  })
})
