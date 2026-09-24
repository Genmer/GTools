// 页码范围解析与文件名/大小展示工具：全部纯函数，供 index.vue 与单测共用

export interface ParseOk<T> {
  ok: true
  data: T
}
export interface ParseErr {
  ok: false
  error: string
}
export type ParseResult<T> = ParseOk<T> | ParseErr

const TOKEN_RE = /^\d+(?:\s*-\s*\d+)?$/

/** "1-3,5" → 去重升序页码（1 起始，含端点）；error 信息可直接展示给用户 */
export function parsePageRanges(input: string, pageCount: number): ParseResult<number[]> {
  const trimmed = input.trim()
  if (trimmed === '') return { ok: false, error: '请输入页码范围，如 1-3,5' }
  const pages = new Set<number>()
  for (const token of trimmed.split(',')) {
    const t = token.trim()
    if (!TOKEN_RE.test(t)) return { ok: false, error: `无法识别的页码：「${t}」` }
    const nums = t.split('-').map((s) => Number(s.trim()))
    const from = nums[0]
    const to = nums.length > 1 ? nums[1] : from
    if (to < from) return { ok: false, error: `页码范围倒置：「${t}」（应从小到大）` }
    if (from < 1) return { ok: false, error: `页码从 1 开始：「${t}」` }
    if (to > pageCount) return { ok: false, error: `页码超出范围：「${t}」（共 ${pageCount} 页）` }
    for (let p = from; p <= to; p++) pages.add(p)
  }
  return { ok: true, data: [...pages].sort((a, b) => a - b) }
}

export interface PageGroup {
  /** 输出文件名后缀用的组标签（如 "1-3"、"5"） */
  label: string
  pages: number[]
}

/** 拆分用：逗号分组，每组一段范围各自成一个输出文件；组间允许重叠（用户自担重复页） */
export function parseRangeGroups(input: string, pageCount: number): ParseResult<PageGroup[]> {
  const whole = parsePageRanges(input, pageCount)
  if (!whole.ok) return whole
  const groups: PageGroup[] = []
  for (const token of input.trim().split(',')) {
    const t = token.trim()
    const r = parsePageRanges(t, pageCount)
    if (!r.ok) return r
    groups.push({ label: t.replace(/\s+/g, ''), pages: r.data })
  }
  return { ok: true, data: groups }
}

export const LARGE_FILE_BYTES = 20 * 1024 * 1024

export function isLargeFile(size: number): boolean {
  return size > LARGE_FILE_BYTES
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** 取路径最后一段文件名（兼容 / 与 \） */
export function fileNameOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(i + 1) : path
}

/** 去目录去扩展名，作导出文件名前缀；无名文件回退原名防空串 */
export function baseName(name: string): string {
  const fileName = fileNameOf(name)
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  return base === '' ? fileName : base
}

/** 渲染层拼输出路径：无 path 模块可用面，/ 在 win 的 Node fs 也认 */
export function joinPath(dir: string, name: string): string {
  return dir.endsWith('/') || dir.endsWith('\\') ? `${dir}${name}` : `${dir}/${name}`
}

/** 角度归一到 [0, 360)，避免连续旋转后溢出 */
export function normalizeAngle(deg: number): number {
  return ((deg % 360) + 360) % 360
}
