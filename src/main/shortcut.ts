import { globalShortcut } from 'electron'
import { toElectronAccelerator, validateAccelerator } from '@sdk/shortcut-rules'

let currentElectronAccel: string | null = null
let mainCb: (() => void) | null = null

export function registerHotkey(accel: string, cb: () => void, gs: GlobalShortcutLike = globalShortcut): { ok: boolean; error?: string } {
  const issue = validateAccelerator(accel, process.platform)
  if (!issue.ok) return { ok: false, error: issue.reason }
  const electronAccel = toElectronAccelerator(accel, process.platform)
  if (!gs.register(electronAccel, cb)) {
    return { ok: false, error: `快捷键 ${accel} 注册失败（可能被其他应用占用）` }
  }
  currentElectronAccel = electronAccel
  mainCb = cb
  return { ok: true }
}

// 录入期 Alt+Space 系统级探针（win32）：RegisterHotKey 先于 DefWindowProc 的 SC_KEYMENU 菜单通道，从源头杜绝系统菜单弹出
let probeAccel: string | null = null

export function armHotkeyProbe(accel: string, cb: () => void, gs: GlobalShortcutLike = globalShortcut): boolean {
  const electronAccel = toElectronAccelerator(accel, process.platform)
  if (probeAccel === electronAccel) return true
  if (!gs.register(electronAccel, cb)) return false
  probeAccel = electronAccel
  return true
}

export function disarmHotkeyProbe(gs: Pick<GlobalShortcutLike, 'unregister'> = globalShortcut): void {
  if (!probeAccel) return
  gs.unregister(probeAccel)
  probeAccel = null
}

/** 换绑：先试注册新键，成功才注销旧键；失败保留旧绑定（应用不崩） */
export function rebindHotkey(newAccel: string, cb: () => void, gs: GlobalShortcutLike = globalShortcut): { ok: boolean; error?: string } {
  const issue = validateAccelerator(newAccel, process.platform)
  if (!issue.ok) return { ok: false, error: issue.reason }
  const electronAccel = toElectronAccelerator(newAccel, process.platform)
  // 同键保存时探针仍占着键，register 必败：先让位（正常保存与登录项回滚两条路径都经此）
  if (probeAccel === electronAccel) disarmHotkeyProbe(gs)
  if (!gs.register(electronAccel, cb)) {
    return { ok: false, error: `快捷键 ${newAccel} 注册失败（可能被其他应用占用），已保留原快捷键` }
  }
  if (currentElectronAccel && currentElectronAccel !== electronAccel) {
    gs.unregister(currentElectronAccel)
  }
  currentElectronAccel = electronAccel
  mainCb = cb
  // 挂起期间换绑：新键已实时生效，作废挂起态里的旧主键，防止 resume 把旧键再注册回来形成双键
  if (suspendedState) suspendedState.main = null
  return { ok: true }
}

export function unregisterAllHotkeys(gs: GlobalShortcutLike = globalShortcut): void {
  disarmHotkeyProbe(gs) // fallback 分支只注销主键，探针不显式放开会泄漏到 app 退出
  if (gs.unregisterAll) gs.unregisterAll()
  else if (currentElectronAccel) gs.unregister(currentElectronAccel)
  currentElectronAccel = null
  mainCb = null
  commandActions.clear()
  suspendedState = null
}

interface SuspendedMain {
  accel: string
  cb: () => void
}
interface SuspendedState {
  main: SuspendedMain | null
  commands: { accel: string; cb: () => void }[]
}
let suspendedState: SuspendedState | null = null

/** 录入期挂起全部热键：全局热键先于窗口 keydown 截走按键（如 Alt+Space），录入时必须临时让路；无注册态时返回 false */
export function suspendHotkeys(gs: Pick<GlobalShortcutLike, 'unregister'> = globalShortcut): boolean {
  if (suspendedState) return false
  const main = currentElectronAccel && mainCb ? { accel: currentElectronAccel, cb: mainCb } : null
  const commands = [...commandActions.values()].map((a) => ({ accel: a.accel, cb: a.cb }))
  if (!main && commands.length === 0) return false
  if (main) gs.unregister(main.accel)
  for (const c of commands) gs.unregister(c.accel)
  suspendedState = { main, commands }
  return true
}

/** 恢复挂起的热键；个别重注册失败只能放弃该键（下次换绑/同步时重建），不报错 */
export function resumeHotkeys(gs: Pick<GlobalShortcutLike, 'register'> = globalShortcut): boolean {
  if (!suspendedState) return false
  const s = suspendedState
  suspendedState = null
  if (s.main) gs.register(s.main.accel, s.main.cb)
  for (const c of s.commands) gs.register(c.accel, c.cb)
  return true
}

/** globalShortcut 可注入子集：node 单测不触 electron */
export interface GlobalShortcutLike {
  register(accelerator: string, cb: () => void): boolean
  unregister(accelerator: string): void
  unregisterAll?(): void
}

export interface CommandHotkeyBinding {
  accel: string
  pluginId: string
  commandId: string
}

export interface CommandHotkeyIssue {
  pluginId: string
  commandId: string
  accel: string
  reason: string
}

export interface CommandHotkeySyncResult {
  ok: boolean
  skipped: CommandHotkeyIssue[]
  failed: CommandHotkeyIssue[]
}

/** 注册表差集：accel 相同但动作（插件/指令）变化视为换绑，两侧各进一面（旧回调必须让位）；key 一律 electron 形态 */
export function planCommandHotkeyChanges(
  prev: CommandHotkeyBinding[],
  next: CommandHotkeyBinding[]
): { toRegister: CommandHotkeyBinding[]; toUnregister: CommandHotkeyBinding[] } {
  const prevByAccel = new Map(prev.map((b) => [b.accel, b]))
  const nextByAccel = new Map(next.map((b) => [b.accel, b]))
  const sameAction = (a: CommandHotkeyBinding | undefined, b: CommandHotkeyBinding | undefined): boolean =>
    a !== undefined && b !== undefined && a.pluginId === b.pluginId && a.commandId === b.commandId
  return {
    toRegister: next.filter((b) => !sameAction(prevByAccel.get(b.accel), b)),
    toUnregister: prev.filter((b) => !sameAction(b, nextByAccel.get(b.accel)))
  }
}

// 已注册指令热键：electron 加速键 → 动作；map 即「实际注册态」，diff 与失败回滚都以它为 prev
const commandActions = new Map<string, { pluginId: string; commandId: string; accel: string; cb: () => void }>()

/** 指令（插件/指令对）标识：注销旧键时定位「失败项自身的旧键」 */
const cmdKey = (b: { pluginId: string; commandId: string }): string => `${b.pluginId}/${b.commandId}`

export function syncCommandHotkeys(
  next: CommandHotkeyBinding[],
  mainAccel: string | null,
  fire: (pluginId: string, commandId: string) => void,
  gs: GlobalShortcutLike = globalShortcut,
  opts: { disabledPluginIds?: ReadonlySet<string> } = {}
): CommandHotkeySyncResult {
  const platform = process.platform
  const mainElectron = mainAccel ? toElectronAccelerator(mainAccel, platform) : null
  const skipped: CommandHotkeyIssue[] = []
  const failed: CommandHotkeyIssue[] = []
  const wanted = new Map<string, { pluginId: string; commandId: string; accel: string; cb: () => void }>()

  for (const b of next) {
    if (opts.disabledPluginIds?.has(b.pluginId)) {
      // 禁用插件的绑定不注册，否则按下只弹空窗；其旧注册态由下方差集注销兜底
      skipped.push({ pluginId: b.pluginId, commandId: b.commandId, accel: b.accel, reason: '插件已禁用，热键未生效' })
      continue
    }
    const issue = validateAccelerator(b.accel, platform)
    if (!issue.ok) {
      failed.push({ pluginId: b.pluginId, commandId: b.commandId, accel: b.accel, reason: issue.reason ?? '加速键无效' })
      continue
    }
    const electron = toElectronAccelerator(b.accel, platform)
    if (mainElectron !== null && electron === mainElectron) {
      // 同键重复注册会顶掉主唤起回调，指令热键必须让位；旧态若还占着键（如导入换了主键）则注销
      skipped.push({ pluginId: b.pluginId, commandId: b.commandId, accel: b.accel, reason: '与主唤起键相同，已让位' })
      if (commandActions.has(electron)) {
        gs.unregister(electron)
        commandActions.delete(electron)
      }
      continue
    }
    if (wanted.has(electron)) {
      failed.push({ pluginId: b.pluginId, commandId: b.commandId, accel: b.accel, reason: '与其他指令热键重复' })
      continue
    }
    wanted.set(electron, { pluginId: b.pluginId, commandId: b.commandId, accel: b.accel, cb: () => fire(b.pluginId, b.commandId) })
  }

  const toEntry = ([accel, a]: [string, { pluginId: string; commandId: string }]): CommandHotkeyBinding => ({
    accel,
    pluginId: a.pluginId,
    commandId: a.commandId
  })
  const plan = planCommandHotkeyChanges(
    [...commandActions.entries()].map(toEntry),
    [...wanted.entries()].map(toEntry)
  )
  // 本轮同指令新键注册失败的集合：注销旧键时只保留这些项的旧绑定（沿用 rebindHotkey「失败不丢旧键」）
  const regFailedCmds = new Set<string>()
  for (const b of plan.toRegister) {
    const action = wanted.get(b.accel)
    if (!action) continue
    if (commandActions.has(b.accel)) {
      // 同键换绑另一指令：electron 对已注册加速键重复注册会失败，须先让位再注册
      gs.unregister(b.accel)
      commandActions.delete(b.accel)
    }
    if (gs.register(b.accel, action.cb)) commandActions.set(b.accel, action)
    else {
      regFailedCmds.add(cmdKey(action))
      failed.push({ pluginId: action.pluginId, commandId: action.commandId, accel: action.accel, reason: '注册失败（可能被其他应用占用）' })
    }
  }
  for (const b of plan.toUnregister) {
    const cur = commandActions.get(b.accel)
    // 键已被同键换绑的新动作接管（身份不符）或已清场（无 cur）时不动；旧动作仍在且仅其新键注册失败才沿用旧绑定
    if (!cur || cur.pluginId !== b.pluginId || cur.commandId !== b.commandId) continue
    if (regFailedCmds.has(cmdKey(b))) continue
    gs.unregister(b.accel)
    commandActions.delete(b.accel)
  }
  return { ok: failed.length === 0, skipped, failed }
}
