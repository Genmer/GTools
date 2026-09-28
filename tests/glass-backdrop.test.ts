import { describe, expect, it } from 'vitest'
import {
  computeCropRect,
  createGlassBackdropService,
  type BackdropImageLike,
  type BackdropPayload
} from '../src/main/services/glass-backdrop'

describe('computeCropRect（窗口 DIP → 显示器物理像素裁剪区）', () => {
  it('基础映射：inset 内缩 + 取整', () => {
    expect(
      computeCropRect({
        winBounds: { x: 100, y: 200, width: 800, height: 600 },
        displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1,
        inset: 2
      })
    ).toEqual({ x: 102, y: 202, width: 796, height: 596 })
  })

  it('多显示器偏移与 dpr 缩放', () => {
    expect(
      computeCropRect({
        winBounds: { x: -1820, y: 100, width: 800, height: 600 },
        displayBounds: { x: -1920, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1.5
      })
    ).toEqual({ x: Math.round(100 * 1.5), y: Math.round(100 * 1.5), width: Math.round(800 * 1.5), height: Math.round(600 * 1.5) })
  })

  it('窗口越出屏幕左侧：夹到 0 并缩短宽度', () => {
    expect(
      computeCropRect({
        winBounds: { x: -100, y: 0, width: 800, height: 600 },
        displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1
      })
    ).toEqual({ x: 0, y: 0, width: 700, height: 600 })
  })

  it('窗口完全在屏幕外返回 null', () => {
    expect(
      computeCropRect({
        winBounds: { x: 5000, y: 0, width: 800, height: 600 },
        displayBounds: { x: 0, y: 0, width: 1920, height: 1080 },
        scaleFactor: 1
      })
    ).toBeNull()
  })
})

describe('createGlassBackdropService（抓取调度）', () => {
  function fakeImg(w = 3000, h = 2000): { img: BackdropImageLike; ops: string[] } {
    const ops: string[] = []
    const img: BackdropImageLike = {
      isEmpty: () => false,
      getSize: () => ({ width: w, height: h }),
      crop: (rect) => {
        ops.push(`crop:${rect.width}x${rect.height}`)
        return img
      },
      resize: (s) => {
        ops.push(`resize:${s.width}x${s.height}`)
        return img
      },
      toJPEG: (q) => {
        ops.push(`jpeg:${q}`)
        return Buffer.from('fake-jpeg-bytes')
      }
    }
    return { img, ops }
  }

  function makeService(over: {
    isGlass?: () => boolean
    isWinVisible?: () => boolean
    captureScreen?: ReturnType<typeof fakeImg>['img'] | null
    now?: () => number
    minIntervalMs?: number
  } = {}) {
    let clock = 10_000
    const { img, ops } = fakeImg()
    const sent: (BackdropPayload | { dataUrl: null })[] = []
    let captureCalls = 0
    const svc = createGlassBackdropService({
      isGlass: over.isGlass ?? (() => true),
      isWinVisible: over.isWinVisible ?? (() => true),
      snapshotContext: () => ({
        winBounds: { x: 100, y: 100, width: 800, height: 600 },
        displayBounds: { x: 0, y: 0, width: 3000, height: 2000 },
        scaleFactor: 1,
        dipSize: { width: 800, height: 600 },
        captureSize: { width: 3000, height: 2000 }
      }),
      captureScreen: async () => {
        captureCalls++
        return over.captureScreen !== undefined ? over.captureScreen : img
      },
      encode: (_im, rect, dip) => {
        ops.push(`encode:${rect.width}->${dip.width}`)
        return { dataUrl: 'data:image/jpeg;base64,ZmFrZQ==', width: dip.width, height: dip.height }
      },
      broadcast: (p) => sent.push(p),
      now: over.now ?? (() => clock),
      minIntervalMs: over.minIntervalMs
    })
    return {
      svc,
      sent,
      ops,
      get captureCalls() {
        return captureCalls
      },
      tick: (ms: number) => {
        clock += ms
      }
    }
  }

  it('成功帧：整屏捕获 → 编码 → 推送 dataURL', async () => {
    const { svc, sent, ops } = makeService()
    await svc.capture()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ dataUrl: 'data:image/jpeg;base64,ZmFrZQ==', width: 800, height: 600 })
    expect(ops.some((o) => o.startsWith('encode:'))).toBe(true)
    expect(svc.current()?.width).toBe(800)
  })

  it('门卫：非玻璃/窗口隐藏不抓；捕获为空不推送', async () => {
    const off = makeService({ isGlass: () => false })
    await off.svc.capture()
    expect(off.sent).toHaveLength(0)
    expect(off.captureCalls).toBe(0)
    const hidden = makeService({ isWinVisible: () => false })
    await hidden.svc.capture()
    expect(hidden.captureCalls).toBe(0)
    const blank = makeService({ captureScreen: null })
    await blank.svc.capture()
    expect(blank.sent).toHaveLength(0)
  })

  it('最小间隔去抖：250ms 内重复触发只抓一次，force 直通', async () => {
    const m = makeService({ minIntervalMs: 250 })
    await m.svc.capture()
    await m.svc.capture()
    expect(m.captureCalls).toBe(1) // getter 须经对象访问，解构会快照初始值
    expect(m.sent).toHaveLength(1)
    m.tick(300)
    await m.svc.capture()
    expect(m.captureCalls).toBe(2)
    await m.svc.capture(true)
    expect(m.captureCalls).toBe(3)
  })

  it('clear：广播 null 回退信号且 current 清空', async () => {
    const { svc, sent } = makeService()
    await svc.capture()
    svc.clear()
    expect(sent.at(-1)).toEqual({ dataUrl: null })
    expect(svc.current()).toBeNull()
  })
})
