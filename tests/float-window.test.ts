import { describe, expect, it } from 'vitest'
import {
  FloatWindowManager,
  MAX_FLOAT_WINDOWS_PER_PLUGIN,
  buildFloatDocument,
  clampFloatSize,
  floatDataURL
} from '../src/main/services/float-window'
import type { FloatWindowLike } from '../src/main/services/float-window'

class FakeFloatWindow implements FloatWindowLike {
  readonly webContentsId: number
  loadedURLs: string[] = []
  bounds: Record<string, number> = {}
  alwaysOnTop = false
  resizable = false
  opacity = 1
  focused = 0
  closedCount = 0
  destroyed = false
  private closedListeners: Array<() => void> = []

  constructor(webContentsId: number) {
    this.webContentsId = webContentsId
  }

  loadURL(url: string): void {
    this.loadedURLs.push(url)
  }
  setBounds(b: { x?: number; y?: number; width?: number; height?: number }): void {
    Object.assign(this.bounds, b)
  }
  setAlwaysOnTop(v: boolean): void {
    this.alwaysOnTop = v
  }
  setResizable(v: boolean): void {
    this.resizable = v
  }
  setOpacity(v: number): void {
    this.opacity = v
  }
  focus(): void {
    this.focused++
  }
  close(): void {
    this.closedCount++
    for (const cb of this.closedListeners) cb()
  }
  destroy(): void {
    this.destroyed = true
    for (const cb of this.closedListeners) cb()
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  on(_ev: 'closed', cb: () => void): void {
    this.closedListeners.push(cb)
  }
  emitClosed(): void {
    for (const cb of this.closedListeners) cb()
  }
}

function setup(): {
  manager: FloatWindowManager
  windows: FakeFloatWindow[]
  hostOptions: Array<Record<string, unknown>>
  events: Array<{ pluginId: string; payload: { id: string; event: string; payload: unknown } }>
} {
  const windows: FakeFloatWindow[] = []
  const hostOptions: Array<Record<string, unknown>> = []
  const events: Array<{ pluginId: string; payload: { id: string; event: string; payload: unknown } }> = []
  let nextId = 1
  const manager = new FloatWindowManager({
    createWindow: (o) => {
      const w = new FakeFloatWindow(nextId++)
      w.bounds = { width: o.width, height: o.height, x: o.x, y: o.y }
      windows.push(w)
      hostOptions.push(o as unknown as Record<string, unknown>)
      return w
    },
    getWorkArea: () => ({ x: 100, y: 50, width: 1000, height: 800 }),
    onFloatEvent: (pluginId, payload) => events.push({ pluginId, payload })
  })
  return { manager, windows, hostOptions, events }
}

describe('float-window 纯函数', () => {
  it('clampFloatSize 夹在 [80, 4000]', () => {
    expect(clampFloatSize(10)).toBe(80)
    expect(clampFloatSize(5000)).toBe(4000)
    expect(clampFloatSize(360.6)).toBe(361)
  })

  it('文档骨架注入默认样式与拖动工具类', () => {
    const doc = buildFloatDocument('<div class="drag">hi</div>')
    expect(doc).toContain('<div class="drag">hi</div>')
    expect(doc).toContain('-webkit-app-region:drag')
    expect(doc).toContain('-webkit-app-region:no-drag')
    expect(doc).toContain('margin:0')
  })

  it('floatDataURL 编码为 data URL', () => {
    const url = floatDataURL('<b>x</b>')
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(url.split(',', 2)[1])).toContain('<b>x</b>')
  })
})

describe('FloatWindowManager 生命周期', () => {
  it('create 返回命名空间 id，内容经 data URL 加载，默认居中于工作区', () => {
    const { manager, windows } = setup()
    const id = manager.create('img-float', { html: '<img src="data:image/png;base64,xxx">', width: 400, height: 300 })
    expect(id).toBe('img-float#1')
    expect(windows[0].loadedURLs).toHaveLength(1)
    expect(windows[0].bounds).toEqual({ width: 400, height: 300, x: 100 + (1000 - 400) / 2, y: 50 + (800 - 300) / 2 })
  })

  it('显式坐标直接使用；尺寸越界被夹紧', () => {
    const { manager, windows } = setup()
    manager.create('p', { html: 'x', x: 5, y: 6, width: 9999, height: 1 })
    expect(windows[0].bounds).toEqual({ width: 4000, height: 80, x: 5, y: 6 })
  })

  it('空 html / 超长 html / 非对象参数拒绝', () => {
    const { manager } = setup()
    expect(() => manager.create('p', { html: '' })).toThrow(/html/)
    expect(() => manager.create('p', { html: '  ' })).toThrow(/html/)
    expect(() => manager.create('p', { html: 'a'.repeat(2_000_001) })).toThrow(/上限/)
    expect(() => manager.create('p', null as never)).toThrow(/对象/)
  })

  it(`单插件浮窗上限 ${MAX_FLOAT_WINDOWS_PER_PLUGIN}，超限拒绝`, () => {
    const { manager } = setup()
    for (let i = 0; i < MAX_FLOAT_WINDOWS_PER_PLUGIN; i++) {
      manager.create('p', { html: 'x' })
    }
    expect(() => manager.create('p', { html: 'x' })).toThrow(/上限/)
    expect(manager.countFor('p')).toBe(MAX_FLOAT_WINDOWS_PER_PLUGIN)
    // 其他插件不受影响
    expect(manager.create('q', { html: 'x' })).toBe('q#1')
  })

  it('update 应用 html/尺寸/层级/透明度/聚焦，未知 id 或他人浮窗拒绝', () => {
    const { manager, windows } = setup()
    const id = manager.create('p', { html: 'a' })
    manager.update('p', id, { html: 'b', width: 200, alwaysOnTop: false, opacity: 0.5, focus: true })
    const w = windows[0]
    expect(w.loadedURLs).toHaveLength(2)
    expect(w.bounds.width).toBe(200)
    expect(w.alwaysOnTop).toBe(false)
    expect(w.opacity).toBe(0.5)
    expect(w.focused).toBe(1)
    expect(() => manager.update('p', 'p#99', { html: 'c' })).toThrow(/不存在/)
    expect(() => manager.update('q', id, { html: 'c' })).toThrow(/不属于/)
  })

  it('close 后注册表清理，closed 事件同样清理（窗口泄漏防护）', () => {
    const { manager, windows } = setup()
    const id = manager.create('p', { html: 'x' })
    manager.close('p', id)
    expect(manager.countFor('p')).toBe(0)
    expect(() => manager.update('p', id, { html: 'y' })).toThrow(/不存在/)

    const id2 = manager.create('p', { html: 'x' })
    expect(manager.countFor('p')).toBe(1)
    expect(id2).toBe('p#2')
    windows[1].emitClosed() // 用户手动点系统关闭
    expect(manager.countFor('p')).toBe(0)
  })

  it('closeAllForPlugin 只关自己；closeAll 全关', () => {
    const { manager, windows } = setup()
    manager.create('p', { html: 'x' })
    manager.create('p', { html: 'x' })
    manager.create('q', { html: 'x' })
    manager.closeAllForPlugin('p')
    expect(manager.countFor('p')).toBe(0)
    expect(manager.countFor('q')).toBe(1)
    manager.closeAll()
    expect(manager.countFor('q')).toBe(0)
    expect(windows.every((w) => w.closedCount >= 1)).toBe(true)
  })

  it('浮窗页事件按 webContents 定位并回传创建方插件', () => {
    const { manager, windows, events } = setup()
    manager.create('todo', { html: 'x' })
    const wcId = windows[0].webContentsId
    expect(manager.emitFromWebContents(wcId, 'toggle', { done: true })).toBe(true)
    expect(events).toEqual([{ pluginId: 'todo', payload: { id: 'todo#1', event: 'toggle', payload: { done: true } } }])
    expect(manager.emitFromWebContents(99999, 'x', null)).toBe(false)
    const info = manager.infoByWebContents(wcId)
    expect(info).toEqual({ id: 'todo#1', pluginId: 'todo' })
  })

  it('closeByWebContents 只关对应浮窗', () => {
    const { manager, windows } = setup()
    manager.create('p', { html: 'x' })
    manager.create('p', { html: 'y' })
    expect(manager.closeByWebContents(windows[0].webContentsId)).toBe(true)
    expect(manager.countFor('p')).toBe(1)
    expect(manager.closeByWebContents(windows[0].webContentsId)).toBe(false)
  })
})
