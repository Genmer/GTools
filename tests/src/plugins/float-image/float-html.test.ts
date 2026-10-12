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

  it('超默认上限的合法 dataUrl 在放宽 maxLen 后通过（pinDataUrl 首道只验格式的契约，微信大图 0.0.51）', () => {
    const big = `data:image/png;base64,${'A'.repeat(2_500_000)}`
    expect(sanitizeDataUrl(big)).toBeNull()
    expect(sanitizeDataUrl(big, Number.MAX_SAFE_INTEGER)).toBe(big)
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

  it('透明/玻璃主题的未化简 calc 原串放行（Chromium 对未注册自定义属性不化简 calc，0.0.45 前被 +* 误拒致 mac 悬浮失败）', () => {
    const calcVars: Record<ThemeVarName, string> = {
      ...THEME,
      // Electron 44 实测 getComputedStyle 原串（var(--tx) 已由宿主注入值替换）
      '--bg-raised': 'rgba(255, 255, 255, calc(0.02 + 0.6 * 0.0911 + 0.04 * 0.55))',
      '--fg': 'rgba(22, 32, 46, calc(0.62 * 1))',
      '--border': 'color-mix(in srgb, #fff 40%, transparent)'
    }
    const html = buildFloatHtml(PNG_URL, { themeVars: calcVars, opacity: 1 })
    expect(html).toContain('--bg-raised:rgba(255, 255, 255, calc(0.02 + 0.6 * 0.0911 + 0.04 * 0.55))')
    // 浅色+透明 / 深色+透明的 tint 原串同样放行
    expect(() =>
      buildFloatHtml(PNG_URL, {
        themeVars: { ...THEME, '--bg-raised': 'rgba(255, 255, 255, calc(0.15 + (1 - 0.55) * 0.9))' },
        opacity: 1
      })
    ).not.toThrow()
    expect(() =>
      buildFloatHtml(PNG_URL, {
        themeVars: { ...THEME, '--bg-raised': 'rgba(44, 44, 46, calc(0.12 + (1 - 0.55) * 0.9))' },
        opacity: 1
      })
    ).not.toThrow()
  })

  it('放行 calc 后注入面不扩大：分号/花括号/引号仍拒绝，超长（>120）仍拒绝', () => {
    expect(() =>
      buildFloatHtml(PNG_URL, { themeVars: { ...THEME, '--accent': 'red;background:url(x)' }, opacity: 1 })
    ).toThrow(/--accent/)
    expect(() =>
      buildFloatHtml(PNG_URL, { themeVars: { ...THEME, '--accent': `rgba(255,255,255,${'1'.repeat(120)})` }, opacity: 1 })
    ).toThrow(/--accent/)
  })

  it('产出包含拖动区/交互按钮/图片/桥调用的完整页面', () => {
    const html = buildFloatHtml(PNG_URL, { themeVars: THEME, opacity: 0.5 })
    expect(html).toContain(`src="${PNG_URL}"`)
    expect(html).toContain('class="bar drag"')
    expect(html).toContain('no-drag')
    expect(html).toContain('gtoolsFloat.close')
    expect(html).toContain("addEventListener('wheel'")
    expect(html).toContain("addEventListener('dblclick'")
    // 抓图拖动：pointer 事件增量上报（图片本体不挂原生 drag 区，双击/滚轮才不被吞）
    expect(html).toContain("addEventListener('pointerdown'")
    expect(html).toContain("emit('drag-move'")
    expect(html).toContain("addEventListener('pointermove'")
    expect(html).toContain('draggable="false"')
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
