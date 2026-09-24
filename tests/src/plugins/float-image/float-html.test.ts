import { describe, expect, it } from 'vitest'
import {
  FLOAT_THEME_VARS,
  buildFloatHtml,
  extractThemeVars,
  sanitizeDataUrl,
  type ThemeVarName
} from '../../../../src/plugins/float-image/logic/float-html'

const PNG_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const JPEG_URL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAA='
const SVG_URL = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4='

const THEME: Record<ThemeVarName, string> = {
  '--bg-raised': '#f2f3f5',
  '--fg': '#1f2328',
  '--fg-dim': '#59626d',
  '--border': '#d8dee4',
  '--accent': '#0969da',
  '--danger': '#cf222e'
}

describe('sanitizeDataUrl', () => {
  it('接受白名单 mime 的 base64 dataUrl', () => {
    expect(sanitizeDataUrl(PNG_URL)).toBe(PNG_URL)
    expect(sanitizeDataUrl(JPEG_URL)).toBe(JPEG_URL)
    expect(sanitizeDataUrl(SVG_URL)).toBe(SVG_URL)
  })

  it('拒绝脚本/非法字符/未知类型/超长', () => {
    expect(sanitizeDataUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeDataUrl('data:image/png;base64,a"b<c')).toBeNull()
    expect(sanitizeDataUrl('data:image/tiff;base64,AAA')).toBeNull()
    expect(sanitizeDataUrl('')).toBeNull()
    expect(sanitizeDataUrl(123)).toBeNull()
    expect(sanitizeDataUrl(`data:image/png;base64,${'A'.repeat(2_000_000)}`)).toBeNull()
  })
})

describe('extractThemeVars', () => {
  it('逐个读取并剔除空值', () => {
    const got = extractThemeVars((name) => (name === '--danger' ? '  ' : THEME[name]))
    expect(got['--danger']).toBeUndefined()
    expect(got['--accent']).toBe('#0969da')
    expect(Object.keys(got).sort()).toEqual([...FLOAT_THEME_VARS].slice(0, 5).sort())
  })
})

describe('buildFloatHtml', () => {
  it('非法图片数据抛错', () => {
    expect(() => buildFloatHtml('javascript:alert(1)', { themeVars: THEME, opacity: 1 })).toThrow()
  })

  it('主题变量缺失或含注入字符抛错', () => {
    expect(() => buildFloatHtml(PNG_URL, { themeVars: { ...THEME, '--border': '' }, opacity: 1 })).toThrow(/--border/)
    expect(() =>
      buildFloatHtml(PNG_URL, { themeVars: { ...THEME, '--fg': 'red;}body{display:none' }, opacity: 1 })
    ).toThrow()
  })

  it('产出包含拖动区/交互按钮/图片/桥调用的完整页面', () => {
    const html = buildFloatHtml(PNG_URL, { themeVars: THEME, opacity: 0.5 })
    expect(html).toContain(`src="${PNG_URL}"`)
    expect(html).toContain('class="bar drag"')
    expect(html).toContain('no-drag')
    expect(html).toContain('gtoolsFloat.close')
    expect(html).toContain("addEventListener('wheel'")
    expect(html).toContain("addEventListener('dblclick'")
    expect(html).toContain('object-fit:contain')
    expect(html).toContain('value="50"')
    expect(html).toContain('data-act="reset"')
    expect(html).toContain('data-act="close"')
    for (const name of FLOAT_THEME_VARS) {
      expect(html).toContain(`${name}:${THEME[name]}`)
    }
  })

  it('控制条默认隐形不挡图片，hover 浮窗时才浮现', () => {
    const html = buildFloatHtml(PNG_URL, { themeVars: THEME, opacity: 1 })
    expect(html).toContain('.pin:hover .bar')
    expect(html).toContain('pointer-events:none')
    expect(html).toContain('opacity:0')
  })

  it('不透明度越界被夹取（15% 下限）', () => {
    expect(buildFloatHtml(PNG_URL, { themeVars: THEME, opacity: 0.01 })).toContain('value="15"')
    expect(buildFloatHtml(PNG_URL, { themeVars: THEME, opacity: 2 })).toContain('value="100"')
  })
})
