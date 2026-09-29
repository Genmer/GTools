import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 照 ipc-update.test.ts 的 electron/window mock 脚手架；getPath 指向临时 userData，供 utools-plugins 目录扫描
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  app: {
    getPath: vi.fn(() => userDataRoot),
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
import { getSearchWindow, hideSearchWindow } from '../src/main/window'
import { SettingsStore, type FsLike } from '../src/main/settings-store'
import { unregisterAllHotkeys } from '../src/main/shortcut'

type HostReply = { ok: boolean; data?: unknown; error?: string; warnings?: string[] }
type Host = (e: { sender: { id: number; once: Mock; removeListener: Mock } }, req: { api: string; payload?: unknown }) => Promise<HostReply>
type UtoolsEntry = { id: string; manifest?: { name: string; main: string }; error?: string }

let userDataRoot = ''

/** sender 带 once/removeListener：serve 会往承载 webContents 挂 destroyed 兜底监听 */
const sender = (): { sender: { id: number; once: Mock; removeListener: Mock } } => ({
  sender: { id: 1, once: vi.fn(), removeListener: vi.fn() }
})

const noopFs: FsLike = {
  readFile: vi.fn(async () => {
    throw new Error('no file')
  }),
  writeFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {})
}

const DEMO_JSON = JSON.stringify({
  pluginName: '演示插件',
  description: 'demo',
  version: '1.0.0',
  main: 'index.html',
  logo: 'logo.png',
  preload: 'preload.js',
  features: [{ code: 'demo', explain: '演示', cmds: ['演示', { type: 'over', label: '覆盖' }] }]
})

/** boot：userData 指向临时目录，clipboard.writeText / notification.show 用 fake 供 utools:api 断言 */
async function boot(): Promise<{ host: Host; clipboardWrite: Mock; notificationShow: Mock }> {
  const store = new SettingsStore(userDataRoot, noopFs, 1)
  const loader = {
    registry: { all: () => [], get: vi.fn() },
    issues: [],
    externalDetected: [],
    ensureBackendStarted: vi.fn(async () => undefined),
    setEnabled: vi.fn(async () => ({ ok: true }))
  }
  const clipboardWrite = vi.fn(async () => {})
  const notificationShow = vi.fn(async () => {})
  unregisterAllHotkeys()
  setupIpc({
    loader,
    settings: store,
    services: {
      window: { float: { closeAllForPlugin: vi.fn() } },
      storage: { dumpAll: vi.fn(async () => ({})), replaceAll: vi.fn(async () => {}) },
      app: { version: '0.0.1', platform: 'darwin', arch: 'arm64' },
      clipboard: { readText: vi.fn(async () => ''), writeText: clipboardWrite },
      notification: { show: notificationShow },
      net: { fetch: vi.fn(async () => ({ ok: true, status: 200, body: '{}' })) },
      shell: { openExternal: vi.fn(async () => {}) }
    },
    apiCenter: { config: {}, sanitized: () => ({}), replaceAll: vi.fn(async () => {}) },
    nativeApps: {},
    detached: { applyThemeToAll: vi.fn(), closeForPlugin: vi.fn(), open: vi.fn(), closeByWebContents: vi.fn(), setAlwaysOnTopFor: vi.fn() },
    onHotkeyToggle: vi.fn()
  } as unknown as Parameters<typeof setupIpc>[0])
  const call = (ipcMain.handle as unknown as Mock).mock.calls.find(([ch]) => ch === 'gtools:host')
  if (!call) throw new Error('gtools:host 未注册')
  return { host: call[1] as Host, clipboardWrite, notificationShow }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSearchWindow).mockReturnValue(null)
})

function withFakeWindow(webContentsId = 1): void {
  vi.mocked(getSearchWindow).mockReturnValue({
    webContents: { id: webContentsId, on: vi.fn(), send: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false }
  } as unknown as ReturnType<typeof getSearchWindow>)
}

beforeAll(async () => {
  userDataRoot = await mkdtemp(join(tmpdir(), 'utools-ipc-'))
  const dir = join(userDataRoot, 'utools-plugins')
  await mkdir(join(dir, 'demo'), { recursive: true })
  await writeFile(join(dir, 'demo', 'plugin.json'), DEMO_JSON)
  await writeFile(join(dir, 'demo', 'index.html'), '<html><head><title>d</title></head><body>demo</body></html>')
  await mkdir(join(dir, 'broken'), { recursive: true })
  await writeFile(join(dir, 'broken', 'plugin.json'), '{oops')
})

afterAll(async () => {
  await rm(userDataRoot, { recursive: true, force: true })
})

describe('gtools:host utools:list', () => {
  it('扫描结果直接下发：好目录带 manifest，坏目录带原因（此通道不设主窗守卫）', async () => {
    const { host } = await boot()
    const r = await host(sender(), { api: 'utools:list' })
    expect(r.ok).toBe(true)
    const entries = r.data as UtoolsEntry[]
    expect(entries.map((e) => e.id)).toEqual(['broken', 'demo'])
    expect(entries.find((e) => e.id === 'demo')?.manifest?.name).toBe('演示插件')
    expect(entries.find((e) => e.id === 'demo')?.manifest?.main).toBe('index.html')
    expect(entries.find((e) => e.id === 'broken')?.error).toContain('JSON')
  })
})

describe('gtools:host utools:serve', () => {
  it('未知 id / 清单非法目录 / 缺 id 三类拒绝', async () => {
    const { host } = await boot()
    withFakeWindow()
    await expect(host(sender(), { api: 'utools:serve', payload: { id: 'nosuch' } })).resolves.toEqual({
      ok: false,
      error: 'uTools 插件不存在或清单无效'
    })
    await expect(host(sender(), { api: 'utools:serve', payload: { id: 'broken' } })).resolves.toEqual({
      ok: false,
      error: 'uTools 插件不存在或清单无效'
    })
    await expect(host(sender(), { api: 'utools:serve', payload: {} })).resolves.toEqual({ ok: false, error: '缺少插件 id' })
  })

  it('已知插件返回 127.0.0.1 直达 main 的 url，页面可取且注入 shim', async () => {
    const { host } = await boot()
    withFakeWindow()
    const r = await host(sender(), { api: 'utools:serve', payload: { id: 'demo' } })
    expect(r.ok).toBe(true)
    const url = (r.data as { url: string }).url
    try {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/demo\/index\.html$/)
      const res = await fetch(url)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
      expect(await res.text()).toContain('__gtools-shim.js')
    } finally {
      await host(sender(), { api: 'utools:stop' })
    }
  })

  it('非主搜索窗口 sender 被守卫拒绝（无主窗 / sender id 不匹配）', async () => {
    const { host } = await boot()
    // 无主窗（getSearchWindow 为 null）→ 守卫恒 false
    await expect(host(sender(), { api: 'utools:serve', payload: { id: 'demo' } })).resolves.toEqual({
      ok: false,
      error: '仅主搜索窗口可调用'
    })
    // 主窗存在但 webContents.id 与 sender 不一致
    withFakeWindow(7)
    await expect(host(sender(), { api: 'utools:serve', payload: { id: 'demo' } })).resolves.toEqual({
      ok: false,
      error: '仅主搜索窗口可调用'
    })
  })

  it('并发 serve 复用同一实例：两次 Promise.all 返回同 URL（泄漏的先者会给出不同端口）', async () => {
    const { host } = await boot()
    withFakeWindow()
    try {
      const [a, b] = await Promise.all([
        host(sender(), { api: 'utools:serve', payload: { id: 'demo' } }),
        host(sender(), { api: 'utools:serve', payload: { id: 'demo' } })
      ])
      expect(a.ok).toBe(true)
      expect(b.ok).toBe(true)
      expect((a.data as { url: string }).url).toBe((b.data as { url: string }).url)
      expect((a.data as { url: string }).url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    } finally {
      await host(sender(), { api: 'utools:stop' })
    }
  })

  it('承载窗口 destroyed 兜底停服：旧端口失效，再 serve 换新实例', async () => {
    const { host } = await boot()
    withFakeWindow()
    const s = sender()
    const served = await host(s, { api: 'utools:serve', payload: { id: 'demo' } })
    expect(served.ok).toBe(true)
    const oldUrl = (served.data as { url: string }).url
    try {
      // destroyed 监听应已挂在承载 sender 上；触发它模拟窗口被关/崩溃重载（渲染层 unmount 不会执行）
      const destroyed = s.sender.once.mock.calls.find(([ev]) => ev === 'destroyed')?.[1] as (() => void) | undefined
      if (typeof destroyed !== 'function') throw new Error('destroyed 兜底监听未挂载')
      destroyed()
      await vi.waitFor(async () => {
        await expect(fetch(oldUrl)).rejects.toThrow()
      })
      const again = await host(sender(), { api: 'utools:serve', payload: { id: 'demo' } })
      expect(again.ok).toBe(true)
      expect((again.data as { url: string }).url).not.toBe(oldUrl)
    } finally {
      await host(sender(), { api: 'utools:stop' })
    }
  })
})

describe('gtools:host utools:stop', () => {
  it('关闭静态服务后端口不可再连；重复 stop 幂等', async () => {
    const { host } = await boot()
    withFakeWindow()
    const served = await host(sender(), { api: 'utools:serve', payload: { id: 'demo' } })
    const url = (served.data as { url: string }).url
    await expect(host(sender(), { api: 'utools:stop' })).resolves.toEqual({ ok: true, data: null })
    await expect(fetch(url)).rejects.toThrow()
    await expect(host(sender(), { api: 'utools:stop' })).resolves.toEqual({ ok: true, data: null })
  })

  it('无主窗 sender 被守卫拒绝', async () => {
    const { host } = await boot()
    await expect(host(sender(), { api: 'utools:stop' })).resolves.toEqual({ ok: false, error: '仅主搜索窗口可调用' })
  })
})

describe('gtools:host utools:api', () => {
  it('hideMainWindow 真调主窗隐藏', async () => {
    const { host } = await boot()
    withFakeWindow()
    const r = await host(sender(), { api: 'utools:api', payload: { action: 'hideMainWindow' } })
    expect(r).toEqual({ ok: true, data: null })
    expect(hideSearchWindow).toHaveBeenCalledTimes(1)
  })

  it('copyText 走 clipboard 服务；text 非字符串拒绝且不写剪贴板', async () => {
    const { host, clipboardWrite } = await boot()
    withFakeWindow()
    const r = await host(sender(), { api: 'utools:api', payload: { action: 'copyText', payload: { text: '复制我' } } })
    expect(r).toEqual({ ok: true, data: null })
    expect(clipboardWrite).toHaveBeenCalledWith('复制我')
    const bad = await host(sender(), { api: 'utools:api', payload: { action: 'copyText', payload: { text: 42 } } })
    expect(bad).toEqual({ ok: false, error: 'text 必须是字符串' })
    expect(clipboardWrite).toHaveBeenCalledTimes(1)
  })

  it('notify 走 notification 服务；body 非字符串拒绝', async () => {
    const { host, notificationShow } = await boot()
    withFakeWindow()
    const r = await host(sender(), { api: 'utools:api', payload: { action: 'notify', payload: { body: '完成了' } } })
    expect(r).toEqual({ ok: true, data: null })
    expect(notificationShow).toHaveBeenCalledWith('UTools 插件', '完成了')
    const bad = await host(sender(), { api: 'utools:api', payload: { action: 'notify', payload: { body: null } } })
    expect(bad).toEqual({ ok: false, error: 'body 必须是字符串' })
    expect(notificationShow).toHaveBeenCalledTimes(1)
  })

  it('未知 action 拒绝并报中文错误', async () => {
    const { host } = await boot()
    withFakeWindow()
    const r = await host(sender(), { api: 'utools:api', payload: { action: 'exec', payload: {} } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('未知 utools api')
  })

  it('非主搜索窗口 sender 被守卫拒绝，hideSearchWindow 不被调', async () => {
    const { host } = await boot()
    const r = await host(sender(), { api: 'utools:api', payload: { action: 'hideMainWindow' } })
    expect(r).toEqual({ ok: false, error: '仅主搜索窗口可调用' })
    expect(hideSearchWindow).not.toHaveBeenCalled()
  })
})
