/** 主窗唤起位置决策（纯逻辑，无 electron 依赖，可单测） */
export interface DisplayArea {
  bounds: { x: number; y: number; width: number; height: number }
  workArea: { x: number; y: number; width: number; height: number }
}

/** 记忆位置仅在窗口主体仍落在光标所在屏内时沿用（uTools 式跟随鼠标屏），
 *  否则光标屏工作区居中偏上；光标不在任何屏内（屏间隙）取中心最近的屏 */
export function decideShowPosition(
  remembered: { x: number; y: number } | null,
  cursor: { x: number; y: number },
  displays: DisplayArea[],
  windowSize: { width: number; height: number }
): { x: number; y: number } {
  if (displays.length === 0) return { x: cursor.x, y: cursor.y }
  const inside = (d: DisplayArea, x: number, y: number): boolean =>
    x >= d.bounds.x && x < d.bounds.x + d.bounds.width && y >= d.bounds.y && y < d.bounds.y + d.bounds.height
  let target = displays.find((d) => inside(d, cursor.x, cursor.y))
  if (target === undefined) {
    const centerDist = (d: DisplayArea): number => {
      const cx = d.bounds.x + d.bounds.width / 2
      const cy = d.bounds.y + d.bounds.height / 2
      return (cx - cursor.x) ** 2 + (cy - cursor.y) ** 2
    }
    let best = displays[0]
    for (const d of displays) if (centerDist(d) < centerDist(best)) best = d
    target = best
  }
  if (remembered !== null && inside(target, remembered.x + windowSize.width / 2, remembered.y + windowSize.height / 2)) {
    return { x: Math.round(remembered.x), y: Math.round(remembered.y) }
  }
  return {
    x: Math.round(target.workArea.x + (target.workArea.width - windowSize.width) / 2),
    y: Math.round(target.workArea.y + target.workArea.height * 0.28)
  }
}

/** 主窗插件态自绘拉伸手柄的目标尺寸：锚定左上角，夹到最小尺寸与工作区内最大（纯逻辑可单测） */
export function applyResizeDelta(
  current: { width: number; height: number },
  minSize: { width: number; height: number },
  max: { width: number; height: number },
  dw: number,
  dh: number
): { width: number; height: number } {
  const width = Math.round(Math.min(max.width, Math.max(minSize.width, current.width + dw)))
  const height = Math.round(Math.min(max.height, Math.max(minSize.height, current.height + dh)))
  return { width, height }
}
