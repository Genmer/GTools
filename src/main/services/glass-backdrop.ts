/**
 * 玻璃主题实时背景：desktopCapturer 抓窗口背后的真实屏幕内容供页内位移折射。
 * 壁纸方案只是静态近似（窗口悬在其他应用上时穿帮），此服务抓「真背后」：
 * 主窗在玻璃主题下设 contentProtection（WDA_EXCLUDEFROMCAPTURE，Win11 实测捕获绕开自身窗），
 * 抓整屏 → 裁窗口区域 → 编码 JPEG 下发渲染层铺折射源。抓取失败由渲染层回退壁纸桥。
 */

export interface BackdropRect {
  x: number
  y: number
  width: number
  height: number
}

/** 窗口 DIP bounds → 所在显示器上的物理像素裁剪区；inset 内缩躲自身系统投影残影；与屏幕无交集返回 null */
export function computeCropRect(opts: {
  winBounds: { x: number; y: number; width: number; height: number }
  displayBounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  inset?: number
}): BackdropRect | null {
  const { winBounds, displayBounds, scaleFactor } = opts
  const inset = opts.inset ?? 0
  const screenW = displayBounds.width * scaleFactor
  const screenH = displayBounds.height * scaleFactor
  if (screenW <= 1 || screenH <= 1) return null
  const x = Math.round((winBounds.x - displayBounds.x + inset) * scaleFactor)
  const y = Math.round((winBounds.y - displayBounds.y + inset) * scaleFactor)
  const width = Math.round((winBounds.width - inset * 2) * scaleFactor)
  const height = Math.round((winBounds.height - inset * 2) * scaleFactor)
  // 与屏幕矩形求交集：窗口跨屏/完全离屏时得到真实的可见部分
  const left = Math.max(0, Math.min(x, screenW))
  const right = Math.max(0, Math.min(x + width, screenW))
  const top = Math.max(0, Math.min(y, screenH))
  const bottom = Math.max(0, Math.min(y + height, screenH))
  if (right - left < 1 || bottom - top < 1) return null
  return { x: left, y: top, width: Math.round(right - left), height: Math.round(bottom - top) }
}

/** 捕获产物最小接口（主进程适配 nativeImage，测试用假件；toJPEG 与 NativeImage 同名保持结构相容） */
export interface BackdropImageLike {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  crop(rect: BackdropRect): BackdropImageLike
  resize(size: { width: number; height: number }): BackdropImageLike
  toJPEG(quality: number): Buffer
}

export interface BackdropPayload {
  dataUrl: string
  width: number
  height: number
}

export interface BackdropContext {
  winBounds: { x: number; y: number; width: number; height: number }
  displayBounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  /** 编码目标尺寸（窗口 DIP） */
  dipSize: { width: number; height: number }
  /** 整屏捕获尺寸（显示器物理像素） */
  captureSize: { width: number; height: number }
}

export interface GlassBackdropDeps {
  isGlass(): boolean
  isWinVisible(): boolean
  snapshotContext(): BackdropContext | null
  captureScreen(size: { width: number; height: number }): Promise<BackdropImageLike | null>
  encode(img: BackdropImageLike, rect: BackdropRect, dip: { width: number; height: number }): BackdropPayload | null
  broadcast(payload: BackdropPayload | { dataUrl: null }): void
  now?(): number
  /** 同屏快速事件流（move/resize）的最小推送间隔 */
  minIntervalMs?: number
}

export function createGlassBackdropService(deps: GlassBackdropDeps) {
  let pending = false
  let last: BackdropPayload | null = null
  let lastAt = -Infinity

  /** 抓一次并推送；玻璃关/窗隐藏/在帧中/最小间隔内静默跳过 */
  async function capture(force = false): Promise<void> {
    if (!deps.isGlass() || !deps.isWinVisible() || pending) return
    const now = deps.now?.() ?? Date.now()
    if (!force && now - lastAt < (deps.minIntervalMs ?? 250)) return
    const ctx = deps.snapshotContext()
    if (!ctx) return
    pending = true
    try {
      const img = await deps.captureScreen(ctx.captureSize)
      if (!img || img.isEmpty()) return
      const rect = computeCropRect({ winBounds: ctx.winBounds, displayBounds: ctx.displayBounds, scaleFactor: ctx.scaleFactor, inset: 2 })
      if (!rect) return
      const payload = deps.encode(img, rect, ctx.dipSize)
      if (!payload) return
      last = payload
      lastAt = now
      deps.broadcast(payload)
    } finally {
      pending = false
    }
  }

  /** 离开玻璃主题：停用并通知渲染层回退壁纸桥 */
  function clear(): void {
    last = null
    deps.broadcast({ dataUrl: null })
  }

  function current(): BackdropPayload | null {
    return last
  }

  return { capture, clear, current }
}
