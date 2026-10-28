import { describe, expect, it } from 'vitest'
import { codeToAccelKey, normalizeAccelerator, toElectronAccelerator, validateAccelerator } from '../sdk/shortcut-rules'

describe('codeToAccelKey（物理键 code → 主键，布局无关）', () => {
  it('字母/数字/F1-F24/空格/方向键映射', () => {
    expect(codeToAccelKey('KeyA')).toBe('A')
    expect(codeToAccelKey('KeyZ')).toBe('Z')
    expect(codeToAccelKey('Digit0')).toBe('0')
    expect(codeToAccelKey('Digit9')).toBe('9')
    expect(codeToAccelKey('F1')).toBe('F1')
    expect(codeToAccelKey('F9')).toBe('F9')
    expect(codeToAccelKey('F24')).toBe('F24')
    expect(codeToAccelKey('Space')).toBe(' ')
    expect(codeToAccelKey('ArrowUp')).toBe('Up')
    expect(codeToAccelKey('ArrowDown')).toBe('Down')
    expect(codeToAccelKey('ArrowLeft')).toBe('Left')
    expect(codeToAccelKey('ArrowRight')).toBe('Right')
  })

  it('白名单外物理键返回 null（标点/小键盘/媒体/F25）', () => {
    for (const code of ['Semicolon', 'IntlRo', 'Comma', 'Period', 'Numpad1', 'F25', 'F0', 'MediaPlayPause', 'Escape', 'Tab', '']) {
      expect(codeToAccelKey(code)).toBeNull()
    }
  })
})

describe('主键白名单（validateAccelerator）', () => {
  it('字母/数字/F12/空格/方向键过；裸空格与 Space 同认', () => {
    expect(validateAccelerator('Ctrl+D', 'win32')).toEqual({ ok: true })
    expect(validateAccelerator('Cmd+7', 'darwin')).toEqual({ ok: true })
    expect(validateAccelerator('Alt+F12', 'win32')).toEqual({ ok: true })
    expect(validateAccelerator('Shift+Up', 'win32')).toEqual({ ok: true })
    expect(validateAccelerator('Ctrl+Left', 'darwin')).toEqual({ ok: true })
    expect(validateAccelerator('Alt+ ', 'win32')).toEqual({ ok: true }) // ≡ Alt+Space
  })

  it('白名单外主键拒绝：¡/PrintScreen/F25/西里尔/Tab 等', () => {
    for (const accel of ['Ctrl+¡', 'Cmd+PrintScreen', 'Ctrl+F25', 'Ctrl+Д', 'Ctrl+Semicolon', 'Ctrl+Tab', 'Ctrl+Enter', 'Ctrl+,']) {
      expect(validateAccelerator(accel, 'win32')).toEqual({ ok: false, reason: '主键仅支持字母/数字/F1-F24/空格/方向键' })
      expect(validateAccelerator(accel, 'darwin')).toEqual({ ok: false, reason: '主键仅支持字母/数字/F1-F24/空格/方向键' })
    }
  })

  it('裸空格主键与 Space 同认平台保留规则（Ctrl+ ≡ Ctrl+Space 拒）', () => {
    expect(validateAccelerator('Ctrl+ ', 'win32')).toMatchObject({ ok: false }) // 输入法切换
    expect(validateAccelerator('Shift+ ', 'darwin')).toEqual({ ok: true })
    expect(normalizeAccelerator('Alt+ ')).toBe('Alt+Space')
  })

  it('存量默认形态 Alt+Space / Ctrl+Alt+Space 仍过（零误伤）', () => {
    expect(validateAccelerator('Alt+Space', 'darwin')).toEqual({ ok: true })
    expect(validateAccelerator('Ctrl+Alt+Space', 'win32')).toEqual({ ok: true })
  })
})

describe('validateAccelerator 平台黑名单', () => {
  it('两个平台默认键都可注册（macOS Alt+Space 此前被自家黑名单拒绝）', () => {
    expect(validateAccelerator('Alt+Space', 'darwin')).toEqual({ ok: true })
    expect(validateAccelerator('Ctrl+Alt+Space', 'win32')).toEqual({ ok: true })
  })

  it('space 单修饰按平台分化：win32 放行 Alt+Space、仍拒 Ctrl/Shift，darwin 仅拒 Cmd/Ctrl', () => {
    expect(validateAccelerator('Alt+Space', 'win32')).toEqual({ ok: true }) // RegisterHotKey 先于窗口菜单拦截
    expect(validateAccelerator('Ctrl+Space', 'win32')).toMatchObject({ ok: false }) // 输入法切换
    expect(validateAccelerator('Shift+Space', 'win32')).toMatchObject({ ok: false }) // 全半角切换
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
