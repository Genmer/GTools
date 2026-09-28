import { describe, expect, it, vi } from 'vitest'
import {
  registerHotkey,
  rebindHotkey,
  suspendHotkeys,
  resumeHotkeys,
  armHotkeyProbe,
  disarmHotkeyProbe,
  syncCommandHotkeys,
  unregisterAllHotkeys,
  type GlobalShortcutLike
} from '../src/main/shortcut'

interface FakeGs extends GlobalShortcutLike {
  register: ReturnType<typeof vi.fn<(accel: string, cb: () => void) => boolean>>
  unregister: ReturnType<typeof vi.fn<(accel: string) => void>>
  unregisterAll: ReturnType<typeof vi.fn<() => void>>
}

function makeGs(failAccels: string[] = []): FakeGs {
  return {
    register: vi.fn((accel: string) => !failAccels.includes(accel)),
    unregister: vi.fn(),
    unregisterAll: vi.fn()
  }
}
const noop = (): void => {}

// 本文件内用例共享模块级注册态，每个用例结束时必须 unregisterAllHotkeys 清场
describe('suspendHotkeys / resumeHotkeys（热键录入期挂起）', () => {
  it('挂起注销主键与指令键，恢复时原样重注册', () => {
    const gs1 = makeGs()
    expect(registerHotkey('Ctrl+Alt+Space', noop, gs1)).toEqual({ ok: true })
    const sync = syncCommandHotkeys(
      [{ accel: 'Alt+T', pluginId: 'json-editor', commandId: 'format' }],
      'Ctrl+Alt+Space',
      noop,
      gs1
    )
    expect(sync.ok).toBe(true)

    const gsS = makeGs()
    expect(suspendHotkeys(gsS)).toBe(true)
    expect(gsS.unregister.mock.calls.map((c) => c[0]).sort()).toEqual(['Alt+T', 'Ctrl+Alt+Space'])

    const gsR = makeGs()
    expect(resumeHotkeys(gsR)).toBe(true)
    expect(gsR.register.mock.calls.map((c) => c[0]).sort()).toEqual(['Alt+T', 'Ctrl+Alt+Space'])

    unregisterAllHotkeys(gs1)
  })

  it('重复挂起返回 false；恢复后无挂起态；无任何注册态时挂起返回 false', () => {
    const gs = makeGs()
    expect(registerHotkey('Ctrl+Alt+Space', noop, gs)).toEqual({ ok: true })
    expect(suspendHotkeys(makeGs())).toBe(true)
    expect(suspendHotkeys(makeGs())).toBe(false)
    expect(resumeHotkeys(makeGs())).toBe(true)
    expect(resumeHotkeys(makeGs())).toBe(false)
    unregisterAllHotkeys(gs)
    expect(suspendHotkeys(makeGs())).toBe(false)
  })

  it('挂起期间换绑主键：新键即时生效，resume 不再把旧键注册回来（防双键）', () => {
    const gs = makeGs()
    expect(registerHotkey('Ctrl+Alt+Space', noop, gs)).toEqual({ ok: true })
    expect(suspendHotkeys(makeGs())).toBe(true)
    expect(rebindHotkey('Ctrl+Alt+K', noop, gs)).toEqual({ ok: true })
    const gsR = makeGs()
    expect(resumeHotkeys(gsR)).toBe(true)
    expect(gsR.register).not.toHaveBeenCalled()
    expect(gsR.unregister).not.toHaveBeenCalled()
    unregisterAllHotkeys(gs)
  })
})

// 探针状态机：arm/disarm 幂等 + rebind 同键让位（机制⑤），gs 全程注入不经 IPC
describe('armHotkeyProbe / disarmHotkeyProbe（Alt+Space 录入探针）', () => {
  it('arm 注册 Alt+Space 成功记态，disarm 注销并清态；二次 disarm 幂等零调用', () => {
    const gs = makeGs()
    const cb = vi.fn()
    expect(armHotkeyProbe('Alt+Space', cb, gs)).toBe(true)
    expect(gs.register).toHaveBeenCalledWith('Alt+Space', cb)
    disarmHotkeyProbe(gs)
    expect(gs.unregister).toHaveBeenCalledWith('Alt+Space')
    const count = gs.unregister.mock.calls.length
    disarmHotkeyProbe(gs)
    expect(gs.unregister.mock.calls.length).toBe(count)
  })

  it('已武装同键再 arm 幂等：返回 true 且 register 仅一次', () => {
    const gs = makeGs()
    expect(armHotkeyProbe('Alt+Space', vi.fn(), gs)).toBe(true)
    expect(armHotkeyProbe('Alt+Space', vi.fn(), gs)).toBe(true)
    expect(gs.register).toHaveBeenCalledTimes(1)
    disarmHotkeyProbe(gs)
  })

  it('arm 失败（外部占用）返回 false 不记态，其后 disarm 零注销', () => {
    const gs = makeGs(['Alt+Space'])
    expect(armHotkeyProbe('Alt+Space', vi.fn(), gs)).toBe(false)
    disarmHotkeyProbe(gs)
    expect(gs.unregister).not.toHaveBeenCalled()
  })

  it('挂起录入态同键换绑：rebind 先放探针再注册（unregister 早于 register），resume 不重复注册旧键', () => {
    const gs = makeGs()
    expect(registerHotkey('Alt+Space', noop, gs)).toEqual({ ok: true })
    expect(suspendHotkeys(gs)).toBe(true)
    expect(armHotkeyProbe('Alt+Space', vi.fn(), gs)).toBe(true)
    expect(rebindHotkey('Alt+Space', noop, gs)).toEqual({ ok: true })
    const regOrders = gs.register.mock.calls
      .map((c, i) => ({ accel: c[0], order: gs.register.mock.invocationCallOrder[i] }))
      .filter((x) => x.accel === 'Alt+Space')
    const unregOrders = gs.unregister.mock.calls
      .map((c, i) => ({ accel: c[0], order: gs.unregister.mock.invocationCallOrder[i] }))
      .filter((x) => x.accel === 'Alt+Space')
    expect(regOrders).toHaveLength(3) // registerHotkey + probe arm + rebind 注册
    expect(unregOrders).toHaveLength(2) // suspendHotkeys + rebind 内 disarm
    expect(unregOrders[1].order).toBeLessThan(regOrders[2].order)
    const gsR = makeGs()
    expect(resumeHotkeys(gsR)).toBe(true)
    expect(gsR.register).not.toHaveBeenCalled()
    unregisterAllHotkeys(gs)
  })

  it('异键换绑不动探针：Alt+Space 零额外注销，其后 disarm 仍生效', () => {
    unregisterAllHotkeys(makeGs()) // 清前序用例可能的模块态残留，保证本用例自洽
    const gs = makeGs()
    expect(armHotkeyProbe('Alt+Space', vi.fn(), gs)).toBe(true)
    expect(registerHotkey('Ctrl+Alt+K', noop, gs)).toEqual({ ok: true })
    expect(rebindHotkey('Ctrl+Alt+J', noop, gs)).toEqual({ ok: true })
    expect(gs.unregister).not.toHaveBeenCalledWith('Alt+Space')
    disarmHotkeyProbe(gs)
    expect(gs.unregister).toHaveBeenCalledWith('Alt+Space')
    unregisterAllHotkeys(gs)
  })

  it('同键换绑注册失败：ok:false 占用文案，探针态已清（再 disarm 为 no-op）', () => {
    const gsOk = makeGs()
    expect(armHotkeyProbe('Alt+Space', vi.fn(), gsOk)).toBe(true)
    const gsFail = makeGs(['Alt+Space'])
    const r = rebindHotkey('Alt+Space', noop, gsFail)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('占用')
    expect(gsFail.unregister).toHaveBeenCalledWith('Alt+Space')
    const count = gsFail.unregister.mock.calls.length
    disarmHotkeyProbe(gsFail)
    expect(gsFail.unregister.mock.calls.length).toBe(count)
    unregisterAllHotkeys(gsOk)
  })

  it('unregisterAllHotkeys 兜底清探针：无 unregisterAll 的 fallback 变体同样注销探针键，其后 disarm 为 no-op', () => {
    const gs = makeGs()
    expect(armHotkeyProbe('Alt+Space', vi.fn(), gs)).toBe(true)
    unregisterAllHotkeys(gs)
    expect(gs.unregister).toHaveBeenCalledWith('Alt+Space')
    const count = gs.unregister.mock.calls.length
    disarmHotkeyProbe(gs)
    expect(gs.unregister.mock.calls.length).toBe(count)

    const gsFallback = { register: vi.fn((accel: string) => accel !== 'NEVER'), unregister: vi.fn() } as GlobalShortcutLike
    expect(armHotkeyProbe('Alt+Space', vi.fn(), gsFallback)).toBe(true)
    unregisterAllHotkeys(gsFallback)
    expect(gsFallback.unregister).toHaveBeenCalledWith('Alt+Space')
  })
})
