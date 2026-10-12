import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  RIM_GRADIENT_LEN,
  RIM_GRADIENT_N,
  RIM_RAINBOW_N,
  RIM_SEGMENTS_GRADIENT,
  RIM_SEGMENTS_RAINBOW,
  type RimSegment
} from '../src/renderer/src/shell/rim-ring-segments'

const themesCss = readFileSync(new URL('../src/renderer/src/assets/themes.css', import.meta.url), 'utf-8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

/** 段色纪律：只许纯 var 站或 color-mix(var…var)，出现 hex/rgb 字面量即违反「UI 色值唯一定义处」铁律 */
const COLOR_RE = /^(var\(--rim-rainbow-c[1-4]\)|color-mix\(in srgb, var\(--rim-rainbow-c[1-4]\) \d+(\.\d+)?%, var\(--rim-rainbow-c[1-4]\)\))$/

/** color-mix 段的 A 站占比（纯 var 站返回 null） */
function mixPercent(seg: RimSegment): number | null {
  const m = seg.color.match(/var\(--rim-rainbow-c[1-4]\) (\d+(?:\.\d+)?)%/)
  return m ? Number(m[1]) : null
}

describe('rim-ring-segments：七彩硬四站', () => {
  it('恰 4 段，色为 c1..c4 纯 var，静态相位 [0,-25,-50,-75]', () => {
    expect(RIM_SEGMENTS_RAINBOW).toHaveLength(RIM_RAINBOW_N)
    expect(RIM_SEGMENTS_RAINBOW.map((s) => s.color)).toEqual([
      'var(--rim-rainbow-c1)',
      'var(--rim-rainbow-c2)',
      'var(--rim-rainbow-c3)',
      'var(--rim-rainbow-c4)'
    ])
    expect(RIM_SEGMENTS_RAINBOW.map((s) => s.offset)).toEqual([0, -25, -50, -75])
  })

  it('delay 串逐段 = calc(var(--rim-flow-period) * -i / 4)', () => {
    RIM_SEGMENTS_RAINBOW.forEach((s, i) => {
      expect(s.delay).toBe(`calc(var(--rim-flow-period) * -${i} / ${RIM_RAINBOW_N})`)
    })
  })
})

describe('rim-ring-segments：七彩渐变 36 段', () => {
  it('恰 36 段，站位于 i=0/9/18/27 为 c1..c4 纯 var（无缝闭环：末段回扣 c1）', () => {
    expect(RIM_SEGMENTS_GRADIENT).toHaveLength(RIM_GRADIENT_N)
    for (const [k, i] of [0, 9, 18, 27].entries()) {
      expect(RIM_SEGMENTS_GRADIENT[i].color).toBe(`var(--rim-rainbow-c${k + 1})`)
    }
    expect(RIM_SEGMENTS_GRADIENT[35].color).toBe('color-mix(in srgb, var(--rim-rainbow-c4) 11.11%, var(--rim-rainbow-c1))')
  })

  it('站间过渡占比以 11.11 均匀步进（j=1..8 递减到 11.11，j=0 回纯站）', () => {
    for (let i = 0; i < RIM_GRADIENT_N; i++) {
      const cur = mixPercent(RIM_SEGMENTS_GRADIENT[i])
      if (i % 9 === 0) {
        expect(cur, `i=${i} 应为纯站`).toBeNull()
      } else {
        expect(cur, `i=${i}`).not.toBeNull()
        expect(cur!).toBeCloseTo(100 - (i % 9) * (100 / 9), 1)
      }
    }
  })

  it('静态相位严格递减且 i·L 累计满周期（36·(100/36) 与 100 偏差 ≤ 1e-4）', () => {
    for (let i = 1; i < RIM_SEGMENTS_GRADIENT.length; i++) {
      expect(RIM_SEGMENTS_GRADIENT[i].offset).toBeLessThan(RIM_SEGMENTS_GRADIENT[i - 1].offset)
    }
    expect(RIM_SEGMENTS_GRADIENT[35].offset).toBeCloseTo(-35 * RIM_GRADIENT_LEN, 9)
    expect(Math.abs(RIM_GRADIENT_N * RIM_GRADIENT_LEN - 100)).toBeLessThanOrEqual(1e-4)
  })

  it('delay 串逐段 = calc(var(--rim-flow-period) * -i / 36)', () => {
    RIM_SEGMENTS_GRADIENT.forEach((s, i) => {
      expect(s.delay).toBe(`calc(var(--rim-flow-period) * -${i} / ${RIM_GRADIENT_N})`)
    })
  })
})

describe('rim-ring-segments：色值纪律与 themes.css 对账', () => {
  it('全部段色匹配 var()/color-mix(var…var) 纪律，无 hex/rgb 字面量', () => {
    for (const s of [...RIM_SEGMENTS_RAINBOW, ...RIM_SEGMENTS_GRADIENT]) {
      expect(s.color, s.color).toMatch(COLOR_RE)
      expect(s.color, s.color).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/)
    }
  })

  it('themes.css dash 字面量与模块常量对账（2.7778 ≈ 100/36、25 = 100/4，防双源漂移）', () => {
    expect(themesCss).toContain('stroke-dasharray: 25 75')
    expect(themesCss).toContain('stroke-dasharray: 2.7778 97.2222')
    expect(Math.abs(Number('2.7778') - RIM_GRADIENT_LEN)).toBeLessThanOrEqual(1e-4)
    expect(Math.abs(Number('97.2222') - (100 - RIM_GRADIENT_LEN))).toBeLessThanOrEqual(1e-4)
    expect(Math.abs(Number('25') - 100 / RIM_RAINBOW_N)).toBeLessThanOrEqual(1e-4)
  })
})
