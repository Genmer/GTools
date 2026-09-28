import { describe, expect, it } from 'vitest'
import {
  analyzeBackdropProbe,
  buildLensProbeScript,
  createGlassCapability,
  removeLensProbeScript,
  type BitmapView
} from '../src/main/services/glass-capability'

function solidBitmap(pixel: [number, number, number, number], width = 16, height = 16): BitmapView {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = pixel[0]
    data[i + 1] = pixel[1]
    data[i + 2] = pixel[2]
    data[i + 3] = pixel[3]
  }
  return { width, height, data }
}

describe('analyzeBackdropProbe', () => {
  it('纯绿（BGRA 0,255,0,255）判过', () => {
    expect(analyzeBackdropProbe(solidBitmap([0, 255, 0, 255]))).toBe(true)
  })
  it('黑白条纹（滤镜未生效）判负', () => {
    const data = new Uint8Array(16 * 16 * 4)
    for (let i = 0; i < data.length; i += 8) {
      data.set([255, 255, 255, 255], i)
      data.set([0, 0, 0, 255], i + 4)
    }
    expect(analyzeBackdropProbe({ width: 16, height: 16, data })).toBe(false)
  })
  it('生效判定（阈值 0.25）：半数绿通过，全条纹不通过，微量绿不通过', () => {
    // 滤镜生效 ≈ 白条纹被染绿 → 恰约一半像素绿；失效 = 0% 绿
    const half = new Uint8Array(16 * 16 * 4)
    for (let i = 0; i < half.length; i += 4) half.set(i < half.length / 2 ? [0, 255, 0, 255] : [0, 0, 0, 255], i)
    expect(analyzeBackdropProbe({ width: 16, height: 16, data: half })).toBe(true)
    const tenth = new Uint8Array(16 * 16 * 4)
    for (let i = 0; i < tenth.length; i += 4)
      tenth.set(i < tenth.length / 10 ? [0, 255, 0, 255] : [255, 255, 255, 255], i)
    expect(analyzeBackdropProbe({ width: 16, height: 16, data: tenth })).toBe(false)
    expect(analyzeBackdropProbe({ width: 0, height: 0, data: new Uint8Array(0) })).toBe(false)
  })
})

describe('探针脚本', () => {
  it('注入条纹宿主并引用静态滤镜 #gt-lens-probe-f（不运行时创建 <filter>）', () => {
    const s = buildLensProbeScript()
    expect(s).toContain('repeating-linear-gradient')
    expect(s).toContain('backdrop-filter:url(#gt-lens-probe-f)')
    expect(s).toContain('devicePixelRatio')
    expect(s).not.toContain("createElementNS(NS, 'filter')")
    expect(s).not.toContain('feDisplacementMap')
  })
  it('清理脚本移除探针件', () => {
    expect(removeLensProbeScript()).toContain('gt-lens-probe')
  })
})

describe('createGlassCapability 状态机', () => {
  const okDeps = () => {
    const flags: boolean[] = []
    return {
      flags,
      deps: {
        getGpuCompositing: (): string => 'enabled',
        executeInPage: async (): Promise<string> =>
          JSON.stringify({ x: 0, y: 0, width: 64, height: 64, dpr: 1 }),
        captureRect: async (): Promise<BitmapView> => solidBitmap([0, 255, 0, 255]),
        applyLensFlag: (_w: unknown, on: boolean): void => {
          flags.push(on)
        },
        delay: async () => {},
        removeInPage: async (): Promise<number> => 0
      }
    }
  }

  it('探针通过：置 lens 标志并保持 L2', async () => {
    const { flags, deps } = okDeps()
    const cap = createGlassCapability(deps)
    expect(await cap.probe({})).toBe('pass')
    expect(flags).toEqual([true])
    expect(cap.state()).toEqual({ lensActive: true, downgraded: false })
  })

  it('探针失败（回传条纹）：置 false 落 L1', async () => {
    const { flags, deps } = okDeps()
    deps.captureRect = async () => solidBitmap([255, 255, 255, 255])
    const cap = createGlassCapability(deps)
    expect(await cap.probe({})).toBe('fail')
    expect(flags).toEqual([false])
    expect(cap.state().lensActive).toBe(false)
  })

  it('GPU 合成不可用直接 skip（不探不置标志）', async () => {
    const { flags, deps } = okDeps()
    deps.getGpuCompositing = () => 'software'
    const cap = createGlassCapability(deps)
    expect(await cap.probe({})).toBe('skip')
    expect(flags).toEqual([])
  })

  it('L2 下崩溃一次永久降 L1，随后探针 skip；L1 下崩溃不触发 reload', async () => {
    const { deps } = okDeps()
    const cap = createGlassCapability(deps)
    await cap.probe({})
    expect(cap.handleRenderProcessGone()).toBe(true)
    expect(cap.state()).toEqual({ lensActive: false, downgraded: true })
    expect(await cap.probe({})).toBe('skip')
    const fresh = createGlassCapability(deps)
    expect(fresh.handleRenderProcessGone()).toBe(false)
  })

  it('探针结束即摘除页内宿主件（通过与失败都摘，防条纹块常驻污染画面）', async () => {
    const { deps } = okDeps()
    const removed: number[] = []
    deps.removeInPage = async (): Promise<number> => removed.push(1)
    const cap = createGlassCapability(deps)
    expect(await cap.probe({})).toBe('pass')
    const failing = createGlassCapability({ ...deps, captureRect: async () => solidBitmap([255, 255, 255, 255]) })
    expect(await failing.probe({})).toBe('fail')
    expect(removed).toEqual([1, 1])
  })
})
