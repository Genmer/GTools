import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 无 DOM 测试基建，轮廓环 CSS 用静态文本断言：关键选择器存在 + 特异性层级正确
const css = readFileSync(new URL('../src/renderer/src/assets/themes.css', import.meta.url), 'utf-8').replace(/\r\n/g, '\n')
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')

const escapeReg = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 取选择器（首个匹配）的声明块内容 */
function blockOf(selector: string): string {
  const m = bare.match(new RegExp(`${escapeReg(selector)}\\s*\\{([^}]*)\\}`))
  return m ? m[1] : ''
}

/** 大括号配平取块体（@media/@keyframes 嵌套安全），从 openIdx 起首个 { 到配对 } */
function balancedAfter(openIdx: number): string {
  const open = bare.indexOf('{', openIdx)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < bare.length; i++) {
    if (bare[i] === '{') depth++
    else if (bare[i] === '}') {
      depth--
      if (depth === 0) return bare.slice(open + 1, i)
    }
  }
  return ''
}

interface CssRule {
  selector: string
  body: string
}

/** 展平全部顶层规则（@keyframes/@media 内层规则也以自身选择器出现在列表中） */
function rules(): CssRule[] {
  const out: CssRule[] = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(bare)) !== null) {
    out.push({ selector: m[1].trim(), body: m[2] })
  }
  return out
}

/** 近似特异性 (a,b,c)：#id→a；.类/[属性]/:伪类→b；元素/::伪元素→c（本项目选择器形态够用） */
function specificity(sel: string): [number, number, number] {
  let a = 0
  let b = 0
  let c = 0
  const s = sel.replace(/\[[^\]]*\]/g, '[]')
  const simple = /#[\w-]+|::[\w-]+|:[\w-]+|\.[\w-]+|\[\]/g
  for (const m of s.matchAll(simple)) {
    if (m[0].startsWith('#')) a++
    else if (m[0].startsWith('::')) c++
    else b++
  }
  c += (s.replace(simple, ' ').match(/\b[a-z][a-z\d-]*\b/g) ?? []).length
  return [a, b, c]
}

describe('themes.css：轮廓环伪元素规则', () => {
  it('主窗与独立窗共用一条环规则：.app::before 与 .detached::before 在同一选择器组', () => {
    expect(bare).toMatch(/\.app::before,\s*\.detached::before\s*\{/)
    const body = blockOf('.app::before,\n.detached::before')
    expect(body).toContain('border: var(--rim-width, 3px) solid transparent')
    expect(body).toContain('border-color: var(--rim-c1) var(--rim-c2) var(--rim-c3) var(--rim-c4)')
    expect(body).toContain('z-index: var(--z-ring)')
  })

  it('环色源值唯一定义处：--rim-black/--rim-white/--rim-rainbow-c1..c4 各只定义一次（其余经 var 引用）', () => {
    expect((bare.match(/--rim-black\s*:/g) ?? []).length).toBe(1)
    expect((bare.match(/--rim-white\s*:/g) ?? []).length).toBe(1)
    for (const k of ['c1', 'c2', 'c3', 'c4']) {
      expect((bare.match(new RegExp(`--rim-rainbow-${k}\\s*:`, 'g')) ?? []).length).toBe(1)
    }
  })

  it('流动周期唯一定义：--rim-flow-period: 12s 在 :root 源色区（段内联 delay 以 calc 乘系数联动）', () => {
    expect((bare.match(/--rim-flow-period\s*:/g) ?? []).length).toBe(1)
    expect(bare).toContain('--rim-flow-period: 12s')
  })
})

describe('themes.css：总开关与用户环色的特异性层级', () => {
  const RING_OFF = "html:root[data-theme][data-ring='off']"

  it("data-ring='off' 块存在且环宽归零（带 --rim-width 回退值也不放行）", () => {
    const body = blockOf(RING_OFF)
    expect(body).toContain('--rim-width: 0px')
  })

  it("关环选择器带 :root[data-theme] 前缀，特异性 (0,3,1) 稳压透明组 (0,2,1)（否则透明模式下关环失效）", () => {
    const txDark = "html[data-transparency='on'][data-theme='dark']"
    expect(bare).toContain(RING_OFF)
    expect(bare).toContain(txDark)
    expect(specificity(RING_OFF)).toEqual([0, 3, 1])
    expect(specificity(txDark)).toEqual([0, 2, 1])
    // 稳压 = 比较元组整体（CSS 特异性从左到右比较）
    expect(specificity(RING_OFF) > specificity(txDark)).toBe(true)
  })

  it('用户环色纯色预设块 white/black/custom 存在：各覆盖四站 --rim-c1..c4 且经 var 引用源色（预设块不硬编码色值）', () => {
    for (const color of ['white', 'black', 'custom'] as const) {
      const sel = `html:root[data-theme][data-rim-color='${color}']`
      const body = blockOf(sel)
      expect(body, sel).not.toBe('')
      for (const k of ['c1', 'c2', 'c3', 'c4']) {
        expect(body).toContain(`--rim-${k}: var(--rim-`)
      }
      expect(body).not.toMatch(/rgba?\(/)
      // 与关环同款 :root[data-theme] 前缀：稳压透明组七彩环默认
      expect(specificity(sel)).toEqual([0, 3, 1])
    }
    // custom 预设：四站同取 --rim-custom（渲染层内联注入），CSS 兜底回退既有源色
    const custom = blockOf("html:root[data-theme][data-rim-color='custom']")
    expect(custom).toContain('--rim-c1: var(--rim-custom, var(--rim-rainbow-c3))')
    expect(custom).toContain('--rim-c4: var(--rim-custom, var(--rim-rainbow-c3))')
  })

  it('rainbow 与 rainbow-gradient 预设块均四站 transparent：border 让位 SVG 段列环（防双环）', () => {
    for (const color of ['rainbow', 'rainbow-gradient'] as const) {
      const sel = `html:root[data-theme][data-rim-color='${color}']`
      const body = blockOf(sel)
      expect(body, sel).not.toBe('')
      for (const k of ['c1', 'c2', 'c3', 'c4']) {
        expect(body).toContain(`--rim-${k}: transparent`)
      }
      expect(specificity(sel)).toEqual([0, 3, 1])
    }
  })

  it('被否决的原地变色注册机制不回归：不得出现 @property --rim-（RGB 闪光禁令）', () => {
    expect(bare).not.toContain('@property --rim-')
  })

  it('透明模式默认七彩环：dark/light 透明组内环宽与四站经 var 引用 rainbow 源色', () => {
    const txDark = blockOf("html[data-transparency='on'][data-theme='dark']")
    expect(txDark).toContain('--rim-width: 3px')
    expect(txDark).toContain('--rim-c1: var(--rim-rainbow-c1)')
  })
})

describe('themes.css：七彩环 SVG 段列层', () => {
  it('.rim-ring 默认 display:none 且不接事件/浮于内容之上', () => {
    const body = blockOf('.rim-ring')
    expect(body).toContain('display: none')
    expect(body).toContain('z-index: var(--z-ring)')
    expect(body).toContain('pointer-events: none')
  })

  it('svg 根显隐双门控：仅 rainbow/rainbow-gradient 且环开各放行一条，其余模式/关环不出双环', () => {
    const displayBlockRules = rules().filter((r) => r.body.includes('display: block') && r.selector.includes('.rim-ring'))
    expect(displayBlockRules).toHaveLength(2)
    for (const color of ['rainbow', 'rainbow-gradient'] as const) {
      const gate = displayBlockRules.find((r) => r.selector.includes(`[data-rim-color='${color}']`))
      expect(gate, color).toBeDefined()
      expect(gate!.selector).toContain(":not([data-ring='off'])")
      expect(gate!.selector).toContain('.rim-ring')
    }
  })

  it('段组默认藏、按环色单点放行：.rim-ring g 默认 none，两条 :not([data-ring=off]) 门控 display:inline', () => {
    const gDefault = blockOf('.rim-ring g')
    expect(gDefault).toContain('display: none')
    const inlineRules = rules().filter((r) => r.body.includes('display: inline') && r.selector.includes('.rim-ring'))
    expect(inlineRules).toHaveLength(2)
    for (const color of ['rainbow', 'rainbow-gradient'] as const) {
      const cls = color === 'rainbow' ? 'g-rainbow' : 'g-gradient'
      const gate = inlineRules.find((r) => r.selector.includes(`[data-rim-color='${color}']`))
      expect(gate, color).toBeDefined()
      expect(gate!.selector).toContain(":not([data-ring='off'])")
      expect(gate!.selector).toContain(cls)
    }
  })

  it('rect 几何与 rx 分治：默认 rx:0（浮窗/不透明窗直角），透明主窗取描边中线半径 calc；rect 不声明 stroke（段色由共享模块内联注入）', () => {
    const rect = blockOf('.rim-ring rect')
    expect(rect).toContain('rx: 0')
    expect(rect).toContain('stroke-width: var(--rim-width)')
    expect(rect).toContain('fill: none')
    expect(rect).not.toMatch(/stroke\s*:/)
    const rxOverride = blockOf("html[data-wintx='1'] .detached .rim-ring rect")
    expect(rxOverride).not.toBe('')
    expect(rxOverride).toContain('rx: calc(var(--r-window) - var(--rim-width) / 2)')
    // 同一规则并列覆盖主窗 .app 与独立窗 .detached（独立窗漏列=啃角回归）
    expect(bare).toContain(
      "html[data-wintx='1'] .app .rim-ring rect,\nhtml[data-wintx='1'] .detached .rim-ring rect"
    )
  })

  it('段列 dash 字面量：rainbow 25 75、gradient 2.7778 97.2222（2.7778 与 rim-ring-segments.ts 的 100/36 对账）', () => {
    expect(blockOf('.g-rainbow rect')).toContain('stroke-dasharray: 25 75')
    expect(blockOf('.g-gradient rect')).toContain('stroke-dasharray: 2.7778 97.2222')
  })
})

describe('themes.css：轮廓流动动画门控（色段沿环带空间位移，防原地变色/双环回归）', () => {
  const FLOW = "[data-rim-flow='on']"
  const RAINBOW = "[data-rim-color='rainbow']" // 精确值匹配：'rainbow-gradient' 不含该子串（' 后随 -）

  it('rim-lap 规则恰 2 条、单选择器、各带精确 rim-color 值与对应段组类', () => {
    const lapRules = rules().filter((r) => r.body.includes('animation: rim-lap'))
    expect(lapRules).toHaveLength(2)
    for (const color of ['rainbow', 'rainbow-gradient'] as const) {
      const cls = color === 'rainbow' ? 'g-rainbow' : 'g-gradient'
      const r = lapRules.find((rule) => rule.selector.includes(`[data-rim-color='${color}']`))
      expect(r, color).toBeDefined()
      // 禁选择器组：裸段会无条件命中
      expect(r!.selector.split(',').length).toBe(1)
      expect(r!.selector).toContain(FLOW)
      expect(r!.selector).toContain(cls)
      expect(r!.body).toContain('animation: rim-lap var(--rim-flow-period) linear infinite')
    }
    expect(lapRules.map((r) => r.selector)).toContain(`html${FLOW}${RAINBOW} .rim-ring .g-rainbow rect`)
  })

  it('全局动画作用域扫描：任何含 animation: 的规则选择器必含 .rim-ring（伪元素上出现动画即 RGB 闪光回归）', () => {
    const offenders = rules().filter((r) => r.body.includes('animation:') && !r.selector.includes('.rim-ring'))
    expect(offenders.map((r) => r.selector)).toEqual([])
  })

  it('被否决的原地变色 keyframes 不回归：bare 不含 rim-tour/rim-grad-tour，也无 stop 相位延迟', () => {
    expect(bare).not.toContain('rim-tour')
    expect(bare).not.toContain('rim-grad-tour')
    expect(bare).not.toContain('.rim-ring stop')
    expect(bare).not.toContain('animation-delay: -2s')
  })

  it('keyframes rim-lap：from 0 → to -100（pathLength=100 归一化周期，终点 ≡ 起点无缝循环）', () => {
    const idx = bare.indexOf('@keyframes rim-lap')
    expect(idx).toBeGreaterThanOrEqual(0)
    const body = balancedAfter(idx)
    expect(body).toContain('stroke-dashoffset: 0')
    expect(body).toContain('stroke-dashoffset: -100')
  })

  it('prefers-reduced-motion 块：覆盖两条流动门控且置 animation:none（同特异性靠后胜，回落静态段列环）', () => {
    const idx = bare.indexOf('@media (prefers-reduced-motion: reduce)')
    expect(idx).toBeGreaterThanOrEqual(0)
    const media = balancedAfter(idx)
    expect((media.match(/animation: none/g) ?? []).length).toBe(2)
    expect(media).toContain(`${FLOW}${RAINBOW} .rim-ring .g-rainbow rect`)
    expect(media).toContain(`${FLOW}[data-rim-color='rainbow-gradient'] .rim-ring .g-gradient rect`)
    // 必须置于动画规则之后（同特异性靠后赢级联）
    const flowIdx = bare.indexOf(`animation: rim-lap`)
    expect(flowIdx).toBeGreaterThan(0)
    expect(idx).toBeGreaterThan(flowIdx)
  })
})
