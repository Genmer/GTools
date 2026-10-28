export const MODIFIERS = ['Ctrl', 'Cmd', 'Alt', 'Shift'] as const

/** 单修饰键 + 这些主键属于系统/编辑器保留组合，拒绝注册（设计 §2.2 黑名单）；space 单修饰因平台而异，见 isReservedSingleMod */
const SINGLE_MOD_BLACKLIST = new Set(['c', 'v', 'x', 'z', 'tab', 'a', 'f4', 'escape', 'enter'])

export interface AcceleratorIssue {
  ok: boolean
  reason?: string
}

/** 物理键 code → 主键的固定映射（正则盖不住的几个）；白名单外 code 返回 null */
const CODE_KEY_NAMES: Readonly<Record<string, string>> = {
  Space: ' ',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

/** KeyboardEvent.code（物理键，布局无关）→ 展示形态主键；白名单外（标点/小键盘/媒体键/F25+）返回 null。
 *  字符 key 在 Option 组合/非拉丁布局下是死值（Alt+¬/西里尔字母），键名必须取 code */
export function codeToAccelKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return CODE_KEY_NAMES[code] ?? null
}

/** 主键白名单：字母/数字/F1-F24/空格（裸 ' ' 与 'space' 同认）/方向键，与 codeToAccelKey 键域一致 */
function isAllowedMainKey(key: string): boolean {
  const k = key.toUpperCase()
  if (k.length === 1) return k === ' ' || /[A-Z0-9]/.test(k)
  return (
    k === 'SPACE' ||
    k === 'UP' ||
    k === 'DOWN' ||
    k === 'LEFT' ||
    k === 'RIGHT' ||
    /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(k)
  )
}

/** 校验 Electron Accelerator：至少一个修饰键 + 一个白名单主键，且不撞平台黑名单 */
export function validateAccelerator(accel: string, platform: string): AcceleratorIssue {
  // settings.json 可能把热键改成非字符串，先挡掉再 split；裸空格段（'Ctrl+ '）保住为主键 ' '，空串段丢弃
  if (typeof accel !== 'string') return { ok: false, reason: '快捷键必须是字符串' }
  const parts = accel
    .split('+')
    .filter((s) => s.length > 0)
    .map((s) => (s.trim() === '' ? ' ' : s.trim()))
  if (parts.length < 2) return { ok: false, reason: '至少需要一个修饰键和一个主键' }
  const mods = parts.filter((p) => (MODIFIERS as readonly string[]).includes(p))
  const keys = parts.filter((p) => !(MODIFIERS as readonly string[]).includes(p))
  if (mods.length === 0) return { ok: false, reason: '缺少修饰键（Ctrl/Cmd/Alt/Shift）' }
  if (keys.length !== 1) return { ok: false, reason: '必须有且只有一个主键' }
  if (!isAllowedMainKey(keys[0])) {
    return { ok: false, reason: '主键仅支持字母/数字/F1-F24/空格/方向键' }
  }
  if (mods.length === 1 && isReservedSingleMod(mods[0], keys[0], platform)) {
    return { ok: false, reason: `组合 ${accel} 是系统保留快捷键` }
  }
  return { ok: true }
}

/** space 单修饰组合平台分化：win32 放行 Alt+Space（globalShortcut 的 RegisterHotKey 先于窗口菜单拦截，PowerToys Run/uTools 先例），仍拒 Ctrl(输入法切换)/Shift(全半角)；darwin 仅拒 Cmd(Spotlight)/Ctrl(输入源) */
function isReservedSingleMod(mod: string, key: string, platform: string): boolean {
  const k = key === ' ' ? 'space' : key.toLowerCase()
  if (k === 'space') {
    if (platform === 'win32') return mod !== 'Alt'
    return mod === 'Cmd' || mod === 'Ctrl'
  }
  return SINGLE_MOD_BLACKLIST.has(k)
}

/** Electron Accelerator 原生键名（CommandOrControl/Option 等）统一成展示/存储形态 */
export function normalizeAccelerator(accel: string): string {
  return accel
    .split('+')
    .filter((s) => s.length > 0)
    .map((s) => (s.trim() === '' ? 'Space' : s.trim()))
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
