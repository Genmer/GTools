import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// shortcut.ts 顶层的 globalShortcut 来自同一份 electron mock；failAccels 可按测试切换占用键
const state = vi.hoisted(() => ({ failAccels: [] as string[] }))

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
    register: vi.fn((accel: string) => !state.failAccels.includes(accel)),
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

import { app, globalShortcut, ipcMain } from 'electron'
import { setupIpc } from '../src/main/services/ipc'
import { getSearchWindow } from '../src/main/window'
import { SettingsStore, type FsLike } from '../src/main/settings-store'
import { registerHotkey, unregisterAllHotkeys, disarmHotkeyProbe } from '../src/main/shortcut'
import type { AppSettings, CommandHotkey } from '@sdk/settings'

type HostReply = { ok: boolean; data?: unknown; error?: string; warnings?: string[] }
type Host = (e: { sender: { id: number } }, req: { api: string; payload?: unknown }) => Promise<HostReply>

const sender = (): { sender: { id: number } } => ({ sender: { id: 1 } })
const hk = (pluginId: string, commandId: string, accel: string): CommandHotkey => ({ pluginId, commandId, darwin: accel, win32: accel })

const noopFs: FsLike = {
  readFile: vi.fn(async () => {
    throw new Error('no file')
  }),
  writeFile: vi.fn(async () => {}),
  rename: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {})
}

function makeLoader() {
  const entries = new Map<string, { manifest: { id: string }; enabled: boolean }>()
  return {
    entries,
    loader: {
      registry: {
        all: () => [...entries.values()],
        get: (id: string) => entries.get(id)
      },
      issues: [] as { pluginId: string; field: string; message: string }[],
      externalDetected: [] as { manifest: { id: string; name: string } }[],
      ensureBackendStarted: vi.fn(async () => undefined),
      setEnabled: vi.fn(async (id: string, enabled: boolean) => {
        const e = entries.get(id)
        if (e) e.enabled = enabled
        return { ok: true }
      })
    }
  }
}

/** 每 test 独立一套 store/loader，setupIpc 后从 ipcMain.handle 取 gtools:host 处理器 */
async function boot(seed: Partial<AppSettings> = {}, pluginIds: string[] = []): Promise<{ store: SettingsStore; host: Host }> {
  const store = new SettingsStore('C:\\tmp\\gtools-test', noopFs, 1)
  if (Object.keys(seed).length > 0) await store.update(seed)
  const { entries, loader } = makeLoader()
  for (const id of pluginIds) entries.set(id, { manifest: { id }, enabled: true })
  unregisterAllHotkeys() // 清 shortcut.ts 模块级注册态（currentElectronAccel + commandActions）
  setupIpc({
    loader,
    settings: store,
    services: {
      window: { float: { closeAllForPlugin: vi.fn() } },
      storage: { dumpAll: vi.fn(async () => ({})), replaceAll: vi.fn(async () => {}) },
      app: { version: '0.0.0' },
      clipboard: { readText: vi.fn(async () => '') }
    },
    apiCenter: { config: {}, sanitized: () => ({}), replaceAll: vi.fn(async () => {}) },
    nativeApps: {},
    detached: { applyThemeToAll: vi.fn(), closeForPlugin: vi.fn(), open: vi.fn(), closeByWebContents: vi.fn(), setAlwaysOnTopFor: vi.fn() },
    onHotkeyToggle: vi.fn()
  } as unknown as Parameters<typeof setupIpc>[0])
  const call = (ipcMain.handle as unknown as Mock).mock.calls.find(([ch]) => ch === 'gtools:host')
  if (!call) throw new Error('gtools:host 未注册')
  return { store, host: call[1] as Host }
}

beforeEach(() => {
  // clearAllMocks 只清调用记录不清实现：假窗 mockReturnValue 会跨用例泄漏，这里统一还原为 null
  vi.clearAllMocks()
  vi.mocked(getSearchWindow).mockReturnValue(null)
  state.failAccels = []
})

describe('gtools:host settings:set', () => {
  it('F1: 指令热键部分未生效仍 ok:true，返回 data:next 且未生效项进 warnings', async () => {
    // 主键 Ctrl+Alt+K（双平台合法），c2 与其在 win32 侧撞键
    const { host, store } = await boot({
      hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+K' },
      commandHotkeys: [hk('a', 'c1', 'Alt+1')]
    })
    const r = await host(sender(), {
      api: 'settings:set',
      payload: { commandHotkeys: [hk('a', 'c1', 'Alt+1'), hk('b', 'c2', 'Ctrl+Alt+K')] }
    })
    expect(r.ok).toBe(true)
    expect((r.data as AppSettings).commandHotkeys).toHaveLength(2)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings?.[0]).toContain('部分指令热键未生效')
    expect(r.warnings?.[0]).toContain('Ctrl+Alt+K（b/c2）与主唤起键相同，已让位')
    // 落盘与广播照常发生
    expect(store.settings.commandHotkeys).toHaveLength(2)
  })

  it('F1: 全绿路径不附带 warnings 字段（旧消费方按字段存在性判断不炸）', async () => {
    const { host } = await boot()
    const r = await host(sender(), { api: 'settings:set', payload: { theme: 'dark' } })
    expect(r.ok).toBe(true)
    expect((r.data as AppSettings).theme).toBe('dark')
    expect('warnings' in r).toBe(false)
  })

  it('F4 回归: 单独换主键撞指令热键时先让位，主键注册成功而非报「被其他应用占用」', async () => {
    const { host, store } = await boot({
      hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' },
      commandHotkeys: [hk('a', 'c1', 'Alt+K')]
    })
    const r = await host(sender(), { api: 'settings:set', payload: { hotkey: { win32: 'Alt+K' } } })
    expect(r.ok).toBe(true)
    expect((r.data as AppSettings).hotkey.win32).toBe('Alt+K')
    expect(store.settings.hotkey.win32).toBe('Alt+K')
    // Alt+K 先被让位注销，再注册为主键
    expect(vi.mocked(globalShortcut.unregister).mock.calls).toContainEqual(['Alt+K'])
    expect(vi.mocked(globalShortcut.register).mock.calls.some(([accel]) => accel === 'Alt+K')).toBe(true)
  })

  it('F5: 登录项写 OS 抛异常时按契约接住，ok:false + 语义化 error 且不落盘', async () => {
    const { host, store } = await boot()
    ;(app.setLoginItemSettings as unknown as Mock).mockImplementationOnce(() => {
      throw new Error('registry denied')
    })
    const r = await host(sender(), { api: 'settings:set', payload: { launchAtLogin: true, theme: 'dark' } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('开机自启')
    expect(r.error).toContain('registry denied')
    // 不落盘：内存设置原样（theme/launchAtLogin 均未被本次载荷污染）
    expect(store.settings.launchAtLogin).toBe(false)
    expect(store.settings.theme).toBe('light')
  })

  it('F5: 同载荷换主键成功后登录项失败，主键回滚旧值并恢复注册', async () => {
    const { host, store } = await boot({ hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' } })
    ;(app.setLoginItemSettings as unknown as Mock).mockImplementationOnce(() => {
      throw new Error('denied')
    })
    const r = await host(sender(), { api: 'settings:set', payload: { hotkey: { win32: 'Alt+M' }, launchAtLogin: true } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('开机自启')
    // 设置未落盘，OS 侧主键也回滚
    expect(store.settings.hotkey.win32).toBe('Ctrl+Alt+Space')
    expect(vi.mocked(globalShortcut.register).mock.calls.some(([accel]) => accel === 'Ctrl+Alt+Space')).toBe(true)
  })

  it('F6: 禁用插件的指令热键不注册，skipped 计入 warnings', async () => {
    const { host } = await boot({
      hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' },
      disabledPlugins: ['off'],
      commandHotkeys: [hk('on', 'c1', 'Alt+1'), hk('off', 'c2', 'Alt+2')]
    })
    const r = await host(sender(), {
      api: 'settings:set',
      payload: { commandHotkeys: [hk('on', 'c1', 'Alt+1'), hk('off', 'c2', 'Alt+2')] }
    })
    expect(r.ok).toBe(true)
    expect(r.warnings?.[0]).toContain('Alt+2（off/c2）插件已禁用')
    expect(vi.mocked(globalShortcut.register).mock.calls.some(([accel]) => accel === 'Alt+1')).toBe(true)
    expect(vi.mocked(globalShortcut.register).mock.calls.some(([accel]) => accel === 'Alt+2')).toBe(false)
  })

  it('F6: plugins:set-enabled 禁用插件后其已注册热键被注销', async () => {
    const { host } = await boot({ hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' }, commandHotkeys: [hk('x', 'c1', 'Alt+9')] }, ['x'])
    // 启动注册已生效
    expect(vi.mocked(globalShortcut.register).mock.calls.some(([accel]) => accel === 'Alt+9')).toBe(true)
    const r = await host(sender(), { api: 'plugins:set-enabled', payload: { id: 'x', enabled: false } })
    expect(r.ok).toBe(true)
    expect(vi.mocked(globalShortcut.unregister).mock.calls).toContainEqual(['Alt+9'])
  })
})

// 探针时序（win32）：统一假窗覆写绕过 isSearchWindowSender 守卫（id 必须 === sender() 的 1），
// on/removeListener 防 attach/detachHotkeyCapture 的 TypeError（外层 catch 会把它吞成同一症状 ok:false）
const noop = (): void => {}

function fakeSearchWindow(): { webContents: { id: number; on: Mock; send: Mock; removeListener: Mock; isDestroyed: () => boolean } } {
  return { webContents: { id: 1, on: vi.fn(), send: vi.fn(), removeListener: vi.fn(), isDestroyed: () => false } }
}

function withFakeWindow(): ReturnType<typeof fakeSearchWindow> {
  const fake = fakeSearchWindow()
  vi.mocked(getSearchWindow).mockReturnValue(fake as unknown as ReturnType<typeof getSearchWindow>)
  return fake
}

/** 前置③：boot 内 unregisterAllHotkeys 只清模块态不注册，主键注册须在 boot 之后补 */
async function bootWithMainKey(seed: Partial<AppSettings> = {}): Promise<Awaited<ReturnType<typeof boot>>> {
  const ctx = await boot(seed)
  expect(registerHotkey('Alt+Space', noop)).toEqual({ ok: true })
  return ctx
}

function altOrders(): { regs: { order: number }[]; unregs: { order: number }[] } {
  const gs = vi.mocked(globalShortcut)
  const regs = gs.register.mock.calls
    .map((c, i) => ({ accel: c[0], order: gs.register.mock.invocationCallOrder[i] }))
    .filter((x) => x.accel === 'Alt+Space')
  const unregs = gs.unregister.mock.calls
    .map((c, i) => ({ accel: c[0], order: gs.unregister.mock.invocationCallOrder[i] }))
    .filter((x) => x.accel === 'Alt+Space')
  return { regs, unregs }
}

// hotkeyPlatform() 读 process.platform，本套件仅 win32 有效（非 win32 探针门控短路恒 true，时序断言不成立）
describe.skipIf(process.platform !== 'win32')('gtools:host hotkey 录入探针（win32）', () => {
  it('B1: suspend 返回 {suspended, probe:true}，时序 前置注册 < 挂起注销 < 探针注册', async () => {
    const { host } = await bootWithMainKey({ hotkey: { darwin: 'Alt+Space', win32: 'Alt+Space' } })
    withFakeWindow()
    const r = await host(sender(), { api: 'hotkey:suspend' })
    expect(r.ok).toBe(true)
    expect(r.data).toEqual({ suspended: true, probe: true })
    const { regs, unregs } = altOrders()
    expect(regs).toHaveLength(2) // 前置③ + probe arm
    expect(unregs).toHaveLength(1) // suspendHotkeys 注销主键
    expect(regs[0].order).toBeLessThan(unregs[0].order)
    expect(unregs[0].order).toBeLessThan(regs[1].order)
    await host(sender(), { api: 'hotkey:resume' }) // 清 ipc 模块态：handler/suspendedState 不跨用例泄漏
    unregisterAllHotkeys()
  })

  it('B2 核心回归: 探针占键下保存同键 ok:true，rebind 内先放探针（unregister 早于 register）', async () => {
    const { host, store } = await bootWithMainKey({ hotkey: { darwin: 'Alt+Space', win32: 'Alt+Space' } })
    withFakeWindow()
    await host(sender(), { api: 'hotkey:suspend' })
    const r = await host(sender(), { api: 'settings:set', payload: { hotkey: { win32: 'Alt+Space' } } })
    expect(r.ok).toBe(true)
    expect(store.settings.hotkey.win32).toBe('Alt+Space')
    const { regs, unregs } = altOrders()
    expect(regs).toHaveLength(3) // 前置③ + probe arm + rebind 注册
    expect(unregs).toHaveLength(2) // suspendHotkeys + rebind 内 disarm
    expect(unregs[1].order).toBeLessThan(regs[2].order)
    await host(sender(), { api: 'hotkey:resume' }) // 清 ipc 模块态：handler/suspendedState 不跨用例泄漏
    unregisterAllHotkeys()
  })

  it('B3: resume 先放探针再重注册主键（末次 Alt+Space 注册在案），detach 移除 before-input-event', async () => {
    const { host } = await bootWithMainKey({ hotkey: { darwin: 'Alt+Space', win32: 'Alt+Space' } })
    const fake = withFakeWindow()
    await host(sender(), { api: 'hotkey:suspend' })
    const r = await host(sender(), { api: 'hotkey:resume' })
    expect(r.ok).toBe(true)
    expect(r.data).toBe(true)
    const { regs, unregs } = altOrders()
    expect(regs).toHaveLength(3) // 前置③ + probe arm + resume 重注册主键
    expect(unregs).toHaveLength(2) // suspendHotkeys + resume 前 disarm
    expect(unregs[1].order).toBeLessThan(regs[2].order)
    // 主键最终注册在案：mock.calls 里末次 'Alt+Space' register 即 resume 阶段那条
    const allRegs = vi.mocked(globalShortcut.register).mock.calls.filter(([a]) => a === 'Alt+Space')
    expect(allRegs.at(-1)?.[0]).toBe('Alt+Space')
    expect(fake.webContents.removeListener).toHaveBeenCalledWith('before-input-event', expect.any(Function))
    await host(sender(), { api: 'hotkey:resume' }) // 清 ipc 模块态：handler/suspendedState 不跨用例泄漏
    unregisterAllHotkeys()
  })

  it('B4: 探针占键下保存失败路径 ok:false 占用文案，探针态已清（再 disarm 为 no-op）', async () => {
    const { host } = await bootWithMainKey({ hotkey: { darwin: 'Alt+Space', win32: 'Alt+Space' } })
    withFakeWindow()
    await host(sender(), { api: 'hotkey:suspend' })
    state.failAccels = ['Alt+Space']
    const r = await host(sender(), { api: 'settings:set', payload: { hotkey: { win32: 'Alt+Space' } } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('占用')
    const gs = vi.mocked(globalShortcut)
    expect(gs.unregister.mock.calls.some(([a]) => a === 'Alt+Space')).toBe(true) // rebind 内 disarm 已注销探针
    const count = gs.unregister.mock.calls.length
    disarmHotkeyProbe()
    expect(gs.unregister.mock.calls.length).toBe(count)
    await host(sender(), { api: 'hotkey:resume' }) // 清 ipc 模块态：handler/suspendedState 不跨用例泄漏
    unregisterAllHotkeys()
  })

  it('B5: 探针 cb 触发即经白名单通道发 hotkey-captured', async () => {
    const { host } = await bootWithMainKey({ hotkey: { darwin: 'Alt+Space', win32: 'Alt+Space' } })
    const fake = withFakeWindow()
    await host(sender(), { api: 'hotkey:suspend' })
    const regs = vi.mocked(globalShortcut.register).mock.calls.filter(([a]) => a === 'Alt+Space')
    const probeCb = regs.at(-1)?.[1] as (() => void) | undefined
    expect(typeof probeCb).toBe('function')
    probeCb?.()
    expect(fake.webContents.send).toHaveBeenCalledWith('hotkey-captured', 'Alt+Space')
    await host(sender(), { api: 'hotkey:resume' }) // 清 ipc 模块态：handler/suspendedState 不跨用例泄漏
    unregisterAllHotkeys()
  })

  it('B6: 换键+登录项失败回滚：回滚 rebind 让位探针并恢复主键，设置不落盘', async () => {
    const { host, store } = await bootWithMainKey({ hotkey: { darwin: 'Alt+Space', win32: 'Alt+Space' } })
    withFakeWindow()
    await host(sender(), { api: 'hotkey:suspend' })
    ;(app.setLoginItemSettings as unknown as Mock).mockImplementationOnce(() => {
      throw new Error('denied')
    })
    const r = await host(sender(), { api: 'settings:set', payload: { hotkey: { win32: 'Alt+M' }, launchAtLogin: true } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('开机自启')
    expect(store.settings.hotkey.win32).toBe('Alt+Space')
    // 前置③ + probe arm + 回滚 rebind = 'Alt+Space' 恰 3 次注册；末次只能来自回滚路径
    const { regs, unregs } = altOrders()
    expect(regs).toHaveLength(3)
    expect(unregs).toHaveLength(3) // suspend + 换下旧键 + 回滚 disarm
    const login = app.setLoginItemSettings as unknown as Mock
    const loginOrder = login.mock.invocationCallOrder[0]
    // 回滚序：setLoginItemSettings 抛错 → disarm 放探针 → 重注册旧主键
    expect(regs[2].order).toBeGreaterThan(unregs[2].order)
    expect(regs[2].order).toBeGreaterThan(loginOrder)
    await host(sender(), { api: 'hotkey:resume' }) // 清 ipc 模块态：handler/suspendedState 不跨用例泄漏
    unregisterAllHotkeys()
  })
})
