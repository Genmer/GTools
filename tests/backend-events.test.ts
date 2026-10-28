import { describe, expect, it, vi } from 'vitest'

// T6：backend 事件订阅补桩。只测事件面，electron 依赖全部桩化
vi.mock('electron', () => ({
  app: { getFileIcon: vi.fn(), getVersion: vi.fn(() => '0.0.0-test') },
  clipboard: { readText: vi.fn(async () => '') },
  ClipboardItem: class {},
  desktopCapturer: { getSources: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  nativeImage: { createFromDataURL: vi.fn(), createFromBuffer: vi.fn(), createFromPath: vi.fn() },
  net: { fetch: vi.fn() },
  Notification: class {},
  screen: { getPrimaryDisplay: vi.fn(), getCursorScreenPoint: vi.fn(), getDisplayNearestPoint: vi.fn() },
  shell: {},
  BrowserWindow: class {}
}))

// showMain 装配测试用：主窗模块桩化（唤窗 + host:open-plugin 发送面可观测）
const mainWin = vi.hoisted(() => {
  const state = { shown: 0, sent: [] as { channel: string; payload: unknown }[] }
  return {
    state,
    getSearchWindow: () => ({ webContents: { send: (channel: string, payload: unknown) => state.sent.push({ channel, payload }) } }),
    showSearchWindow: () => {
      state.shown++
    }
  }
})
vi.mock('../src/main/window', () => ({ getSearchWindow: mainWin.getSearchWindow, showSearchWindow: mainWin.showSearchWindow }))

import { createElectronServices } from '../src/main/services/electron-services'
import { createBackendContext } from '../src/main/services/dispatch'
import type { ServiceBag } from '../src/main/services/dispatch'
import { PluginRegistry } from '../src/main/plugin-registry'
import type { PluginManifest } from '@sdk/manifest'

type Target = { isDestroyed(): boolean; webContents: { send(channel: string, payload: unknown): void } }

interface FakeWin extends Target {
  sent: { channel: string; payload: unknown }[]
}

function fakeWin(): FakeWin {
  const w: FakeWin = {
    sent: [],
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown): void => {
        w.sent.push({ channel, payload })
      }
    }
  }
  return w
}

function makeServices(windows: Target[]): ServiceBag {
  return createElectronServices({
    storageRoot: '/tmp/gtools-test-storage',
    appVersion: '0.0.0-test',
    getWindow: () => null,
    hideWindow: () => {},
    listWindows: () => windows,
    apiCenter: {} as never
  })
}

function manifest(id: string, permissions: PluginManifest['permissions']): PluginManifest {
  return {
    id,
    name: id,
    version: '0.1.0',
    protocolVersion: 1,
    icon: 'x',
    keywords: [id],
    activation: 'resident',
    permissions,
    source: 'builtin',
    entry: './index.vue',
    backend: './backend/index.ts'
  }
}

function makeRegistry(): PluginRegistry {
  const reg = new PluginRegistry()
  reg.register(manifest('timer', ['storage', 'notification', 'window:float', 'window:hide']), true)
  reg.register(manifest('other', ['storage']), true)
  return reg
}

describe('backend 事件订阅（onPluginEvent / emit 双投递）', () => {
  it('backend on 订阅 float-event → services.events.emit 投递到订阅者且载荷原样；渲染层窗口同时收到', () => {
    const win = fakeWin()
    const services = makeServices([win])
    const seen: unknown[] = []
    const ctx = createBackendContext(makeRegistry(), services, 'timer')
    const off = ctx.events.on('float-event', (p) => seen.push(p))

    services.events.emit('timer', 'float-event', { id: 'timer#1', event: 'ball-action', payload: { action: 'click' } })
    expect(seen).toEqual([{ id: 'timer#1', event: 'ball-action', payload: { action: 'click' } }])
    expect(win.sent).toEqual([
      { channel: 'plugin-event:timer', payload: { event: 'float-event', payload: { id: 'timer#1', event: 'ball-action', payload: { action: 'click' } } } }
    ])
    off()
  })

  it('退订生效：off 后同 event 不再收到', () => {
    const services = makeServices([])
    const seen: unknown[] = []
    const ctx = createBackendContext(makeRegistry(), services, 'timer')
    const off = ctx.events.on('float-event', (p) => seen.push(p))
    off()
    services.events.emit('timer', 'float-event', 1)
    expect(seen).toEqual([])
  })

  it('事件名与插件隔离：别的 event / 别的插件不投递', () => {
    const services = makeServices([])
    const seen: unknown[] = []
    const ctx = createBackendContext(makeRegistry(), services, 'timer')
    ctx.events.on('float-event', (p) => seen.push(p))
    services.events.emit('timer', 'timer-changed', 1)
    services.events.emit('other', 'float-event', 2)
    expect(seen).toEqual([])
  })

  it('backend ctx.emit 只发渲染层不自环（不触发 backend 订阅者）', () => {
    const win = fakeWin()
    const services = makeServices([win])
    const seen: unknown[] = []
    const ctx = createBackendContext(makeRegistry(), services, 'timer')
    ctx.events.on('timer-changed', (p) => seen.push(p))

    ctx.emit('timer-changed', { hello: 1 })
    expect(win.sent).toHaveLength(1) // 渲染层收到
    expect(seen).toEqual([]) // backend 订阅者不自环
  })

  it('订阅者抛错不影响其余订阅者与渲染层投递', () => {
    const win = fakeWin()
    const services = makeServices([win])
    const ctx = createBackendContext(makeRegistry(), services, 'timer')
    const boom = vi.fn(() => {
      throw new Error('subscriber crash')
    })
    const ok: unknown[] = []
    ctx.events.on('float-event', boom)
    ctx.events.on('float-event', (p) => ok.push(p))

    expect(() => services.events.emit('timer', 'float-event', 'x')).not.toThrow()
    expect(boom).toHaveBeenCalledTimes(1)
    expect(ok).toEqual(['x'])
    expect(win.sent).toHaveLength(1)
  })
})

describe('electron-services window.showMain（唤主窗 + host:open-plugin 直达装配）', () => {
  it('带 pluginId：唤起主窗并向其发 host:open-plugin（pluginId/commandId/query 原样）', async () => {
    mainWin.state.shown = 0
    mainWin.state.sent.length = 0
    const services = makeServices([])
    await services.window.showMain({ pluginId: 'timer', commandId: 'countdown', query: '90s' })
    expect(mainWin.state.shown).toBe(1)
    expect(mainWin.state.sent).toEqual([
      { channel: 'host:open-plugin', payload: { pluginId: 'timer', commandId: 'countdown', query: '90s' } }
    ])
  })

  it('无参 / 缺 pluginId：仅唤主窗，不发 open-plugin', async () => {
    mainWin.state.shown = 0
    mainWin.state.sent.length = 0
    const services = makeServices([])
    await services.window.showMain()
    await services.window.showMain({ commandId: 'pomodoro' })
    expect(mainWin.state.shown).toBe(2)
    expect(mainWin.state.sent).toEqual([])
  })
})
