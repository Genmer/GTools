import { describe, expect, it, vi } from 'vitest'
import { createHotkeyCapture, type CaptureInput } from '../src/main/hotkey-capture'

const ev = (): { count: number; preventDefault: () => void } => {
  const e = { count: 0, preventDefault: (): void => { e.count++ } }
  return e
}
const kd = (key: string, mods: Partial<CaptureInput> = {}): CaptureInput => ({
  type: 'keyDown', key, alt: false, control: false, shift: false, meta: false, ...mods
})
const ku = (key: string, mods: Partial<CaptureInput> = {}): CaptureInput => ({
  type: 'keyUp', key, alt: false, control: false, shift: false, meta: false, ...mods
})

describe('createHotkeyCapture（录入期按键捕获）', () => {
  it('普通按键 keyDown 结算一次，keyUp 不重复；修饰键单独按下不发', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    const e1 = ev()
    handler(e1, kd('a'))
    expect(send).toHaveBeenCalledWith('A')
    expect(e1.count).toBe(1)
    handler(ev(), ku('a'))
    expect(send).toHaveBeenCalledTimes(1)
    handler(ev(), kd('Shift'))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('系统键组合（Alt+Space）：keyDown 被系统吞掉，据带 alt 标志的 keyUp 重建', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    handler(ev(), kd('Alt', { alt: true })) // 修饰键，不发
    handler(ev(), ku(' ', { alt: true })) // Space 的 keyDown 被吞，keyUp 带 alt 标志
    expect(send).toHaveBeenCalledWith('Alt+Space')
    handler(ev(), ku('Alt', { alt: false })) // 修饰键 keyUp 不发
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keyUp 与已结算 keyDown 修饰态不同时视为新按键', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    handler(ev(), kd('a'))
    handler(ev(), ku('a', { control: true })) // Ctrl+A 场景：keydown 被吞，keyUp 带 ctrl
    expect(send).toHaveBeenCalledWith('A')
    expect(send).toHaveBeenCalledWith('Ctrl+A')
  })

  it('输入法组合态不结算', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    handler(ev(), kd('a', { isComposing: true }))
    handler(ev(), ku('a', { isComposing: true }))
    expect(send).not.toHaveBeenCalled()
  })

  it('Space 无修饰键也结算（由上层校验拒绝），大写字母归一', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    handler(ev(), kd(' '))
    expect(send).toHaveBeenCalledWith('Space')
    handler(ev(), kd('F'))
    expect(send).toHaveBeenCalledWith('F')
  })
})
