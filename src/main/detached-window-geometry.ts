// 独立窗 OS 口径换算纯函数：window.ts 顶层 import electron，node 测试进不去才抽出到此。
// MARGIN 与 base.css 的 html[data-wintx='1'] #app padding 必须一致，两处手改需同步
export const MARGIN_X = 32
export const MARGIN_TOP = 32
export const MARGIN_BOTTOM = 48

// 独立窗内容下限单源：OS 级 min 加满边距推导，保证 360×240 内容口径不缩水
export const DETACHED_MIN_W = 360
export const DETACHED_MIN_H = 240

/** darwin 零改动门控：恒透明但不给边距环，维持现状几何（交通灯不悬空、维持无阴影现状） */
export function wantsDetachedMargin(transparent: boolean, platform: string): boolean {
  return transparent && platform !== 'darwin'
}

export interface DetachedWindowBounds {
  width: number
  height: number
  x: number
  y: number
  minWidth: number
  minHeight: number
}

/** manager opts 是内容口径（期望内容尺寸/位置，测试锁定），本函数是 OS 窗口口径适配层：
 *  无环恒等返回（不透明窗 + darwin 逐字节同现状）；有环加边距并把原点外移，内容仍落期望位置 */
export function detachedWindowBounds(
  opts: { width: number; height: number; x: number; y: number },
  withMargin: boolean
): DetachedWindowBounds {
  if (!withMargin) {
    return {
      width: opts.width,
      height: opts.height,
      x: opts.x,
      y: opts.y,
      minWidth: DETACHED_MIN_W,
      minHeight: DETACHED_MIN_H
    }
  }
  return {
    width: Math.round(opts.width + MARGIN_X * 2),
    height: Math.round(opts.height + MARGIN_TOP + MARGIN_BOTTOM),
    x: Math.round(opts.x - MARGIN_X),
    y: Math.round(opts.y - MARGIN_TOP),
    minWidth: DETACHED_MIN_W + MARGIN_X * 2,
    minHeight: DETACHED_MIN_H + MARGIN_TOP + MARGIN_BOTTOM
  }
}
