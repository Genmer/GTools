import { describe, expect, it, vi } from 'vitest'

// 只测事件广播面：electron 依赖全部桩化，本用例不触任何原生调用
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

import { createElectronServices } from '../src/main/services/electron-services'

type Target = { isDestroyed(): boolean; webContents: { send(channel: string, payload: unknown): void } }

interface FakeWin extends Target {
  id: number
  destroyed: boolean
  sent: { channel: string; payload: unknown }[]
}

function fakeWin(id: number): FakeWin {
  const w: FakeWin = {
    id,
    destroyed: false,
    sent: [],
    isDestroyed: () => w.destroyed,
    webContents: {
      send: (channel: string, payload: unknown): void => {
        if (w.destroyed) throw new Error('Object has been destroyed')
        w.sent.push({ channel, payload })
      }
    }
  }
  return w
}

function makeServices(windows: Target[]) {
  return createElectronServices({
    storageRoot: '/tmp/gtools-test-storage',
    appVersion: '0.0.0-test',
    getWindow: () => null,
    listWindows: () => windows,
    apiCenter: {} as never
  })
}

describe('emitToRenderer 全窗口广播（detached 独立窗收 plugin-event）', () => {
  it('主窗与全部独立窗都收到 plugin-event:<id>，载荷结构不变', () => {
    const main = fakeWin(1)
    const detached1 = fakeWin(2)
    const detached2 = fakeWin(3)
    const services = makeServices([main, detached1, detached2])
    services.events.emitToRenderer('clipboard', 'main-push', [{ title: 'T' }])
    const expected = [{ channel: 'plugin-event:clipboard', payload: { event: 'main-push', payload: [{ title: 'T' }] } }]
    expect(main.sent).toEqual(expected)
    expect(detached1.sent).toEqual(expected)
    expect(detached2.sent).toEqual(expected)
  })

  it('已销毁窗口跳过（含 send 抛竞态错兜底），其余窗口不受影响', () => {
    const alive = fakeWin(1)
    const dead = fakeWin(2)
    dead.destroyed = true
    // isDestroyed 报存活但 send 才抛错的销毁竞态窗口
    const racing = {
      isDestroyed: () => false,
      webContents: {
        send: (): void => {
          throw new Error('Object has been destroyed')
        }
      }
    }
    const services = makeServices([dead, racing, alive])
    expect(() => services.events.emitToRenderer('calc', 'tick', 1)).not.toThrow()
    expect(alive.sent).toHaveLength(1)
    expect(dead.sent).toHaveLength(0)
  })
})
