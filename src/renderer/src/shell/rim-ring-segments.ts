/**
 * 七彩环 SVG 段列配置：主窗（App.vue）与浮窗（DetachedHost.vue）共享，防两窗渲染漂移。
 * pathLength=100 归一化坐标系，dash on 段长 = 100/N。
 */

export interface RimSegment {
  /** 段描边色：只许 var()/color-mix(var…var) 组合，色值唯一定义在 themes.css 源色区 */
  color: string
  /** 静态相位 stroke-dashoffset（负值把本段沿路径前移 i 格），动画启停/减动效回落都停在此相位 */
  offset: number
  /** 内联 animation-delay，与 offset 严格同相位：calc(var(--rim-flow-period) * -i / N) */
  delay: string
}

export const RIM_RAINBOW_N = 4
export const RIM_GRADIENT_N = 36
/** 段长取 100/N 精确值（勿写 2.7778 字面量）：负延迟相位必须与静态 offset 同值，字面量在 i=35 处漂移 */
export const RIM_GRADIENT_LEN = 100 / RIM_GRADIENT_N

function delay(i: number, n: number): string {
  return `calc(var(--rim-flow-period) * -${i} / ${n})`
}

function offset(i: number, len: number): number {
  return i === 0 ? 0 : -i * len
}

export const RIM_SEGMENTS_RAINBOW: RimSegment[] = Array.from({ length: RIM_RAINBOW_N }, (_, i) => ({
  color: `var(--rim-rainbow-c${i + 1})`,
  offset: offset(i, 100 / RIM_RAINBOW_N),
  delay: delay(i, RIM_RAINBOW_N)
}))

/** 站间均分 8 段过渡（j=0 即纯站），末段 11.11% c4 混 c1 回扣闭环无缝 */
function gradientColor(i: number): string {
  const station = Math.floor(i / 9)
  const a = station + 1
  const b = ((station + 1) % 4) + 1
  const j = i % 9
  if (j === 0) return `var(--rim-rainbow-c${a})`
  const mix = (100 - (j * 100) / 9).toFixed(2)
  return `color-mix(in srgb, var(--rim-rainbow-c${a}) ${mix}%, var(--rim-rainbow-c${b}))`
}

export const RIM_SEGMENTS_GRADIENT: RimSegment[] = Array.from({ length: RIM_GRADIENT_N }, (_, i) => ({
  color: gradientColor(i),
  offset: offset(i, RIM_GRADIENT_LEN),
  delay: delay(i, RIM_GRADIENT_N)
}))
