import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { planCommandHotkeyChanges, syncCommandHotkeys, type CommandHotkeyBinding, type GlobalShortcutLike } from '../src/main/shortcut'

interface FakeGs extends GlobalShortcutLike {
  register: Mock<(accel: string, cb: () => void) => boolean>
  unregister: Mock<(accel: string) => void>
}

/** failAccels 里的键 register 返回 false，模拟被其他应用占用 */
function makeGs(failAccels: string[] = []): FakeGs {
  return {
    register: vi.fn((accel: string) => !failAccels.includes(accel)),
    unregister: vi.fn()
  }
}

const noop = (): void => {}
const bind = (accel: string, pluginId = 'json-editor', commandId = 'format'): CommandHotkeyBinding => ({
  accel,
  pluginId,
  commandId
})

beforeEach(() => {
  // shortcut.ts 的已注册表是模块级状态，用空同步清场（注销落到一次性 fake 上）
  syncCommandHotkeys([], null, noop, makeGs())
})

describe('planCommandHotkeyChanges', () => {
  it('纯新增：next 独有全部进 toRegister', () => {
    expect(planCommandHotkeyChanges([], [bind('Alt+T'), bind('Alt+J', 'qr-code', 'decode')])).toEqual({
      toRegister: [bind('Alt+T'), bind('Alt+J', 'qr-code', 'decode')],
      toUnregister: []
    })
  })

  it('纯删除：prev 独有全部进 toUnregister', () => {
    expect(planCommandHotkeyChanges([bind('Alt+T'), bind('Alt+J', 'qr-code', 'decode')], [])).toEqual({
      toRegister: [],
      toUnregister: [bind('Alt+T'), bind('Alt+J', 'qr-code', 'decode')]
    })
  })

  it('不变：同键同动作交集为空动作', () => {
    expect(planCommandHotkeyChanges([bind('Alt+T')], [bind('Alt+T')])).toEqual({ toRegister: [], toUnregister: [] })
  })

  it('同键换绑另一指令：两侧各进一面（旧回调必须让位）', () => {
    const plan = planCommandHotkeyChanges([bind('Alt+T', 'json-editor', 'format')], [bind('Alt+T', 'qr-code', 'decode')])
    expect(plan.toRegister).toEqual([bind('Alt+T', 'qr-code', 'decode')])
    expect(plan.toUnregister).toEqual([bind('Alt+T', 'json-editor', 'format')])
  })

  it('增删混合：各取差集，顺序沿用入参', () => {
    const prev = [bind('Alt+T'), bind('Alt+J', 'qr-code', 'decode'), bind('Alt+K', 'qr-code', 'encode')]
    const next = [bind('Alt+K', 'qr-code', 'encode'), bind('Alt+T'), bind('Ctrl+Alt+L')]
    expect(planCommandHotkeyChanges(prev, next)).toEqual({
      toRegister: [bind('Ctrl+Alt+L')],
      toUnregister: [bind('Alt+J', 'qr-code', 'decode')]
    })
  })
})

describe('syncCommandHotkeys', () => {
  it('全绿：新键注册、旧键注销、动作映射到 fire', () => {
    const gs = makeGs()
    const first = syncCommandHotkeys([bind('Alt+T'), bind('Alt+J', 'qr-code', 'decode')], 'Ctrl+Alt+Space', noop, gs)
    expect(first).toEqual({ ok: true, skipped: [], failed: [] })
    expect(gs.register).toHaveBeenCalledWith('Alt+T', expect.any(Function))
    expect(gs.register).toHaveBeenCalledWith('Alt+J', expect.any(Function))

    const second = syncCommandHotkeys([bind('Alt+T')], 'Ctrl+Alt+Space', noop, gs)
    expect(second).toEqual({ ok: true, skipped: [], failed: [] })
    expect(gs.unregister).toHaveBeenCalledWith('Alt+J')
    expect(gs.unregister).not.toHaveBeenCalledWith('Alt+T')
  })

  it('注册的键按下后触发 fire(pluginId, commandId)', () => {
    const gs = makeGs()
    const fire = vi.fn()
    syncCommandHotkeys([bind('Alt+T', 'json-editor', 'format')], null, fire, gs)
    const cb = gs.register.mock.calls.find(([accel]) => accel === 'Alt+T')?.[1]
    expect(cb).toBeTypeOf('function')
    cb?.()
    expect(fire).toHaveBeenCalledWith('json-editor', 'format')
  })

  it('撞主键：跳过不注册也不崩，ok 仍为 true', () => {
    const gs = makeGs()
    const r = syncCommandHotkeys([bind('Alt+T'), bind('Ctrl+Alt+Space', 'qr-code', 'decode')], 'Ctrl+Alt+Space', noop, gs)
    expect(r.ok).toBe(true)
    expect(r.skipped).toEqual([
      { pluginId: 'qr-code', commandId: 'decode', accel: 'Ctrl+Alt+Space', reason: '与主唤起键相同，已让位' }
    ])
    expect(r.failed).toEqual([])
    expect(gs.register).toHaveBeenCalledTimes(1)
    expect(gs.register).toHaveBeenCalledWith('Alt+T', expect.any(Function))
  })

  it('已注册键后来撞上新主键：让位注销并记入 skipped', () => {
    const gs = makeGs()
    syncCommandHotkeys([bind('Alt+T')], 'Ctrl+Alt+Space', noop, gs)
    const r = syncCommandHotkeys([bind('Alt+T')], 'Alt+T', noop, gs)
    expect(r.skipped).toHaveLength(1)
    expect(r.failed).toEqual([])
    expect(gs.unregister).toHaveBeenCalledWith('Alt+T')
  })

  it('注册失败：旧键保留可继续触发，失败项进 failed 且 ok 为 false', () => {
    const gs = makeGs()
    const oldFire = vi.fn()
    syncCommandHotkeys([bind('Alt+J', 'json-editor', 'format')], null, oldFire, gs)
    const oldCb = gs.register.mock.calls[0][1]

    const gs2 = makeGs(['Alt+K'])
    const r = syncCommandHotkeys([bind('Alt+K')], null, noop, gs2)
    expect(r.ok).toBe(false)
    expect(r.failed).toEqual([
      { pluginId: 'json-editor', commandId: 'format', accel: 'Alt+K', reason: '注册失败（可能被其他应用占用）' }
    ])
    // 失败时不动旧键
    expect(gs2.unregister).not.toHaveBeenCalled()
    oldCb()
    expect(oldFire).toHaveBeenCalledWith('json-editor', 'format')
  })

  it('部分注册失败（F2）：仅失败项沿用旧键，成功项照常注销旧键，不再双键同触', () => {
    const gs = makeGs()
    // 旧态一次建两条：Alt+J→format(X)、Alt+L→encode(Z)
    syncCommandHotkeys([bind('Alt+J', 'json-editor', 'format'), bind('Alt+L', 'json-editor', 'encode')], null, vi.fn(), gs)

    // 新态：format 改绑 Ctrl+Alt+K（成功）、encode 改绑 Alt+K（失败）
    const gs2 = makeGs(['Alt+K'])
    const r = syncCommandHotkeys([bind('Ctrl+Alt+K', 'json-editor', 'format'), bind('Alt+K', 'json-editor', 'encode')], null, noop, gs2)
    expect(r.ok).toBe(false)
    expect(r.failed).toEqual([
      { pluginId: 'json-editor', commandId: 'encode', accel: 'Alt+K', reason: '注册失败（可能被其他应用占用）' }
    ])
    // 成功改绑项：旧键 Alt+J 注销，无双键同触
    expect(gs2.unregister).toHaveBeenCalledWith('Alt+J')
    // 失败项：旧键 Alt+L 保留
    expect(gs2.unregister).not.toHaveBeenCalledWith('Alt+L')
  })

  it('同键换绑另一指令（F3）：旧回调注销、新回调生效', () => {
    const gs = makeGs()
    const fireOld = vi.fn()
    syncCommandHotkeys([bind('Alt+T', 'json-editor', 'format')], null, fireOld, gs)

    const fireNew = vi.fn()
    const r = syncCommandHotkeys([bind('Alt+T', 'qr-code', 'decode')], null, fireNew, gs)
    expect(r.ok).toBe(true)
    // 同键重注册前必须先注销旧动作（electron 重复注册同一加速键会失败）
    expect(gs.unregister).toHaveBeenCalledWith('Alt+T')
    const newCb = gs.register.mock.calls.filter(([accel]) => accel === 'Alt+T').at(-1)?.[1]
    newCb?.()
    expect(fireNew).toHaveBeenCalledWith('qr-code', 'decode')
    expect(fireOld).not.toHaveBeenCalled()
  })

  it('禁用插件（F6）：绑定不注册记 skipped，旧注册态被注销', () => {
    const gs = makeGs()
    syncCommandHotkeys([bind('Alt+T', 'json-editor', 'format')], null, noop, gs)
    const disabled = new Set(['json-editor'])

    const r = syncCommandHotkeys([bind('Alt+T', 'json-editor', 'format')], null, noop, gs, { disabledPluginIds: disabled })
    expect(r.ok).toBe(true)
    expect(r.skipped).toEqual([
      { pluginId: 'json-editor', commandId: 'format', accel: 'Alt+T', reason: '插件已禁用，热键未生效' }
    ])
    expect(gs.unregister).toHaveBeenCalledWith('Alt+T')
    // 禁用期间不重复注册
    expect(gs.register).toHaveBeenCalledTimes(1)
  })

  it('启用插件恢复注册：禁用集之外照常注册', () => {
    const gs = makeGs()
    const r = syncCommandHotkeys([bind('Alt+T')], null, noop, gs, { disabledPluginIds: new Set(['other-plugin']) })
    expect(r.ok).toBe(true)
    expect(r.skipped).toEqual([])
    expect(gs.register).toHaveBeenCalledWith('Alt+T', expect.any(Function))
  })

  it('加速键不合法：直接进 failed，不尝试注册', () => {
    const gs = makeGs()
    const r = syncCommandHotkeys([bind('T')], null, noop, gs)
    expect(r.ok).toBe(false)
    expect(r.failed).toHaveLength(1)
    expect(r.failed[0].reason).toContain('修饰键')
    expect(gs.register).not.toHaveBeenCalled()
  })
})
