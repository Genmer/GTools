import { describe, expect, it, vi, type Mock } from 'vitest'
import type { ThemeName } from '../src/main/settings-store'
import {
  DETACHED_DEFAULT_H,
  DETACHED_DEFAULT_W,
  DETACHED_FLUSH_EVENT,
  DETACHED_FLUSH_TIMEOUT_MS,
  DETACHED_THEME_EVENT,
  DetachedWindowManager,
  type DetachedWindowLike,
  type DetachedWindowOptions
} from '../src/main/detached-window-manager'

interface FakeWindow extends DetachedWindowLike {
  loadURL: Mock<(url: string) => void>
  show: Mock<() => void>
  hide: Mock<() => void>
  focus: Mock<() => void>
  setAlwaysOnTop: Mock<(v: boolean, level?: 'floating') => void>
  applyTheme: Mock<(theme: ThemeName) => void>
  close: Mock<() => void>
  destroy: Mock<() => void>
  sent: { channel: string; payload: unknown }[]
  /** 模拟原生 close 语义：监听器 preventDefault 则窗口存活，否则销毁并收 closed；返回是否被拦下 */
  emitClose(): boolean
  emitClosed(): void
  emitReadyToShow(): void
  setDestroyed(): void
}

function makeFakeWindow(webContentsId: number): FakeWindow {
  const closedListeners: (() => void)[] = []
  const closeListeners: ((e: { preventDefault(): void }) => void)[] = []
  const readyListeners: (() => void)[] = []
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
    hide: vi.fn(() => {}),
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
    on: (event: 'closed' | 'close', cb: (e: { preventDefault(): void }) => void): void => {
      if (event === 'closed') closedListeners.push(cb as () => void)
      else if (event === 'close') closeListeners.push(cb)
    },
    once: (event: 'ready-to-show', cb: () => void): void => {
      if (event === 'ready-to-show') readyListeners.push(cb)
    },
    sent,
    emitClose: (): boolean => {
      let prevented = false
      const e = {
        preventDefault: (): void => {
          prevented = true
        }
      }
      for (const cb of [...closeListeners]) cb(e)
      if (!prevented) {
        destroyed = true
        for (const cb of [...closedListeners]) cb()
      }
      return prevented
    },
    emitClosed: (): void => {
      destroyed = true
      for (const cb of [...closedListeners]) cb()
    },
    emitReadyToShow: (): void => {
      for (const cb of [...readyListeners]) cb()
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
  it('同插件重复 open 只建一扇窗并聚焦复用；show 等 ready-to-show 首帧再显', () => {
    const windows: FakeWindow[] = []
    const { manager, createWindow } = makeManager(windows)
    expect(manager.open('calc', '1+1')).toBe('created')
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(windows[0].loadURL).toHaveBeenCalledWith('app://renderer/#detached=true&plugin=calc&query=1%2B1')
    // 首帧未就绪不显窗（防空窗闪现），就绪后补显
    expect(windows[0].show).not.toHaveBeenCalled()
    windows[0].emitReadyToShow()
    expect(windows[0].show).toHaveBeenCalled()
    expect(manager.has('calc')).toBe(true)

    expect(manager.open('calc', '2+2')).toBe('focused')
    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(windows[0].focus).toHaveBeenCalled()
    // 聚焦复用不重载 URL，保持窗口内现场
    expect(windows[0].loadURL).toHaveBeenCalledTimes(1)
  })

  it('ready-to-show 前窗口被销毁：不补 show（防销毁后调用）', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('calc', '')
    windows[0].emitClosed()
    expect(() => windows[0].emitReadyToShow()).not.toThrow()
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
    expect(windows[0].destroy).toHaveBeenCalled()
    expect(windows[0].hide).not.toHaveBeenCalled()
    expect(manager.has('calc')).toBe(false)
    expect(manager.has('markdown-notes')).toBe(true)
  })

  it('closeAll 全量清理且幂等（直接 destroy，已销毁窗口只清注册表不补刀）', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('calc', '')
    manager.open('translate', '')
    windows[1].setDestroyed()
    manager.closeAll()
    expect(windows[0].destroy).toHaveBeenCalledTimes(1)
    expect(windows[0].sent).toEqual([])
    expect(windows[1].destroy).not.toHaveBeenCalled()
    expect(manager.has('calc')).toBe(false)
    expect(manager.has('translate')).toBe(false)
    expect(() => manager.closeAll()).not.toThrow()
  })

  it('applyThemeToAll 同步原生主题并向所有存活窗口广播 detached:theme（含 outline）', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('calc', '')
    manager.open('markdown-notes', '')
    windows[1].setDestroyed()
    const tx = { enabled: true, opacity: 55, blur: true, glassFrost: 45 }
    const outline = { enabled: true, width: 4, color: 'rainbow' as const }
    manager.applyThemeToAll('dark', tx, outline)
    expect(windows[0].applyTheme).toHaveBeenCalledWith('dark', tx)
    expect(windows[0].sent).toEqual([{ channel: DETACHED_THEME_EVENT, payload: { theme: 'dark', transparency: tx, outline } }])
    // 已销毁窗口原生调用抛错被吞掉，CSS 事件也不再发送
    expect(windows[1].sent).toEqual([])
  })

  it('applyThemeToAll 轮廓环关闭（enabled=false）也广播：四字段原样传递，由接收端 data-ring=off 消化', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('calc', '')
    const outline = { enabled: false, width: 2, color: 'custom' as const, customColor: '#aabbcc' }
    manager.applyThemeToAll('light', { enabled: false, opacity: 20, blur: false, glassFrost: 45 }, outline)
    expect(windows[0].sent).toHaveLength(1)
    const msg = windows[0].sent[0]
    expect(msg.channel).toBe(DETACHED_THEME_EVENT)
    // 载荷形状恰好三段 theme/transparency/outline，outline 四字段逐项原样（false 不丢、宽度不重夹取、hex 不重洗）
    expect(Object.keys(msg.payload as object).sort()).toEqual(['outline', 'theme', 'transparency'])
    expect(msg.payload).toEqual({
      theme: 'light',
      transparency: { enabled: false, opacity: 20, blur: false, glassFrost: 45 },
      outline: { enabled: false, width: 2, color: 'custom', customColor: '#aabbcc' }
    })
  })
})

describe('DetachedWindowManager 按 webContents 定位（独立窗口自管通道）', () => {
  it('closeByWebContents / setAlwaysOnTopFor 只作用于发送方窗口（关窗两段式：ACK 后才销毁）', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('calc', '')
    manager.open('translate', '')
    expect(manager.setAlwaysOnTopFor(windows[1].webContentsId, true)).toBe(true)
    expect(windows[1].setAlwaysOnTop).toHaveBeenCalledWith(true, 'floating')
    expect(windows[0].setAlwaysOnTop).not.toHaveBeenCalled()
    expect(manager.closeByWebContents(windows[0].webContentsId)).toBe(true)
    expect(manager.has('calc')).toBe(true)
    expect(manager.closeByWebContents(windows[0].webContentsId)).toBe(true)
    expect(windows[0].destroy).toHaveBeenCalledTimes(1)
    expect(manager.has('calc')).toBe(false)
    expect(manager.closeByWebContents(99999)).toBe(false)
    expect(manager.setAlwaysOnTopFor(99999, true)).toBe(false)
  })
})

describe('DetachedWindowManager 两阶段关闭（detached 关窗草稿冲刷）', () => {
  it('closeByWebContents 未冲刷时只 hide+发 detached:flush 不销毁；第二次调用即 ACK 真销毁', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('json-editor', '')
    const w = windows[0]
    expect(manager.closeByWebContents(w.webContentsId)).toBe(true)
    expect(w.hide).toHaveBeenCalledTimes(1)
    expect(w.sent).toEqual([{ channel: DETACHED_FLUSH_EVENT, payload: null }])
    // 冲刷等待期窗口未销毁、注册表还在（渲染层才有机会回 ACK）
    expect(w.destroy).not.toHaveBeenCalled()
    expect(w.isDestroyed()).toBe(false)
    expect(manager.has('json-editor')).toBe(true)
    // 渲染层冲刷完成后的第二次 window:close-detached 即 ACK，命中 flushing 分支直接销毁
    expect(manager.closeByWebContents(w.webContentsId)).toBe(true)
    expect(w.destroy).toHaveBeenCalledTimes(1)
  })

  it(`渲染层无 ACK 时 ${DETACHED_FLUSH_TIMEOUT_MS}ms 超时兜底销毁`, () => {
    vi.useFakeTimers()
    try {
      const windows: FakeWindow[] = []
      const { manager } = makeManager(windows)
      manager.open('json-editor', '')
      manager.closeByWebContents(windows[0].webContentsId)
      vi.advanceTimersByTime(DETACHED_FLUSH_TIMEOUT_MS - 1)
      expect(windows[0].destroy).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(windows[0].destroy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('原生 close（mac 交通灯 X / Alt+F4）被拦下转两阶段；markQuitting 后放行原生关闭', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('json-editor', '')
    const w = windows[0]
    expect(w.emitClose()).toBe(true)
    expect(w.isDestroyed()).toBe(false)
    expect(w.hide).toHaveBeenCalledTimes(1)
    expect(w.sent).toEqual([{ channel: DETACHED_FLUSH_EVENT, payload: null }])
    manager.closeByWebContents(w.webContentsId)
    expect(w.destroy).toHaveBeenCalledTimes(1)

    // 退出链路（app.quit 先逐窗 close 再 will-quit）：不拦 close，防 preventDefault 中止退出
    manager.open('json-editor', 'again')
    manager.markQuitting()
    expect(windows[1].emitClose()).toBe(false)
    expect(windows[1].isDestroyed()).toBe(true)
  })

  it('冲刷等待期内重复原生 close（二次 Esc）：不叠定时器不重发事件不早销毁，ACK 后只销毁一次', () => {
    const windows: FakeWindow[] = []
    const { manager } = makeManager(windows)
    manager.open('json-editor', '')
    const w = windows[0]
    expect(w.emitClose()).toBe(true)
    expect(w.emitClose()).toBe(true)
    // flushing 命中直接短路：hide/flush 事件各只一次，窗口仍存活等 ACK
    expect(w.hide).toHaveBeenCalledTimes(1)
    expect(w.sent).toEqual([{ channel: DETACHED_FLUSH_EVENT, payload: null }])
    expect(w.isDestroyed()).toBe(false)
    expect(w.destroy).not.toHaveBeenCalled()
    manager.closeByWebContents(w.webContentsId)
    expect(w.destroy).toHaveBeenCalledTimes(1)
    // ACK 销毁后 closed 清注册表（真实 destroy 会收 closed），迟到关闭请求返回 false 不炸
    w.emitClosed()
    expect(manager.closeByWebContents(w.webContentsId)).toBe(false)
  })

  it('冲刷中原生关闭完成（closed 清理）：泄漏的超时兜底定时器不得误杀同插件重开的新窗', () => {
    vi.useFakeTimers()
    try {
      const windows: FakeWindow[] = []
      const { manager, createWindow } = makeManager(windows)
      manager.open('json-editor', '')
      windows[0].emitClose()
      // 原生关闭在冲刷等待期内完成：closed 触发 remove，应同时清掉 flushing 定时器
      windows[0].emitClosed()
      expect(manager.has('json-editor')).toBe(false)
      // 同插件立即重开新实例（webContentsId 不同，但 byPlugin 同键）
      expect(manager.open('json-editor', 'again')).toBe('created')
      expect(createWindow).toHaveBeenCalledTimes(2)
      vi.advanceTimersByTime(DETACHED_FLUSH_TIMEOUT_MS * 2)
      // 旧窗口的兜底定时器若未清，会经 remove(rec) 误删新窗的 byPlugin 登记
      expect(manager.has('json-editor')).toBe(true)
      expect(windows[1].isDestroyed()).toBe(false)
      expect(windows[1].destroy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('超时兜底先跑、渲染层 ACK 后到：closeByWebContents 对已清记录返回 false 不炸', () => {
    vi.useFakeTimers()
    try {
      const windows: FakeWindow[] = []
      const { manager } = makeManager(windows)
      manager.open('json-editor', '')
      const w = windows[0]
      manager.closeByWebContents(w.webContentsId)
      // 600ms 到点渲染层仍未 ACK：兜底直接销毁（真实 destroy 会再收 closed 清注册表）
      vi.advanceTimersByTime(DETACHED_FLUSH_TIMEOUT_MS)
      expect(w.destroy).toHaveBeenCalledTimes(1)
      w.emitClosed()
      // 迟到的 ACK：记录已 remove，返回 false 且不重复销毁
      expect(manager.closeByWebContents(w.webContentsId)).toBe(false)
      expect(w.destroy).toHaveBeenCalledTimes(1)
      expect(manager.has('json-editor')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
