import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PERSIST,
  FLOAT_HTML_CHAR_BUDGET,
  applyZoom,
  buildDataUrl,
  clampWindow,
  fitScale,
  initialPinPlan,
  mimeForPath,
  normalizePersist,
  parseResetPayload,
  parseStateReport,
  parseZoomPayload,
  pinWindowSize,
  resetSize,
  shrinkScaleFor,
  zoomFactorFromWheelDelta
} from '../../../../src/plugins/float-image/logic/state'

describe('normalizePersist', () => {
  it('非法输入回落默认值', () => {
    expect(normalizePersist(null)).toEqual(DEFAULT_PERSIST)
    expect(normalizePersist(42)).toEqual(DEFAULT_PERSIST)
    expect(normalizePersist({})).toEqual(DEFAULT_PERSIST)
  })

  it('合法字段保留并取整', () => {
    expect(normalizePersist({ v: 1, x: 10.6, y: -20.2, scale: 1.5, opacity: 0.6 })).toEqual({
      v: 1,
      x: 11,
      y: -20,
      scale: 1.5,
      opacity: 0.6
    })
  })

  it('极端坐标不记忆（防换屏后浮窗落屏外）', () => {
    const r = normalizePersist({ x: 1e9, y: 100, scale: 1, opacity: 1 })
    expect(r.x).toBeNull()
    expect(r.y).toBe(100)
  })

  it('scale/opacity 越界夹取', () => {
    const r = normalizePersist({ scale: 0, opacity: 9 })
    expect(r.scale).toBe(1)
    expect(r.opacity).toBe(1)
    expect(normalizePersist({ opacity: 0.01 }).opacity).toBe(0.15)
    expect(normalizePersist({ scale: 100 }).scale).toBe(32)
  })
})

describe('窗口几何', () => {
  it('pinWindowSize：窗口 = 原图 × scale（控制条为 hover 浮层不占高）', () => {
    expect(pinWindowSize({ width: 200, height: 100 }, 1)).toEqual({ width: 200, height: 100 })
    expect(pinWindowSize({ width: 200, height: 100 }, 2)).toEqual({ width: 400, height: 200 })
  })

  it('pinWindowSize：超限夹在宿主窗口上下限', () => {
    expect(pinWindowSize({ width: 6000, height: 4000 }, 1)).toEqual({ width: 4000, height: 4000 })
    expect(pinWindowSize({ width: 50, height: 40 }, 1)).toEqual({ width: 80, height: 80 })
  })

  it('fitScale：大图收缩、小图保持 1:1', () => {
    expect(fitScale({ width: 800, height: 600 })).toBeCloseTo(0.6)
    expect(fitScale({ width: 100, height: 80 })).toBe(1)
    expect(fitScale({ width: 1000, height: 200 }, 500, 100)).toBeCloseTo(0.5)
  })

  it('initialPinPlan：全新状态按适配尺寸、不带坐标', () => {
    const plan = initialPinPlan({ width: 800, height: 600 }, DEFAULT_PERSIST)
    expect(plan.x).toBeUndefined()
    expect(plan.y).toBeUndefined()
    expect(plan.width).toBe(480)
    expect(plan.height).toBe(360)
    expect(plan.scale).toBeCloseTo(0.6)
  })

  it('initialPinPlan：老状态复用位置/倍率/不透明度', () => {
    const plan = initialPinPlan({ width: 100, height: 80 }, { v: 1, x: 120, y: 66, scale: 2, opacity: 0.5 })
    expect(plan).toEqual({ width: 200, height: 160, x: 120, y: 66, scale: 2, opacity: 0.5 })
  })

  it('initialPinPlan：x/y 只有一侧时整体放弃（避免半记忆状态）', () => {
    const plan = initialPinPlan({ width: 100, height: 80 }, { v: 1, x: 10, y: null, scale: 1, opacity: 1 })
    expect(plan.x).toBeUndefined()
    expect(plan.y).toBeUndefined()
  })

  it('applyZoom：宽高等比缩放', () => {
    expect(applyZoom({ width: 400, height: 228 }, 1.25)).toEqual({ width: 500, height: 285 })
    expect(applyZoom({ width: 400, height: 228 }, 0.8)).toEqual({ width: 320, height: 182 })
  })

  it('applyZoom：非法 factor 视为 1', () => {
    expect(applyZoom({ width: 400, height: 228 }, 0)).toEqual({ width: 400, height: 228 })
    expect(applyZoom({ width: 400, height: 228 }, Number.NaN)).toEqual({ width: 400, height: 228 })
  })

  it('applyZoom：命中宿主上下限', () => {
    expect(applyZoom({ width: 3900, height: 3900 }, 1.25)).toEqual({ width: 4000, height: 4000 })
    expect(applyZoom({ width: 90, height: 100 }, 0.1)).toEqual({ width: 80, height: 80 })
  })

  it('resetSize：按原图 1:1，超限截断', () => {
    expect(resetSize({ width: 200, height: 100 })).toEqual({ width: 200, height: 100 })
    expect(resetSize({ width: 6000, height: 4000 })).toEqual({ width: 4000, height: 4000 })
  })

  it('zoomFactorFromWheelDelta：上滚放大下滚缩小', () => {
    expect(zoomFactorFromWheelDelta(-120)).toBeCloseTo(1.1)
    expect(zoomFactorFromWheelDelta(120)).toBeCloseTo(1 / 1.1)
    expect(zoomFactorFromWheelDelta(0)).toBe(1)
  })

  it('clampWindow：非有限数回落最小窗', () => {
    expect(clampWindow(Number.POSITIVE_INFINITY)).toBe(80)
    expect(clampWindow(123.6)).toBe(124)
  })
})

describe('回传事件载荷解析', () => {
  it('parseZoomPayload', () => {
    expect(parseZoomPayload({ factor: 1.25, width: 400, height: 228 })).toEqual({
      factor: 1.25,
      width: 400,
      height: 228
    })
    expect(parseZoomPayload({ factor: 0, width: 400, height: 228 })).toBeNull()
    expect(parseZoomPayload({ factor: 1, width: '400', height: 228 })).toBeNull()
    expect(parseZoomPayload(null)).toBeNull()
  })

  it('parseResetPayload', () => {
    expect(parseResetPayload({ naturalWidth: 600, naturalHeight: 400 })).toEqual({ width: 600, height: 400 })
    expect(parseResetPayload({ naturalWidth: 0, naturalHeight: 400 })).toBeNull()
    expect(parseResetPayload('x')).toBeNull()
  })

  it('parseStateReport：字段齐全且越界拒绝', () => {
    expect(parseStateReport({ x: 10, y: 20, width: 500, height: 378, opacity: 0.5 })).toEqual({
      x: 10,
      y: 20,
      width: 500,
      height: 378,
      opacity: 0.5
    })
    const noOpacity = parseStateReport({ x: 10, y: 20, width: 500, height: 378 })
    expect(noOpacity).not.toBeNull()
    expect(noOpacity?.opacity).toBeUndefined()
    expect(parseStateReport({ x: NaN, y: 20, width: 500, height: 378 })).toBeNull()
    expect(parseStateReport({ x: 1e9, y: 20, width: 500, height: 378 })).toBeNull()
    expect(parseStateReport({ x: 10, y: 20, width: 500, height: 378, opacity: 0 })).toEqual({
      x: 10,
      y: 20,
      width: 500,
      height: 378,
      opacity: 0.15
    })
  })
})

describe('图片数据工具', () => {
  it('mimeForPath：扩展名白名单（大小写不敏感）', () => {
    expect(mimeForPath('/a/b/c.PNG')).toBe('image/png')
    expect(mimeForPath('照片.jpg')).toBe('image/jpeg')
    expect(mimeForPath('x.svg')).toBe('image/svg+xml')
    expect(mimeForPath('x.txt')).toBeNull()
    expect(mimeForPath('noext')).toBeNull()
  })

  it('buildDataUrl', () => {
    expect(buildDataUrl('image/png', 'AAA')).toBe('data:image/png;base64,AAA')
  })

  it('shrinkScaleFor：超预算开根号降采样，下限 0.05', () => {
    expect(shrinkScaleFor(1000, FLOAT_HTML_CHAR_BUDGET)).toBe(1)
    expect(shrinkScaleFor(4_000_000, 1_000_000)).toBeCloseTo(Math.sqrt(0.225))
    expect(shrinkScaleFor(1e9, 1000)).toBe(0.05)
  })
})
