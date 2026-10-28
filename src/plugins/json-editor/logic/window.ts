// 可视窗口裁剪（行号槽虚拟滚动共用）：start/end 为行下标区间 [start, end)，含 overscan 缓冲
export function windowRange(
  totalRows: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 8
): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight)
  const start = Math.min(totalRows, Math.max(0, first - overscan))
  const end = Math.min(totalRows, first + visible + overscan)
  return { start, end: Math.max(start, end) }
}
