import { describe, expect, it } from 'vitest'
import {
  DETACHED_MIN_H,
  DETACHED_MIN_W,
  MARGIN_BOTTOM,
  MARGIN_TOP,
  MARGIN_X,
  detachedWindowBounds,
  wantsDetachedMargin
} from '../src/main/detached-window-geometry'

describe('wantsDetachedMargin 平台分治门控', () => {
  it('darwin 透明窗不加边距环（darwin 零改动门控）', () => {
    expect(wantsDetachedMargin(true, 'darwin')).toBe(false)
  })

  it('win32/linux 透明窗加边距环', () => {
    expect(wantsDetachedMargin(true, 'win32')).toBe(true)
    expect(wantsDetachedMargin(true, 'linux')).toBe(true)
  })

  it('任意平台不透明窗不加边距环', () => {
    expect(wantsDetachedMargin(false, 'win32')).toBe(false)
    expect(wantsDetachedMargin(false, 'linux')).toBe(false)
    expect(wantsDetachedMargin(false, 'darwin')).toBe(false)
  })
})

describe('detachedWindowBounds 恒等分支', () => {
  it('withMargin=false 时六元组逐字段等于 opts + 360×240 min（不透明窗 + darwin 逐字节同现状锚点）', () => {
    expect(detachedWindowBounds({ width: 680, height: 480, x: 100, y: 88 }, false)).toEqual({
      width: 680,
      height: 480,
      x: 100,
      y: 88,
      minWidth: 360,
      minHeight: 240
    })
  })

  it('恒等分支不做取整：非整数 opts 原样透传（同现状直传语义）', () => {
    expect(detachedWindowBounds({ width: 680.5, height: 480.25, x: 99.5, y: 87.5 }, false)).toEqual({
      width: 680.5,
      height: 480.25,
      x: 99.5,
      y: 87.5,
      minWidth: 360,
      minHeight: 240
    })
  })
})

describe('detachedWindowBounds 边距分支', () => {
  const opts = { width: 680, height: 480, x: 620, y: 300 }

  it('680×480 内容 → 744×560 窗口，原点外移 32/32，min 加满边距', () => {
    expect(detachedWindowBounds(opts, true)).toEqual({
      width: 744,
      height: 560,
      x: 588,
      y: 268,
      minWidth: 424,
      minHeight: 320
    })
  })

  it('内容位置不变式：内容仍落 manager 居中期望位', () => {
    const b = detachedWindowBounds(opts, true)
    expect(b.x + MARGIN_X).toBe(opts.x)
    expect(b.y + MARGIN_TOP).toBe(opts.y)
  })

  it('内容下限不变式：OS min 扣边距后仍为 360×240 内容下限', () => {
    const b = detachedWindowBounds(opts, true)
    expect(b.minWidth - MARGIN_X * 2).toBe(DETACHED_MIN_W)
    expect(b.minHeight - MARGIN_TOP - MARGIN_BOTTOM).toBe(DETACHED_MIN_H)
  })

  it('非整数入参输出全为整数（round）', () => {
    const b = detachedWindowBounds({ width: 679.5, height: 479.6, x: 639.5, y: 299.4 }, true)
    expect(
      [b.width, b.height, b.x, b.y].every((v) => Number.isInteger(v))
    ).toBe(true)
  })

  it('MARGIN 常数锁定 32/32/48（与 base.css #app padding 环的车道契约）', () => {
    expect(MARGIN_X).toBe(32)
    expect(MARGIN_TOP).toBe(32)
    expect(MARGIN_BOTTOM).toBe(48)
  })
})
