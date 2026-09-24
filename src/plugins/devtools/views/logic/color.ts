export interface Rgb {
  r: number
  g: number
  b: number
}
export interface Hsl {
  h: number
  s: number
  l: number
}
export interface ParsedColor {
  hex: string
  rgb: Rgb
  hsl: Hsl
}
export type ColorResult = { ok: true; color: ParsedColor } | { ok: false; message: string }

const clamp = (n: number, max: number): number => Math.max(0, Math.min(max, Math.round(n)))

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => clamp(v, 255).toString(16).padStart(2, '0')).join('')}`
}

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
    else if (max === gn) h = ((bn - rn) / d + 2) * 60
    else h = ((rn - gn) / d + 4) * 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x]
  const m = ln - c / 2
  return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 }
}

/** 支持 #abc / #aabbcc / rgb(...) / hsl(...)，非法输入返回错误而非抛异常 */
export function parseColor(input: string): ColorResult {
  const s = input.trim().toLowerCase()
  const rgbMatch = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(s)
  const hslMatch = /^hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/.exec(s)
  let rgb: Rgb | null = null
  if (s.startsWith('#') || /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) {
    rgb = hexToRgb(s)
    if (!rgb) return { ok: false, message: `无法解析颜色：${input}` }
  } else if (rgbMatch) {
    rgb = { r: Number(rgbMatch[1]), g: Number(rgbMatch[2]), b: Number(rgbMatch[3]) }
    if (rgb.r > 255 || rgb.g > 255 || rgb.b > 255) return { ok: false, message: 'RGB 分量须在 0-255' }
  } else if (hslMatch) {
    rgb = hslToRgb({ h: Number(hslMatch[1]), s: Number(hslMatch[2]), l: Number(hslMatch[3]) })
  } else {
    return { ok: false, message: `无法解析颜色：${input}` }
  }
  const rounded: Rgb = { r: clamp(rgb.r, 255), g: clamp(rgb.g, 255), b: clamp(rgb.b, 255) }
  return { ok: true, color: { hex: rgbToHex(rounded), rgb: rounded, hsl: rgbToHsl(rounded) } }
}
