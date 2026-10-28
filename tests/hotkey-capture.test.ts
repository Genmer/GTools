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

describe('createHotkeyCapture（录入期按键捕获，主键取物理键 code）', () => {
  it('普通按键 keyDown 结算一次，keyUp 不重复；修饰键单独按下不发', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    const e1 = ev()
    handler(e1, kd('a', { code: 'KeyA' }))
    expect(send).toHaveBeenCalledWith('A')
    expect(e1.count).toBe(1)
    handler(ev(), ku('a', { code: 'KeyA' }))
    expect(send).toHaveBeenCalledTimes(1)
    handler(ev(), kd('Shift'))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('系统键组合（Alt+Space）：keyDown 被系统吞掉，据带 alt 标志的 keyUp 重建', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    handler(ev(), kd('Alt', { alt: true })) // 修饰键，不发
    handler(ev(), ku(' ', { alt: true, code: 'Space' })) // Space 的 keyDown 被吞，keyUp 带 alt 标志
    expect(send).toHaveBeenCalledWith('Alt+Space')
    handler(ev(), ku('Alt', { alt: false })) // 修饰键 keyUp 不发
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('keyUp 与已结算 keyDown 修饰态不同时视为新按键', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    handler(ev(), kd('a', { code: 'KeyA' }))
    handler(ev(), ku('a', { control: true, code: 'KeyA' })) // Ctrl+A 场景：keydown 被吞，keyUp 带 ctrl
    expect(send).toHaveBeenCalledWith('A')
    expect(send).toHaveBeenCalledWith('Ctrl+A')
  })

  it('输入法组合态不结算', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    handler(ev(), kd('a', { code: 'KeyA', isComposing: true }))
    handler(ev(), ku('a', { code: 'KeyA', isComposing: true }))
    expect(send).not.toHaveBeenCalled()
  })

  it('Space 无修饰键也结算（由上层校验拒绝），大写字母归一', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    handler(ev(), kd(' ', { code: 'Space' }))
    expect(send).toHaveBeenCalledWith('Space')
    handler(ev(), kd('F', { code: 'KeyF' }))
    expect(send).toHaveBeenCalledWith('F')
  })

  it('字符 key 为死值（darwin Option 组合/非拉丁布局）时按 code 结算，修饰可取 modifiers 数组', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    handler(ev(), kd('¬', { code: 'KeyL', modifiers: ['Alt'] })) // Option+L 录出 ¬
    expect(send).toHaveBeenCalledWith('Alt+L')
    handler(ev(), ku('д', { code: 'KeyL', modifiers: ['Alt'] })) // 俄语布局同一物理键
    expect(send).toHaveBeenCalledTimes(1) // code+修饰态相同，keyUp 不重复发
    handler(ev(), kd('Д', { code: 'KeyV', modifiers: ['Control'] }))
    expect(send).toHaveBeenCalledWith('Ctrl+V')
  })

  it('白名单外物理键（分号等）与缺 code 的输入不结算，但 keyDown 仍 preventDefault', () => {
    const send = vi.fn()
    const handler = createHotkeyCapture(send)
    const e1 = ev()
    handler(e1, kd(';', { code: 'Semicolon' }))
    handler(ev(), ku(';', { code: 'Semicolon' }))
    handler(ev(), kd('a')) // 无 code 不结算（code 是主键唯一可信来源）
    expect(send).not.toHaveBeenCalled()
    expect(e1.count).toBe(1)
  })
})
