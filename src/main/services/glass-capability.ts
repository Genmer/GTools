/** 玻璃折射能力分级（L2=SVG 位移折射 / L1=纯 blur）。
 *  backdrop 里的 SVG feImage+feDisplacementMap 依 Chromium 版本而异（本机 44.4.5 实测：
 *  filter 元素必须解析期静态存在——脚本 createElementNS 创建的 filter 作 url() 引用目标恒渲染空白），
 *  故滤镜本体静态放 index.html，启动像素探针仲裁：不通过/软件合成/崩溃过一次一律落 L1，视觉只差折射不跳变 */

export interface BitmapView {
  width: number
  height: number
  /** BGRA 像素（NativeImage.toBitmap），stride = width*4 */
  data: Uint8Array
}

/** 探针滤镜链把 backdrop 输出的白条纹染成绿（黑条纹保持黑）：生效 ≈50% 绿，失效/空白 = 0%。
 *  判别阈值取 0.25（两者中点，防条纹相位/圆角裁剪的轻微亏损误判） */
export function analyzeBackdropProbe(bmp: BitmapView): boolean {
  const total = bmp.width * bmp.height
  if (total <= 0) return false
  let green = 0
  const limit = Math.min(bmp.data.length, total * 4)
  for (let i = 0; i + 3 < limit; i += 4) {
    // BGRA：G 位为 1、R/B 位为 0
    if (bmp.data[i] < 80 && bmp.data[i + 1] > 180 && bmp.data[i + 2] < 80) green++
  }
  return green / total >= 0.25
}

/** 页内注入条纹背景 + 引用静态探针滤镜 #gt-lens-probe-f（index.html 解析期创建）的宿主件，
 *  返回其几何（JSON 字符串，失败空串）。只许注入引用元素，不许运行时创建 <filter>（见文件头实测结论）；
 *  滤镜链任一环失效 → 宿主面无绿 → 判负落 L1 */
export function buildLensProbeScript(): string {
  return `(function(){
  try {
    var host = document.getElementById('gt-lens-probe')
    if (!host) {
      host = document.createElement('div')
      host.id = 'gt-lens-probe'
      // z-index 拉满：左上角被胶囊（.topbar z=100）叠盖会吃掉探针面积，绿占比跌破阈值造成假阴性
      host.style.cssText = 'position:fixed;left:0;top:0;width:64px;height:64px;background:repeating-linear-gradient(45deg,#000 0 4px,#fff 4px 8px);pointer-events:none;z-index:2147483647;'
      var el = document.createElement('div')
      el.style.cssText = 'position:absolute;inset:0;backdrop-filter:url(#gt-lens-probe-f);-webkit-backdrop-filter:url(#gt-lens-probe-f);'
      host.appendChild(el)
      document.body.appendChild(host)
    }
    var r = host.getBoundingClientRect()
    return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height, dpr: window.devicePixelRatio || 1 })
  } catch (e) {
    return ''
  }
})()`
}

export function removeLensProbeScript(): string {
  return `(function(){
  try {
    var h = document.getElementById('gt-lens-probe')
    if (h) h.remove()
    return 'ok'
  } catch (e) { return '' }
})()`
}

export type ProbeOutcome = 'pass' | 'fail' | 'skip'

const PROBE_SETTLE_MS = 150

export function createGlassCapability(deps: {
  /** app.getGPUFeatureStatus()['gpu_compositing']；undefined = 未知放行走探针 */
  getGpuCompositing: () => string | undefined
  executeInPage: <W>(win: W, script: string) => Promise<string | null>
  captureRect: <W>(
    win: W,
    rect: { x: number; y: number; width: number; height: number },
    dpr: number
  ) => Promise<BitmapView | null>
  applyLensFlag: <W>(win: W, on: boolean) => void
  delay: (ms: number) => Promise<void>
  /** 探针取证完摘除页内宿主件（左上角条纹块常驻会污染玻璃画面），缺省不摘 */
  removeInPage?: <W>(win: W) => Promise<unknown>
  log?: (msg: string) => void
}) {
  let lensActive = false
  let downgraded = false
  let probing = false

  async function probe<W>(win: W): Promise<ProbeOutcome> {
    if (downgraded || probing || lensActive) return 'skip'
    const gpu = deps.getGpuCompositing()
    if (gpu !== undefined && gpu !== 'enabled') {
      deps.log?.(`L1：GPU 合成不可用（gpu_compositing=${gpu}），折射退化为纯 blur`)
      return 'skip'
    }
    probing = true
    try {
      const raw = await deps.executeInPage(win, buildLensProbeScript())
      if (!raw) return 'fail'
      let rect: { x: number; y: number; width: number; height: number; dpr: number }
      try {
        rect = JSON.parse(raw)
      } catch {
        return 'fail'
      }
      if (!(rect.width > 0 && rect.height > 0)) return 'fail'
      await deps.delay(PROBE_SETTLE_MS) // 等合成器把带滤镜的帧画出来
      const bmp = await deps.captureRect(win, rect, rect.dpr || 1)
      const ok = bmp !== null && analyzeBackdropProbe(bmp)
      lensActive = ok
      deps.applyLensFlag(win, ok)
      deps.log?.(ok ? 'L2：折射探针通过' : 'L1：折射探针未通过，退化为纯 blur')
      return ok ? 'pass' : 'fail'
    } finally {
      probing = false
      // 通过与否都摘：条纹宿主是取证件，留在玻璃页上就是常驻画面污染
      await deps.removeInPage?.(win).catch(() => undefined)
    }
  }

  /** 崩溃过一次即本会话永久降 L1（防崩溃循环）；返回 true 表示调用方应 reload 页面 */
  function handleRenderProcessGone(): boolean {
    if (!lensActive) return false
    lensActive = false
    downgraded = true
    return true
  }

  return {
    probe,
    handleRenderProcessGone,
    applyFlag: <W>(win: W, on: boolean): void => deps.applyLensFlag(win, on),
    state: (): { lensActive: boolean; downgraded: boolean } => ({ lensActive, downgraded })
  }
}
