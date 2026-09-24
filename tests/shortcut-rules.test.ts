import { describe, expect, it } from 'vitest'
import { normalizeAccelerator, toElectronAccelerator, validateAccelerator } from '../sdk/shortcut-rules'

describe('validateAccelerator 平台黑名单', () => {
  it('两个平台默认键都可注册（macOS Alt+Space 此前被自家黑名单拒绝）', () => {
    expect(validateAccelerator('Alt+Space', 'darwin')).toEqual({ ok: true })
    expect(validateAccelerator('Ctrl+Alt+Space', 'win32')).toEqual({ ok: true })
  })

  it('space 单修饰按平台分化：win32 全拒，darwin 仅拒 Cmd/Ctrl，Alt/Shift 放行', () => {
    expect(validateAccelerator('Alt+Space', 'win32')).toMatchObject({ ok: false })
    expect(validateAccelerator('Ctrl+Space', 'win32')).toMatchObject({ ok: false })
    expect(validateAccelerator('Shift+Space', 'win32')).toMatchObject({ ok: false })
    expect(validateAccelerator('Cmd+Space', 'darwin')).toMatchObject({ ok: false }) // Spotlight
    expect(validateAccelerator('Ctrl+Space', 'darwin')).toMatchObject({ ok: false }) // 输入源切换
    expect(validateAccelerator('Alt+Space', 'darwin')).toEqual({ ok: true })
    expect(validateAccelerator('Shift+Space', 'darwin')).toEqual({ ok: true })
  })

  it('通用单修饰黑名单两平台一致生效', () => {
    for (const accel of ['Cmd+C', 'Ctrl+V', 'Alt+X', 'Ctrl+Tab', 'Cmd+A']) {
      expect(validateAccelerator(accel, 'darwin')).toMatchObject({ ok: false })
      expect(validateAccelerator(accel, 'win32')).toMatchObject({ ok: false })
    }
  })

  it('双修饰键不落单修饰黑名单；缺修饰键或缺主键拒绝', () => {
    expect(validateAccelerator('Ctrl+Alt+C', 'win32')).toEqual({ ok: true })
    expect(validateAccelerator('Space', 'darwin')).toMatchObject({ ok: false })
    expect(validateAccelerator('Ctrl', 'darwin')).toMatchObject({ ok: false })
    expect(validateAccelerator('Ctrl+Alt+A+X', 'darwin')).toMatchObject({ ok: false })
  })

  it('非字符串入参不抛 TypeError，返回结构化失败', () => {
    expect(validateAccelerator(123 as unknown as string, 'darwin')).toEqual({ ok: false, reason: '快捷键必须是字符串' })
    expect(validateAccelerator(null as unknown as string, 'win32')).toMatchObject({ ok: false })
    expect(validateAccelerator(undefined as unknown as string, 'darwin')).toMatchObject({ ok: false })
  })
})

describe('normalizeAccelerator / toElectronAccelerator', () => {
  it('别名归一', () => {
    expect(normalizeAccelerator('CommandOrControl+Space')).toBe('Ctrl+Space')
    expect(normalizeAccelerator('option + a')).toBe('Alt+A')
  })
  it('darwin 注册形态 Cmd→Command、Ctrl→Control', () => {
    expect(toElectronAccelerator('Cmd+Space', 'darwin')).toBe('Command+Space')
    expect(toElectronAccelerator('Ctrl+Space', 'darwin')).toBe('Control+Space')
    expect(toElectronAccelerator('Ctrl+Space', 'win32')).toBe('Ctrl+Space')
  })
})
