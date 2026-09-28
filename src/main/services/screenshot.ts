import type { ScreenshotRect, ScreenshotResult } from '@sdk/api'

/** 抓到的冻结帧（物理像素），裁剪/展示由实现封装 */
export interface CapturedFrame {
  width: number
  height: number
  /** 物理像素矩形裁剪，返回 PNG buffer */
  crop(rect: { x: number; y: number; width: number; height: number }): { png: Buffer; width: number; height: number }
  /** 近全黑帧判定（DRM/独占全屏偶发黑帧，重试一次仍黑才报错） */
  isBlank(): boolean
  toJpegDataUrl(quality: number): string
}

export interface OverlayHandle {
  webContentsId: number
  show(): void
  focus(): void
  destroy(): void
  isDestroyed(): boolean
  injectImage(dataUrl: string): Promise<void>
  onClosed(cb: () => void): void
}

export interface ScreenshotDeps {
  hideLauncher(): void
  /** 光标所在显示器（v1 只截这块屏；id 用于 desktopCapturer display_id 匹配） */
  getTargetDisplay(): { id: string; x: number; y: number; width: number; height: number; scaleFactor: number }
  capture(display: { id: string; width: number; height: number; scaleFactor: number }): Promise<CapturedFrame | null>
  createOverlay(bounds: { x: number; y: number; width: number; height: number }, url: string): OverlayHandle
  writeClipboardImage(pngDataUrl: string): Promise<void>
  askSavePath(defaultName: string): Promise<string | null>
  writeFileBase64(path: string, base64: string): Promise<void>
  sleep(ms: number): Promise<void>
  now(): number
}

export interface ScreenshotService {
  capture(): Promise<ScreenshotResult>
  /** ipc 层负责 sender===遮罩窗校验后透传 */
  handleOverlayEvent(payload: unknown): void
  overlayWebContentsId(): number | null
}

/** 拖拽方向归一（负宽高转正）+ 钳制到帧界 + 最小 2px（DIP 入参，返回 DIP） */
export function normalizeRect(r: ScreenshotRect, maxW: number, maxH: number): ScreenshotRect {
  const x0 = Math.round(Math.min(r.x, r.x + r.width))
  const y0 = Math.round(Math.min(r.y, r.y + r.height))
  const w0 = Math.max(2, Math.round(Math.abs(r.width)))
  const h0 = Math.max(2, Math.round(Math.abs(r.height)))
  const x = Math.max(0, Math.min(x0, maxW - 2))
  const y = Math.max(0, Math.min(y0, maxH - 2))
  return { x, y, width: Math.max(2, Math.min(w0, maxW - x)), height: Math.max(2, Math.min(h0, maxH - y)) }
}

/** DIP 选区 → 物理像素矩形（含 scale 与帧界钳制） */
export function physicalRect(r: ScreenshotRect, scaleFactor: number, frameW: number, frameH: number): { x: number; y: number; width: number; height: number } {
  const n = normalizeRect(r, frameW / scaleFactor, frameH / scaleFactor)
  const x = Math.max(0, Math.min(Math.round(n.x * scaleFactor), frameW - 2))
  const y = Math.max(0, Math.min(Math.round(n.y * scaleFactor), frameH - 2))
  return {
    x,
    y,
    width: Math.max(2, Math.min(Math.round(n.width * scaleFactor), frameW - x)),
    height: Math.max(2, Math.min(Math.round(n.height * scaleFactor), frameH - y))
  }
}

/** 遮罩页原始 HTML（独立 data:URL 页面，themes.css 够不到，颜色在此处自洽） */
export function buildOverlayHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;overflow:hidden;background:#000;cursor:crosshair;user-select:none;-webkit-user-select:none}
  #shot{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none}
  #sel{position:fixed;display:none;border:1.5px solid #3b82f6;box-shadow:0 0 0 100000px rgba(0,0,0,0.32);z-index:2}
  #label{position:fixed;display:none;z-index:4;background:rgba(17,24,39,0.92);color:#fff;font:12px/1 system-ui;padding:3px 8px;border-radius:4px;pointer-events:none}
  #bar{position:fixed;display:none;z-index:5;background:rgba(17,24,39,0.95);border-radius:8px;padding:6px;gap:6px}
  #bar button{all:unset;cursor:pointer;color:#fff;font:13px system-ui;padding:6px 14px;border-radius:6px;background:rgba(255,255,255,0.12)}
  #bar button:hover{background:rgba(255,255,255,0.24)}
  #bar button.primary{background:#3b82f6}
  #bar button.primary:hover{background:#2563eb}
</style>
</head>
<body>
<img id="shot" alt="">
<div id="sel"></div>
<div id="label"></div>
<div id="bar">
  <button class="primary" id="bCopy">复制</button>
  <button id="bSave">另存</button>
  <button id="bCancel">取消</button>
</div>
<script>
  var sel = { x: 0, y: 0, w: 0, h: 0 }
  var drag = null
  function emit(type, extra) {
    var p = Object.assign({ type: type }, extra || {})
    window.gtools.host('screenshot:overlay-event', p)
  }
  function rect() { return { x: Math.min(sel.x, sel.x + sel.w), y: Math.min(sel.y, sel.y + sel.h), width: Math.abs(sel.w), height: Math.abs(sel.h) } }
  function drawSel() {
    var r = rect()
    var el = document.getElementById('sel')
    el.style.display = 'block'
    el.style.left = r.x + 'px'; el.style.top = r.y + 'px'
    el.style.width = r.width + 'px'; el.style.height = r.height + 'px'
    var lb = document.getElementById('label')
    lb.style.display = 'block'
    lb.textContent = r.width + ' × ' + r.height
    lb.style.left = r.x + 'px'
    lb.style.top = (r.y > 24 ? r.y - 22 : r.y + r.height + 6) + 'px'
  }
  function showBar() {
    var r = rect(); var bar = document.getElementById('bar')
    bar.style.display = 'flex'
    var bw = 200, bh = 44
    var bx = Math.min(Math.max(4, r.x + r.width - bw), window.innerWidth - bw - 4)
    var by = r.y + r.height + 8
    if (by + bh > window.innerHeight - 4) by = Math.max(4, r.y - bh - 8)
    bar.style.left = bx + 'px'; bar.style.top = by + 'px'
  }
  function hideBar() { document.getElementById('bar').style.display = 'none' }
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return
    hideBar()
    drag = { x: e.clientX, y: e.clientY }
    sel.x = e.clientX; sel.y = e.clientY; sel.w = 0; sel.h = 0
  })
  document.addEventListener('mousemove', function (e) {
    if (!drag) return
    sel.w = e.clientX - sel.x; sel.h = e.clientY - sel.y
    drawSel()
  })
  document.addEventListener('mouseup', function (e) {
    if (!drag) return
    drag = null
    if (Math.abs(sel.w) < 6 || Math.abs(sel.h) < 6) { cancelSel() } else { showBar() }
  })
  function cancelSel() {
    sel.w = 0; sel.h = 0
    document.getElementById('sel').style.display = 'none'
    document.getElementById('label').style.display = 'none'
    hideBar()
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { emit('cancel') }
    else if (e.key === 'Enter') {
      var r = sel.w === 0 ? { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight } : rect()
      emit('confirm', { rect: r, mode: 'copy' })
    }
  })
  document.addEventListener('dblclick', function () {
    emit('confirm', { rect: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }, mode: 'copy' })
  })
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); emit('cancel') })
  document.getElementById('bCopy').addEventListener('click', function () { emit('confirm', { rect: rect(), mode: 'copy' }) })
  document.getElementById('bSave').addEventListener('click', function () { emit('confirm', { rect: rect(), mode: 'save' }) })
  document.getElementById('bCancel').addEventListener('click', function () { emit('cancel') })
  window.__gtShot = function (dataUrl) { document.getElementById('shot').src = dataUrl }
</script>
</body>
</html>`
}

export function overlayDataUrl(): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(buildOverlayHtml())
}

interface Pending {
  resolve(r: ScreenshotResult): void
  reject(e: Error): void
  overlay: OverlayHandle
  frame: CapturedFrame
  display: { scaleFactor: number }
}

export function createScreenshotService(deps: ScreenshotDeps): ScreenshotService {
  let pending: Pending | null = null

  const destroyOverlay = (o: OverlayHandle): void => {
    if (!o.isDestroyed()) o.destroy()
  }

  const finish = (r: ScreenshotResult): void => {
    const p = pending
    if (!p) return
    pending = null
    destroyOverlay(p.overlay)
    p.resolve(r)
  }

  const fail = (e: Error): void => {
    const p = pending
    if (!p) return
    pending = null
    destroyOverlay(p.overlay)
    p.reject(e)
  }

  const grabFrame = async (display: ReturnType<ScreenshotDeps['getTargetDisplay']>): Promise<CapturedFrame> => {
    let f = await deps.capture(display)
    if (!f || f.isBlank()) {
      // 黑帧（DRM/DXGI 偶发）重试一次再判
      await deps.sleep(300)
      f = await deps.capture(display)
    }
    if (!f || f.isBlank()) throw new Error('屏幕捕获失败（画面不可读或受保护内容全屏）')
    return f
  }

  const capture = async (): Promise<ScreenshotResult> => {
    if (pending) throw new Error('已有截图正在进行，请先完成或取消')
    // 先藏启动器再抓屏，等待 DWM 重合成（否则启动器会出现在冻结帧里）；
    // 显示器只快照一次，抓帧与遮罩窗必须同源（中途跨屏会错位）
    deps.hideLauncher()
    await deps.sleep(160)
    const display = deps.getTargetDisplay()
    const frame = await grabFrame(display)
    const overlay = deps.createOverlay(
      { x: display.x, y: display.y, width: display.width, height: display.height },
      overlayDataUrl()
    )
    return new Promise<ScreenshotResult>((resolve, reject) => {
      pending = { resolve, reject, overlay, frame, display }
      overlay.onClosed(() => { if (pending && pending.overlay === overlay) finish({ action: 'cancel' }) })
      const inject = async (): Promise<void> => {
        await overlay.injectImage(frame.toJpegDataUrl(85))
        if (!overlay.isDestroyed()) {
          overlay.show()
          overlay.focus()
        }
      }
      void inject().catch((e) => fail(e instanceof Error ? e : new Error(String(e))))
    })
  }

  const handleOverlayEvent = (payload: unknown): void => {
    const p = pending
    if (!p) return
    const d = (payload ?? {}) as { type?: string; rect?: ScreenshotRect; mode?: string }
    if (d.type === 'cancel') {
      finish({ action: 'cancel' })
      return
    }
    if (d.type !== 'confirm' || !d.rect || (d.mode !== 'copy' && d.mode !== 'save')) return
    const r = physicalRect(d.rect, p.display.scaleFactor, p.frame.width, p.frame.height)
    const { png } = p.frame.crop(r)
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`
    const done = (action: 'copy' | 'save', savedPath?: string): void => {
      finish({ action, dataUrl, width: r.width, height: r.height, savedPath })
    }
    void (async () => {
      try {
        if (d.mode === 'copy') {
          await deps.writeClipboardImage(dataUrl)
          done('copy')
        } else {
          const t = new Date(deps.now())
          const pad = (n: number): string => String(n).padStart(2, '0')
          const name = `截图_${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.png`
          const path = await deps.askSavePath(name)
          if (!path) {
            finish({ action: 'cancel' })
            return
          }
          await deps.writeFileBase64(path, png.toString('base64'))
          done('save', path)
        }
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)))
      }
    })()
  }

  return {
    capture,
    handleOverlayEvent,
    overlayWebContentsId: () => (pending && !pending.overlay.isDestroyed() ? pending.overlay.webContentsId : null)
  }
}
