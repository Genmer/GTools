// 剪贴板飞窗锚定几何纯函数（无 electron import，node 测试直达）。
// 边距环常数单源在 detached-window-geometry.ts（与主窗/独立窗同一环），禁在此重复定义
import { MARGIN_BOTTOM, MARGIN_TOP, MARGIN_X } from './detached-window-geometry'
import type { ClipboardPanelPosition } from '@sdk/settings'

export const FLYOUT_GAP = 6
export const PANEL_SIDE_W = 300
export const PANEL_BELOW_W = 640
export const PANEL_H_DEFAULT = 420
export const PANEL_H_MIN = 240
export const PANEL_H_MAX = 560

export interface FlyoutRect {
  x: number
  y: number
  width: number
  height: number
}

/** 主窗 OS bounds → 内容卡片口径：透明档内缩边距环，不透明恒等 */
export function contentRectOfMain(b: FlyoutRect, transparentMain: boolean): FlyoutRect {
  if (!transparentMain) return { ...b }
  return {
    x: b.x + MARGIN_X,
    y: b.y + MARGIN_TOP,
    width: b.width - MARGIN_X * 2,
    height: b.height - MARGIN_TOP - MARGIN_BOTTOM
  }
}

/** 卡片 → 飞窗 OS bounds：有环加 32/32/48 边距（外圈投影落环内），无环恒等 */
export function flyOsBounds(x: number, y: number, w: number, h: number, withMargin: boolean): FlyoutRect {
  if (!withMargin) return { x, y, width: w, height: h }
  return { x: x - MARGIN_X, y: y - MARGIN_TOP, width: w + MARGIN_X * 2, height: h + MARGIN_TOP + MARGIN_BOTTOM }
}

/** 会话级拖动偏移（用户拖头带产出，换预设归零，跨重启不持久） */
export interface FlyoutOffset {
  dx: number
  dy: number
}

/** 锚点 OS bounds + 拖动偏移 → 实际落位：整体平移后按 workArea 夹取防拖出屏，尺寸不变 */
export function applyFlyoutOffset(os: FlyoutRect, offset: FlyoutOffset, workArea: FlyoutRect): FlyoutRect {
  // 窄于工作区的退化屏（面板比 wa 宽）上下界会倒挂，min/max 归位保证 clamp 恒有效
  const xLo = Math.min(workArea.x, workArea.x + workArea.width - os.width)
  const xHi = Math.max(workArea.x, workArea.x + workArea.width - os.width)
  const yLo = Math.min(workArea.y, workArea.y + workArea.height - os.height)
  const yHi = Math.max(workArea.y, workArea.y + workArea.height - os.height)
  return {
    ...os,
    x: clamp(Math.round(os.x + offset.dx), xLo, xHi),
    y: clamp(Math.round(os.y + offset.dy), yLo, yHi)
  }
}

export interface AnchorFlyoutInput {
  mainBounds: FlyoutRect
  transparentMain: boolean
  withMargin: boolean
  /** 缺省 'all' 四周全环；'exceptFacingMain' 贴主窗一侧不留环（透明环吞点击时的变体） */
  marginPolicy?: 'all' | 'exceptFacingMain'
  position: Exclude<ClipboardPanelPosition, 'off'>
  panelH: number
  workArea: FlyoutRect
}

export interface AnchorFlyoutResult {
  side: Exclude<ClipboardPanelPosition, 'off'>
  card: FlyoutRect
  os: FlyoutRect
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi)
}

function osWithPolicy(card: FlyoutRect, side: 'left' | 'right', withMargin: boolean, policy: 'all' | 'exceptFacingMain'): FlyoutRect {
  if (!withMargin) return { ...card }
  if (policy === 'all') return flyOsBounds(card.x, card.y, card.width, card.height, true)
  // 贴主窗一侧环厚压到贴缝 GAP，其余三侧维持全环（投影仍可见，主窗右缘不再被环覆盖）
  switch (side) {
    case 'right':
      return { x: card.x - FLYOUT_GAP, y: card.y - MARGIN_TOP, width: card.width + FLYOUT_GAP + MARGIN_X, height: card.height + MARGIN_TOP + MARGIN_BOTTOM }
    case 'left':
      return { x: card.x - MARGIN_X, y: card.y - MARGIN_TOP, width: card.width + MARGIN_X + FLYOUT_GAP, height: card.height + MARGIN_TOP + MARGIN_BOTTOM }
  }
}

/** below 卡 → OS bounds：环贴主窗一侧压 GAP（正挂在上缘、翻转到下方），其余侧全环 */
function belowOsBounds(card: FlyoutRect, flipped: boolean, withMargin: boolean, policy: 'all' | 'exceptFacingMain'): FlyoutRect {
  if (!withMargin) return { ...card }
  if (policy === 'all') return flyOsBounds(card.x, card.y, card.width, card.height, true)
  return flipped
    ? { x: card.x - MARGIN_X, y: card.y - MARGIN_TOP, width: card.width + MARGIN_X * 2, height: card.height + MARGIN_TOP + FLYOUT_GAP }
    : { x: card.x - MARGIN_X, y: card.y - FLYOUT_GAP, width: card.width + MARGIN_X * 2, height: card.height + FLYOUT_GAP + MARGIN_BOTTOM }
}

/** 锚定：left/right 贴内容缘 6px 顶对齐、越界换边、双败硬 clamp；below 锚主窗内容底缘外缝（窗外侧、
 *  不与主窗重叠），下方不足整板翻到主窗上方，双败硬 clamp 钉工作区底（无窗内叠压回退） */
export function anchorFlyout(input: AnchorFlyoutInput): AnchorFlyoutResult {
  const policy = input.marginPolicy ?? 'all'
  const content = contentRectOfMain(input.mainBounds, input.transparentMain)
  const wa = input.workArea

  if (input.position === 'below') {
    const w = Math.min(PANEL_BELOW_W, wa.width)
    const x = clamp(Math.round(content.x + (content.width - w) / 2), wa.x, wa.x + wa.width - w)
    const h = clamp(input.panelH, PANEL_H_MIN, PANEL_H_MAX)
    const belowY = content.y + content.height + FLYOUT_GAP
    const spaceBelow = wa.y + wa.height - belowY
    const aboveY = content.y - FLYOUT_GAP - h
    let y: number
    let height: number
    let flipped: boolean
    if (spaceBelow >= PANEL_H_MIN) {
      y = belowY
      height = Math.min(h, spaceBelow)
      flipped = false
    } else if (aboveY >= wa.y) {
      y = aboveY
      height = h
      flipped = true
    } else {
      y = wa.y + wa.height - PANEL_H_MIN
      height = PANEL_H_MIN
      flipped = false
    }
    const card: FlyoutRect = { x, y, width: w, height }
    return { side: 'below', card, os: belowOsBounds(card, flipped, input.withMargin, policy) }
  }

  const h = clamp(Math.min(input.panelH, content.height), PANEL_H_MIN, PANEL_H_MAX)
  const y = clamp(content.y, wa.y, wa.y + wa.height - h)
  // 双向换边：先落请求方位，越 wa 界换对侧，双败硬 clamp 回请求方位
  const rightX = content.x + content.width + FLYOUT_GAP
  const leftX = content.x - FLYOUT_GAP - PANEL_SIDE_W
  const waRight = wa.x + wa.width
  const fitsRight = rightX + PANEL_SIDE_W <= waRight
  const fitsLeft = leftX >= wa.x
  let side: 'left' | 'right' = input.position
  let x: number
  if (side === 'right') {
    if (fitsRight) x = rightX
    else if (fitsLeft) {
      side = 'left'
      x = leftX
    } else x = clamp(rightX, wa.x, waRight - PANEL_SIDE_W)
  } else {
    if (fitsLeft) x = leftX
    else if (fitsRight) {
      side = 'right'
      x = rightX
    } else x = clamp(leftX, wa.x, waRight - PANEL_SIDE_W)
  }
  const card: FlyoutRect = { x, y, width: PANEL_SIDE_W, height: h }
  return { side, card, os: osWithPolicy(card, side, input.withMargin, policy) }
}
