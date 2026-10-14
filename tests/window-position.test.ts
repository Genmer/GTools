import { describe, expect, it } from 'vitest'
import { applyResizeDelta, decideShowPosition, type DisplayArea } from '../src/main/window-position'

const display = (x: number, y: number, w = 1920, h = 1080): DisplayArea => ({
  bounds: { x, y, width: w, height: h },
  workArea: { x, y: y + 40, width: w, height: h - 80 }
})

const WIN = { width: 864, height: 640 }

describe('decideShowPosition 唤起位置决策', () => {
  it('无记忆：光标屏工作区居中偏上', () => {
    const d = display(0, 0)
    const r = decideShowPosition(null, { x: 500, y: 500 }, [d], WIN)
    expect(r).toEqual({ x: Math.round((1920 - 864) / 2), y: Math.round(40 + 1000 * 0.28) })
  })

  it('记忆位置在光标所在屏内：原位沿用', () => {
    const d = display(0, 0)
    const r = decideShowPosition({ x: 300, y: 200 }, { x: 500, y: 500 }, [d], WIN)
    expect(r).toEqual({ x: 300, y: 200 })
  })

  it('记忆位置在另一块屏：光标屏优先（uTools 式跟随鼠标屏）', () => {
    const main = display(0, 0)
    const sub = display(1920, 0)
    const r = decideShowPosition({ x: 2200, y: 300 }, { x: 500, y: 500 }, [main, sub], WIN)
    expect(r).toEqual(decideShowPosition(null, { x: 500, y: 500 }, [main, sub], WIN))
  })

  it('光标在副屏且记忆也在副屏：沿用记忆', () => {
    const main = display(0, 0)
    const sub = display(1920, 0)
    const r = decideShowPosition({ x: 2200, y: 300 }, { x: 2400, y: 500 }, [main, sub], WIN)
    expect(r).toEqual({ x: 2200, y: 300 })
  })

  it('记忆位置主体已出屏（拔掉了显示器）：回退光标屏默认位', () => {
    const main = display(0, 0)
    const r = decideShowPosition({ x: 5000, y: 200 }, { x: 500, y: 500 }, [main], WIN)
    expect(r).toEqual(decideShowPosition(null, { x: 500, y: 500 }, [main], WIN))
  })

  it('光标落在屏间隙：取中心最近的屏', () => {
    const main = display(0, 0)
    const sub = display(1920, 0, 1920, 1080)
    const r = decideShowPosition(null, { x: 1900, y: 500 }, [main, sub], WIN)
    expect(r).toEqual(decideShowPosition(null, { x: 1000, y: 500 }, [main], WIN))
  })

  it('坐标取整：非整数记忆与偏移计算都落整数', () => {
    const d = display(0, 0, 1919, 1079)
    const r = decideShowPosition({ x: 100.6, y: 50.4 }, { x: 100, y: 100 }, [d], WIN)
    expect(Number.isInteger(r.x)).toBe(true)
    expect(Number.isInteger(r.y)).toBe(true)
  })

  it('displays 为空：直接返回光标坐标兜底', () => {
    expect(decideShowPosition(null, { x: 12, y: 34 }, [], WIN)).toEqual({ x: 12, y: 34 })
    expect(decideShowPosition({ x: 0, y: 0 }, { x: -12, y: -34 }, [], WIN)).toEqual({ x: -12, y: -34 })
  })

  it('副屏在主屏左侧（bounds.x 为负）：居中与记忆沿用都以负坐标屏为准', () => {
    const main = display(0, 0)
    const left = display(-1920, 0)
    const r = decideShowPosition(null, { x: -1000, y: 500 }, [main, left], WIN)
    expect(r).toEqual({ x: Math.round(-1920 + (1920 - 864) / 2), y: Math.round(40 + 1000 * 0.28) })
    const r2 = decideShowPosition({ x: -1800, y: 100 }, { x: -1000, y: 500 }, [main, left], WIN)
    expect(r2).toEqual({ x: -1800, y: 100 })
  })

  it('记忆位置主体中心在屏内、边缘越界：仍沿用（只校验中心点）', () => {
    const main = display(0, 0)
    // 窗口左缘 -100 出屏，但主体中心 (332, 520) 在屏内
    const r = decideShowPosition({ x: -100, y: 200 }, { x: 500, y: 500 }, [main], WIN)
    expect(r).toEqual({ x: -100, y: 200 })
  })

  it('workArea 与 bounds 偏移（如左侧 Dock）：居中按 workArea 计算', () => {
    const d: DisplayArea = {
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      workArea: { x: 200, y: 40, width: 1720, height: 1000 }
    }
    const r = decideShowPosition(null, { x: 960, y: 500 }, [d], WIN)
    expect(r).toEqual({ x: Math.round(200 + (1720 - 864) / 2), y: Math.round(40 + 1000 * 0.28) })
  })
})

describe('applyResizeDelta', () => {
  const min = { width: 520, height: 360 }
  const max = { width: 1720, height: 1000 }
  it('增量正向扩到工作区上限为止', () => {
    expect(applyResizeDelta({ width: 800, height: 560 }, min, max, 100, 50)).toEqual({ width: 900, height: 610 })
    expect(applyResizeDelta({ width: 1700, height: 980 }, min, max, 100, 100)).toEqual({ width: 1720, height: 1000 })
  })
  it('缩到最小尺寸为止且负向不越过', () => {
    expect(applyResizeDelta({ width: 600, height: 400 }, min, max, -200, -200)).toEqual({ width: 520, height: 360 })
  })
  it('增量取整', () => {
    expect(applyResizeDelta({ width: 800, height: 560 }, min, max, 10.6, -0.4)).toEqual({ width: 811, height: 560 })
  })
})
