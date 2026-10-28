import { codeToAccelKey, normalizeAccelerator } from '@sdk/shortcut-rules'

/** before-input-event 的 input 子集（node 单测不触 electron）；Electron 的 Input.type 就是宽 string，运行时再判 keyDown/keyUp */
export interface CaptureInput {
  type: string
  key: string
  /** 物理键 code（布局无关），主键唯一可信来源 */
  code?: string
  /** Electron Input.modifiers（'Control'/'Alt'/'Shift'/'Meta'…），权威修饰态 */
  modifiers?: readonly string[]
  alt: boolean
  control: boolean
  shift: boolean
  meta: boolean
  isComposing?: boolean
  isAutoRepeat?: boolean
}

export type HotkeyCaptureHandler = (event: { preventDefault(): void }, input: CaptureInput) => void

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

interface ModState {
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
}

// 修饰态优先取 modifiers 数组，缺省回退布尔字段（旧调用/单测注入形态）
const modsOf = (i: CaptureInput): ModState =>
  i.modifiers
    ? {
        meta: i.modifiers.includes('Meta'),
        ctrl: i.modifiers.includes('Control'),
        alt: i.modifiers.includes('Alt'),
        shift: i.modifiers.includes('Shift')
      }
    : { meta: i.meta, ctrl: i.control, alt: i.alt, shift: i.shift }

/**
 * 热键录入期按键捕获。keyDown 正常结算并 preventDefault（挡住页面侧重复处理）；
 * Windows 系统键组合（如 Alt+Space）的 keyDown 会被吞掉、只留下带修饰标志的 keyUp，
 * 据此重建组合。主键一律取 input.code 过 codeToAccelKey——字符 key 在 Option 组合/非拉丁布局下是死值
 */
export function createHotkeyCapture(send: (accel: string) => void): HotkeyCaptureHandler {
  let lastKeyDown: CaptureInput | null = null
  const accelOf = (code: string | undefined, mods: ModState): string | null => {
    const main = code === undefined ? null : codeToAccelKey(code)
    if (main === null) return null
    const m = [mods.meta && 'Cmd', mods.ctrl && 'Ctrl', mods.alt && 'Alt', mods.shift && 'Shift'].filter(Boolean)
    return normalizeAccelerator([...m, main === ' ' ? 'Space' : main].join('+'))
  }
  const sameMods = (a: ModState, b: ModState): boolean =>
    a.meta === b.meta && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift
  const sameAs = (a: CaptureInput, b: CaptureInput): boolean => a.code === b.code && sameMods(modsOf(a), modsOf(b))
  return (event, input) => {
    if (input.isComposing) return
    if (MODIFIER_KEYS.has(input.key)) return
    if (input.type === 'keyDown') {
      lastKeyDown = input
      const accel = accelOf(input.code, modsOf(input))
      if (accel) send(accel)
      event.preventDefault()
      return
    }
    if (input.type === 'keyUp') {
      const last = lastKeyDown
      lastKeyDown = null
      // keyDown 已结算过同一物理键（code+修饰态），keyUp 不重复发
      if (last && sameAs(last, input)) return
      const accel = accelOf(input.code, modsOf(input))
      if (accel) send(accel)
    }
  }
}
