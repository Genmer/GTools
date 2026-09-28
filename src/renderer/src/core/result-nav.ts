export interface NavSection {
  /** 该区在扁平索引中的起始下标 */
  start: number
  count: number
  cols: number
}

/**
 * 分区扁平网格导航一步：x 在区内循环；y 先同区 ±cols，越界按列对齐跨入相邻区（列号夹紧到目标区
 * 行数），无相邻区则夹紧到本区末/首——与单区旧实现（±1/±9/边界夹紧）逐位一致，供回归单测锁定。
 * 主结果区+推荐区、空态「剪贴板行+最近行」合并前缀段共用此数学。
 */
export function navStep(index: number, sections: NavSection[], dir: 1 | -1, axis: 'x' | 'y'): number {
  const sec = sections.find((s) => index >= s.start && index < s.start + s.count)
  if (!sec) return index
  const cols = Math.max(1, sec.cols)
  const local = index - sec.start
  if (axis === 'x') {
    return sec.start + ((((local + dir) % sec.count) + sec.count) % sec.count)
  }
  const t = local + dir * cols
  if (t >= 0 && t < sec.count) return sec.start + t
  const adjacent = sections[sections.indexOf(sec) + dir]
  if (adjacent !== undefined && adjacent.count > 0) {
    const col = ((local % cols) + cols) % cols
    return adjacent.start + Math.min(col, adjacent.count - 1)
  }
  if (dir === 1) return index < sec.start + sec.count - 1 ? sec.start + sec.count - 1 : index
  return index > sec.start ? sec.start : index
}
