import { normalizeAccelerator } from '@sdk/shortcut-rules'

/** before-input-event 的 input 子集（node 单测不触 electron）；Electron 的 Input.type 就是宽 string，运行时再判 keyDown/keyUp */
export interface CaptureInput {
  type: string
  key: string
  alt: boolean
  control: boolean
  shift: boolean
  meta: boolean
  isComposing?: boolean
  isAutoRepeat?: boolean
}

export type HotkeyCaptureHandler = (event: { preventDefault(): void }, input: CaptureInput) => void

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/**
 * 热键录入期按键捕获。keyDown 正常结算并 preventDefault（挡住页面侧重复处理）；
 * Windows 系统键组合（如 Alt+Space）的 keyDown 会被吞掉、只留下带修饰标志的 keyUp，
 * 据此重建组合——探针实测：keyDown Alt → keyUp " "(alt=true) → 重建为 Alt+Space
 */
export function createHotkeyCapture(send: (accel: string) => void): HotkeyCaptureHandler {
  let lastKeyDown: CaptureInput | null = null
  const accelOf = (key: string, i: { alt: boolean; control: boolean; shift: boolean; meta: boolean }): string | null => {
    if (MODIFIER_KEYS.has(key)) return null
    const mods = [i.meta && 'Cmd', i.control && 'Ctrl', i.alt && 'Alt', i.shift && 'Shift'].filter(Boolean)
    const keyName = key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key
    return normalizeAccelerator([...mods, keyName].join('+'))
  }
  const sameAs = (a: CaptureInput, b: CaptureInput): boolean =>
    a.key === b.key && a.alt === b.alt && a.control === b.control && a.shift === b.shift && a.meta === b.meta
  return (event, input) => {
    if (input.isComposing) return
    if (MODIFIER_KEYS.has(input.key)) return
    if (input.type === 'keyDown') {
      lastKeyDown = input
      const accel = accelOf(input.key, input)
      if (accel) send(accel)
      event.preventDefault()
      return
    }
    if (input.type === 'keyUp') {
      const last = lastKeyDown
      lastKeyDown = null
      // keyDown 已结算过同一按键，keyUp 不重复发
      if (last && sameAs(last, input)) return
      const accel = accelOf(input.key, input)
      if (accel) send(accel)
    }
  }
}
