export const MODIFIERS = ['Ctrl', 'Cmd', 'Alt', 'Shift'] as const

/** 单修饰键 + 这些主键属于系统/编辑器保留组合，拒绝注册（设计 §2.2 黑名单）；space 单修饰因平台而异，见 isReservedSingleMod */
const SINGLE_MOD_BLACKLIST = new Set(['c', 'v', 'x', 'z', 'tab', 'a', 'f4', 'escape', 'enter'])

export interface AcceleratorIssue {
  ok: boolean
  reason?: string
}

/** 校验 Electron Accelerator：至少一个修饰键 + 一个非修饰主键，且不撞平台黑名单 */
export function validateAccelerator(accel: string, platform: string): AcceleratorIssue {
  // settings.json 可能把热键改成非字符串，先挡掉再 split
  if (typeof accel !== 'string') return { ok: false, reason: '快捷键必须是字符串' }
  const parts = accel.split('+').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2) return { ok: false, reason: '至少需要一个修饰键和一个主键' }
  const mods = parts.filter((p) => (MODIFIERS as readonly string[]).includes(p))
  const keys = parts.filter((p) => !(MODIFIERS as readonly string[]).includes(p))
  if (mods.length === 0) return { ok: false, reason: '缺少修饰键（Ctrl/Cmd/Alt/Shift）' }
  if (keys.length !== 1) return { ok: false, reason: '必须有且只有一个主键' }
  if (mods.length === 1 && isReservedSingleMod(mods[0], keys[0], platform)) {
    return { ok: false, reason: `组合 ${accel} 是系统保留快捷键` }
  }
  return { ok: true }
}

/** space 单修饰组合平台分化：win32 上 Alt+Space 是窗口菜单键、Ctrl+Space 是输入法切换，全拒；darwin 上仅 Cmd(Spotlight)/Ctrl(输入源) 被占，Alt+Space 是 mac 默认键必须放行 */
function isReservedSingleMod(mod: string, key: string, platform: string): boolean {
  if (key.toLowerCase() === 'space') {
    if (platform === 'win32') return true
    return mod === 'Cmd' || mod === 'Ctrl'
  }
  return SINGLE_MOD_BLACKLIST.has(key.toLowerCase())
}

/** Electron Accelerator 原生键名（CommandOrControl/Option 等）统一成展示/存储形态 */
export function normalizeAccelerator(accel: string): string {
  return accel
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const lower = s.toLowerCase()
      if (lower === 'commandorcontrol' || lower === 'cmdorctrl') return 'Ctrl'
      if (lower === 'command' || lower === 'cmd' || lower === 'meta') return 'Cmd'
      if (lower === 'ctrl' || lower === 'control') return 'Ctrl'
      if (lower === 'option' || lower === 'alt') return 'Alt'
      if (lower === 'shift') return 'Shift'
      return s.length === 1 ? s.toUpperCase() : s[0].toUpperCase() + s.slice(1)
    })
    .join('+')
}

/** 展示形态 → Electron 注册形态（mac 用 CommandOrControl 语义时的注册串） */
export function toElectronAccelerator(accel: string, platform: string): string {
  return normalizeAccelerator(accel)
    .split('+')
    .map((s) => {
      if (platform === 'darwin') {
        if (s === 'Cmd') return 'Command'
        if (s === 'Ctrl') return 'Control'
      }
      return s
    })
    .join('+')
}
