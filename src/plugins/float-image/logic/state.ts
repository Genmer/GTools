// 贴图纯逻辑：持久化状态、窗口几何计算、事件载荷解析（不依赖 DOM/Electron，node 可测）

export const MIN_WINDOW = 80
export const MAX_WINDOW = 4000
/** 页面内不透明度下限（再低就完全看不见了） */
export const MIN_OPACITY = 0.15
export const MAX_SCALE = 32
export const MIN_SCALE = 0.02
/** 首次贴图（无任何记忆）时的默认可视区上限 */
export const DEFAULT_FIT_MAX_WIDTH = 480
export const DEFAULT_FIT_MAX_HEIGHT = 400
/** 浮窗 html 总字符预算（宿主上限 200 万，留出模板余量） */
export const FLOAT_HTML_CHAR_BUDGET = 1_200_000

export interface NaturalSize {
  width: number
  height: number
}

export interface FloatImagePersist {
  v: 1
  x: number | null
  y: number | null
  /** 显示倍率 = 窗口内图宽 / 原图宽 */
  scale: number
  opacity: number
}

export const DEFAULT_PERSIST: FloatImagePersist = { v: 1, x: null, y: null, scale: 1, opacity: 1 }

export function clampWindow(n: number): number {
  if (!Number.isFinite(n)) return MIN_WINDOW
  return Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, Math.round(n)))
}

export function clampOpacity(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(1, Math.max(MIN_OPACITY, n))
}

export function clampScale(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, n))
}

function finiteInt(v: unknown, limit: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > limit) return null
  return Math.round(v)
}

export function normalizePersist(raw: unknown): FloatImagePersist {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PERSIST }
  const r = raw as Partial<FloatImagePersist>
  const x = finiteInt(r.x, 30_000)
  const y = finiteInt(r.y, 30_000)
  return {
    v: 1,
    // 拖到多屏边缘的极端坐标不记忆，防换屏后浮窗落在可视区外
    x,
    y,
    scale: clampScale(typeof r.scale === 'number' ? r.scale : 1),
    opacity: clampOpacity(typeof r.opacity === 'number' ? r.opacity : 1)
  }
}

export function isNaturalSize(n: unknown): n is NaturalSize {
  return (
    typeof n === 'object' && n !== null &&
    typeof (n as NaturalSize).width === 'number' && (n as NaturalSize).width > 0 &&
    typeof (n as NaturalSize).height === 'number' && (n as NaturalSize).height > 0
  )
}

/** 窗口尺寸 = 原图 × scale（控制条是 hover 浮层，不占窗口高度） */
export function pinWindowSize(natural: NaturalSize, scale: number): { width: number; height: number } {
  const s = clampScale(scale)
  return {
    width: clampWindow(natural.width * s),
    height: clampWindow(natural.height * s)
  }
}

/** 首次贴图时把超大图收到默认可视区内（小图保持 1:1） */
export function fitScale(natural: NaturalSize, maxW = DEFAULT_FIT_MAX_WIDTH, maxH = DEFAULT_FIT_MAX_HEIGHT): number {
  if (!isNaturalSize(natural)) return 1
  return Math.min(1, maxW / natural.width, maxH / natural.height)
}

export interface PinPlan {
  width: number
  height: number
  x?: number
  y?: number
  scale: number
  opacity: number
}

/** 新浮窗起窗方案：老用户复用上次位置/倍率/不透明度，全新状态按适配尺寸居中（x/y 缺省由宿主放光标屏中央） */
export function initialPinPlan(natural: NaturalSize, persist: FloatImagePersist): PinPlan {
  const pristine = persist.x === null && persist.y === null && persist.scale === 1
  const scale = pristine ? clampScale(fitScale(natural)) : clampScale(persist.scale)
  const size = pinWindowSize(natural, scale)
  const plan: PinPlan = { ...size, scale, opacity: clampOpacity(persist.opacity) }
  if (persist.x !== null && persist.y !== null) {
    plan.x = persist.x
    plan.y = persist.y
  }
  return plan
}

/** 滚轮/按钮缩放：payload 携带窗口当前内尺寸，等比缩放后重新夹取 */
export function applyZoom(current: { width: number; height: number }, factor: number): { width: number; height: number } {
  const f = typeof factor === 'number' && Number.isFinite(factor) && factor > 0 ? factor : 1
  return {
    width: clampWindow(clampWindow(current.width) * f),
    height: clampWindow(clampWindow(current.height) * f)
  }
}

/** 双击 / 1:1 按钮：按原图像素尺寸还原（超限由 clampWindow 截断） */
export function resetSize(natural: NaturalSize): { width: number; height: number } {
  return pinWindowSize(natural, 1)
}

export function zoomFactorFromWheelDelta(deltaY: number, step = 1.1): number {
  if (deltaY < 0) return step
  if (deltaY > 0) return 1 / step
  return 1
}

// ---- 浮窗页面回传事件载荷解析（payload: unknown，防御式校验） ----

export interface ZoomPayload {
  factor: number
  width: number
  height: number
}

export function parseZoomPayload(p: unknown): ZoomPayload | null {
  if (typeof p !== 'object' || p === null) return null
  const { factor, width, height } = p as Record<string, unknown>
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) return null
  if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) return null
  if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return null
  return { factor, width, height }
}

export function parseResetPayload(p: unknown): NaturalSize | null {
  if (typeof p !== 'object' || p === null) return null
  const { naturalWidth, naturalHeight } = p as Record<string, unknown>
  if (typeof naturalWidth !== 'number' || !Number.isFinite(naturalWidth) || naturalWidth <= 0) return null
  if (typeof naturalHeight !== 'number' || !Number.isFinite(naturalHeight) || naturalHeight <= 0) return null
  return { width: Math.round(naturalWidth), height: Math.round(naturalHeight) }
}

export interface StateReport {
  x: number
  y: number
  width: number
  height: number
  opacity?: number
}

export function parseStateReport(p: unknown): StateReport | null {
  if (typeof p !== 'object' || p === null) return null
  const r = p as Record<string, unknown>
  const x = finiteInt(r.x, 30_000)
  const y = finiteInt(r.y, 30_000)
  const width = finiteInt(r.width, MAX_WINDOW)
  const height = finiteInt(r.height, MAX_WINDOW)
  if (x === null || y === null || width === null || height === null) return null
  const report: StateReport = { x, y, width, height }
  if (typeof r.opacity === 'number' && Number.isFinite(r.opacity)) report.opacity = clampOpacity(r.opacity)
  return report
}

// ---- 图片数据工具 ----

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

export function mimeForPath(p: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(p.trim())
  if (!m) return null
  return MIME_BY_EXT[m[1].toLowerCase()] ?? null
}

export function buildDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`
}

/** 图片 dataUrl 超预算时的目标缩放倍率（字符量近似 ∝ 面积，故开根号；留 10% 余量） */
export function shrinkScaleFor(charLen: number, budget: number): number {
  if (charLen <= budget) return 1
  return Math.max(0.05, Math.sqrt((budget * 0.9) / charLen))
}
