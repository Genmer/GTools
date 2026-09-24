import { describe, expect, it } from 'vitest'
import {
  hexToRgb,
  hslToRgb,
  parseColor,
  rgbToHex,
  rgbToHsl
} from '../../../../src/plugins/devtools/views/logic/color'

describe('devtools color 基础转换', () => {
  it('hexToRgb：3 位展开、6 位、可带 #、大小写不敏感', () => {
    expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 })
    expect(hexToRgb('aabbcc')).toEqual({ r: 170, g: 187, b: 204 })
    expect(hexToRgb('#ABCDEF')).toEqual({ r: 171, g: 205, b: 239 })
    expect(hexToRgb('#00ff80')).toEqual({ r: 0, g: 255, b: 128 })
  })

  it('hexToRgb：非法输入返回 null', () => {
    expect(hexToRgb('#abcd')).toBeNull()
    expect(hexToRgb('#xyz')).toBeNull()
    expect(hexToRgb('')).toBeNull()
    expect(hexToRgb('#aabbccd')).toBeNull()
  })

  it('rgbToHex：补零与越界/小数钳取整', () => {
    expect(rgbToHex({ r: 255, g: 0, b: 128 })).toBe('#ff0080')
    expect(rgbToHex({ r: 0, g: 0, b: 0 })).toBe('#000000')
    expect(rgbToHex({ r: -5, g: 300, b: 12.6 })).toBe('#00ff0d')
  })

  it('rgbToHsl：基准色对照', () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 })
    expect(rgbToHsl({ r: 0, g: 255, b: 0 })).toEqual({ h: 120, s: 100, l: 50 })
    expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toEqual({ h: 240, s: 100, l: 50 })
    expect(rgbToHsl({ r: 255, g: 255, b: 0 })).toEqual({ h: 60, s: 100, l: 50 })
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 100 })
    expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toEqual({ h: 0, s: 0, l: 50 })
  })

  it('hslToRgb：基准色与 h 跨圈归一（400° ≡ 40°）', () => {
    expect(hslToRgb({ h: 0, s: 100, l: 50 })).toEqual({ r: 255, g: 0, b: 0 })
    expect(hslToRgb({ h: 240, s: 100, l: 50 })).toEqual({ r: 0, g: 0, b: 255 })
    expect(hslToRgb({ h: 0, s: 0, l: 100 })).toEqual({ r: 255, g: 255, b: 255 })
    expect(hslToRgb({ h: 400, s: 100, l: 50 })).toEqual(hslToRgb({ h: 40, s: 100, l: 50 }))
  })
})

describe('devtools parseColor（多格式入口）', () => {
  it('#abc 输出三表示法一致', () => {
    const r = parseColor('#abc')
    expect(r).toEqual({
      ok: true,
      color: { hex: '#aabbcc', rgb: { r: 170, g: 187, b: 204 }, hsl: { h: 210, s: 25, l: 73 } }
    })
  })

  it('无 # 前缀的 6 位 hex 也可解析；首尾空白与大小写容忍', () => {
    expect(parseColor('aabbcc').ok).toBe(true)
    const r = parseColor('  #FF0000 ')
    expect(r.ok && r.color.hex).toBe('#ff0000')
  })

  it('rgb(...) 解析与 0-255 越界拒绝', () => {
    const r = parseColor('rgb(12, 34, 56)')
    expect(r.ok && r.color.hex).toBe('#0c2238')
    expect(parseColor('RGB(0,255,0)').ok).toBe(true)
    const bad = parseColor('rgb(256, 0, 0)')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message).toContain('0-255')
  })

  it('hsl(...) 转换到 hex（120,50%,50% → #40bf40）', () => {
    const r = parseColor('hsl(120, 50%, 50%)')
    expect(r.ok && r.color.hex).toBe('#40bf40')
  })

  it('hsl 分量越界靠钳制兜底（150% 饱和度不越界输出）', () => {
    const r = parseColor('hsl(0, 150%, 50%)')
    expect(r.ok && r.color.hex).toBe('#ff0000')
  })

  it('无法识别的输入返回错误而非抛异常', () => {
    for (const s of ['', 'red', '#12345', 'rgb(1,2)', 'hsl(0,50,50)', 'hsl(0, 50%, 100)']) {
      const r = parseColor(s)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toContain('无法解析颜色')
    }
  })
})
