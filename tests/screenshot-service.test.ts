import { describe, expect, it } from 'vitest'
import type { ScreenshotResult } from '@sdk/api'
import {
  buildOverlayHtml,
  createScreenshotService,
  normalizeRect,
  physicalRect,
  type CapturedFrame,
  type OverlayHandle,
  type ScreenshotDeps
} from '../src/main/services/screenshot'

function fakeFrame(w: number, h: number, blank = false): CapturedFrame & { crops: Array<{ x: number; y: number; width: number; height: number }> } {
  const crops: Array<{ x: number; y: number; width: number; height: number }> = []
  return {
    width: w,
    height: h,
    crops,
    crop: (r) => {
      crops.push({ ...r })
      return { png: Buffer.from([0x89, 0x50, 0x4e, 0x47]), width: r.width, height: r.height }
    },
    isBlank: () => blank,
    toJpegDataUrl: () => 'data:image/jpeg;base64,QUJD'
  }
}

function fakeOverlay(id = 77): OverlayHandle & { closedCb: (() => void) | null; injected: string[]; destroyed: boolean; shown: number } {
  const o = {
    webContentsId: id,
    closedCb: null as (() => void) | null,
    injected: [] as string[],
    destroyed: false,
    shown: 0,
    show() {
      o.shown++
    },
    focus() {},
    destroy() {
      if (o.destroyed) return
      o.destroyed = true
      o.closedCb?.()
    },
    isDestroyed: () => o.destroyed,
    async injectImage(dataUrl: string) {
      o.injected.push(dataUrl)
    },
    onClosed(cb: () => void) {
      o.closedCb = cb
    }
  }
  return o
}

function makeDeps(opts: {
  frames: Array<CapturedFrame | null>
  overlay: OverlayHandle
  savePath?: string | null
}): ScreenshotDeps & { hidden: number; bounds: unknown; url: string; clip: string[]; writes: Array<{ p: string; b: string }> } {
  const d = {
    hidden: 0,
    bounds: null as unknown,
    url: '',
    clip: [] as string[],
    writes: [] as Array<{ p: string; b: string }>,
    hideLauncher: () => {
      d.hidden++
    },
    getTargetDisplay: () => ({ id: '1', x: 0, y: 0, width: 1000, height: 800, scaleFactor: 2 }),
    capture: async () => opts.frames.length > 1 ? (opts.frames.shift() as CapturedFrame | null) : opts.frames[0],
    createOverlay: (bounds: { x: number; y: number; width: number; height: number }, url: string) => {
      d.bounds = bounds
      d.url = url
      return opts.overlay
    },
    writeClipboardImage: async (dataUrl: string) => {
      d.clip.push(dataUrl)
    },
    askSavePath: async () => opts.savePath === undefined ? null : opts.savePath,
    writeFileBase64: async (p: string, b: string) => {
      d.writes.push({ p, b })
    },
    sleep: async () => {},
    now: () => 1727400000000
  }
  return d
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('normalizeRect / physicalRect 几何', () => {
  it('拖拽方向归一：反向拖（负宽高）转正', () => {
    expect(normalizeRect({ x: 100, y: 100, width: -50, height: -40 }, 1000, 800)).toEqual({ x: 50, y: 60, width: 50, height: 40 })
  })
  it('钳制到屏幕界且最小 2px', () => {
    expect(normalizeRect({ x: 990, y: 790, width: 500, height: 500 }, 1000, 800)).toEqual({ x: 990, y: 790, width: 10, height: 10 })
    expect(normalizeRect({ x: 0, y: 0, width: 1, height: 1 }, 1000, 800)).toEqual({ x: 0, y: 0, width: 2, height: 2 })
  })
  it('physicalRect：DIP×scaleFactor + 帧界钳制', () => {
    expect(physicalRect({ x: 10, y: 20, width: 30, height: 40 }, 2, 2000, 1600)).toEqual({ x: 20, y: 40, width: 60, height: 80 })
    // 越界选区钳到帧边
    expect(physicalRect({ x: 990, y: 780, width: 100, height: 100 }, 2, 2000, 1600)).toEqual({ x: 1980, y: 1560, width: 20, height: 40 })
  })
})

describe('buildOverlayHtml', () => {
  it('含冻结帧注入点与事件回传通道', () => {
    const html = buildOverlayHtml()
    expect(html).toContain('__gtShot')
    expect(html).toContain('screenshot:overlay-event')
  })
})

describe('createScreenshotService 状态机', () => {
  it('copy 流程：隐藏启动器→抓帧→建遮罩→确认→物理裁剪→写剪贴板', async () => {
    const frame = fakeFrame(2000, 1600)
    const overlay = fakeOverlay()
    const deps = makeDeps({ frames: [frame], overlay })
    const svc = createScreenshotService(deps)
    const p = svc.capture()
    await tick()
    expect(deps.hidden).toBe(1)
    expect(deps.bounds).toEqual({ x: 0, y: 0, width: 1000, height: 800 })
    expect(deps.url.startsWith('data:text/html;charset=utf-8,')).toBe(true)
    expect(overlay.injected).toHaveLength(1)
    expect(overlay.shown).toBe(1)
    expect(svc.overlayWebContentsId()).toBe(77)
    svc.handleOverlayEvent({ type: 'confirm', rect: { x: 10, y: 20, width: 30, height: 40 }, mode: 'copy' })
    const r = await p
    expect(frame.crops[0]).toEqual({ x: 20, y: 40, width: 60, height: 80 })
    expect(deps.clip).toHaveLength(1)
    expect(deps.clip[0].startsWith('data:image/png;base64,')).toBe(true)
    expect(r).toMatchObject({ action: 'copy', width: 60, height: 80 })
    expect(overlay.destroyed).toBe(true)
    expect(svc.overlayWebContentsId()).toBeNull()
  })

  it('Esc/关窗 → cancel 且销毁遮罩', async () => {
    const overlay = fakeOverlay()
    const svc = createScreenshotService(makeDeps({ frames: [fakeFrame(100, 100)], overlay }))
    const p = svc.capture()
    await tick()
    svc.handleOverlayEvent({ type: 'cancel' })
    expect(await p).toEqual({ action: 'cancel' })
    expect(overlay.destroyed).toBe(true)

    const overlay2 = fakeOverlay()
    const svc2 = createScreenshotService(makeDeps({ frames: [fakeFrame(100, 100)], overlay: overlay2 }))
    const p2 = svc2.capture()
    await tick()
    overlay2.closedCb?.() // 用户 Alt+F4
    expect(await p2).toEqual({ action: 'cancel' })
  })

  it('并发 capture 抛错', async () => {
    const svc = createScreenshotService(makeDeps({ frames: [fakeFrame(100, 100)], overlay: fakeOverlay() }))
    const p = svc.capture()
    await tick()
    await expect(svc.capture()).rejects.toThrow('已有截图正在进行')
    svc.handleOverlayEvent({ type: 'cancel' })
    await p
  })

  it('黑帧重试一次：首帧黑/次帧正常成功，两帧全黑抛错', async () => {
    const ok = fakeFrame(100, 100)
    const svc = createScreenshotService(makeDeps({ frames: [fakeFrame(100, 100, true), ok], overlay: fakeOverlay() }))
    const p = svc.capture()
    await tick()
    svc.handleOverlayEvent({ type: 'cancel' })
    await p

    const svc2 = createScreenshotService(
      makeDeps({ frames: [fakeFrame(100, 100, true), fakeFrame(100, 100, true)], overlay: fakeOverlay() })
    )
    await expect(svc2.capture()).rejects.toThrow('屏幕捕获失败')
  })

  it('save 流程：对话框路径落盘；取消对话框 → cancel', async () => {
    const overlay = fakeOverlay()
    const deps = makeDeps({ frames: [fakeFrame(2000, 1600)], overlay, savePath: 'C:/tmp/截图.png' })
    const svc = createScreenshotService(deps)
    const p = svc.capture()
    await tick()
    svc.handleOverlayEvent({ type: 'confirm', rect: { x: 0, y: 0, width: 10, height: 10 }, mode: 'save' })
    const r: ScreenshotResult = await p
    expect(r.action).toBe('save')
    expect(r.savedPath).toBe('C:/tmp/截图.png')
    expect(deps.writes).toHaveLength(1)
    expect(deps.writes[0].p).toBe('C:/tmp/截图.png')

    const overlay2 = fakeOverlay()
    const svc2 = createScreenshotService(makeDeps({ frames: [fakeFrame(100, 100)], overlay: overlay2 })) // savePath 缺省=null
    const p2 = svc2.capture()
    await tick()
    svc2.handleOverlayEvent({ type: 'confirm', rect: { x: 0, y: 0, width: 10, height: 10 }, mode: 'save' })
    expect(await p2).toEqual({ action: 'cancel' })
  })

  it('非 confirm/cancel 的未知事件被忽略，会话保持', async () => {
    const overlay = fakeOverlay()
    const svc = createScreenshotService(makeDeps({ frames: [fakeFrame(100, 100)], overlay }))
    const p = svc.capture()
    await tick()
    svc.handleOverlayEvent({ type: 'nonsense' })
    svc.handleOverlayEvent('garbage')
    expect(svc.overlayWebContentsId()).toBe(77)
    svc.handleOverlayEvent({ type: 'cancel' })
    await p
  })
})
