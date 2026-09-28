import { describe, expect, it } from 'vitest'
import { navStep } from '../src/renderer/src/core/result-nav'

const single = (count: number) => [{ start: 0, count, cols: 9 }]

describe('navStep 单区回归锁定（与旧 ±1/±9/边界夹紧逐位一致）', () => {
  it('x ±1 全局循环', () => {
    const s = single(20)
    expect(navStep(0, s, -1, 'x')).toBe(19)
    expect(navStep(19, s, 1, 'x')).toBe(0)
    expect(navStep(7, s, 1, 'x')).toBe(8)
    expect(navStep(7, s, -1, 'x')).toBe(6)
  })

  it('y ±9，末行向下夹紧到末元素、首行向上夹紧到首元素，到边即停', () => {
    const s = single(20)
    expect(navStep(5, s, 1, 'y')).toBe(14)
    expect(navStep(14, s, -1, 'y')).toBe(5)
    expect(navStep(15, s, 1, 'y')).toBe(19)
    expect(navStep(19, s, 1, 'y')).toBe(19)
    expect(navStep(5, s, -1, 'y')).toBe(0)
    expect(navStep(0, s, -1, 'y')).toBe(0)
  })
})

describe('navStep 双区（C1：主结果区 + 推荐区）', () => {
  const s = [
    { start: 0, count: 12, cols: 9 },
    { start: 12, count: 4, cols: 9 }
  ]

  it('y 跨界按列对齐落入相邻区', () => {
    // 主区第 0 行 col 3 向下 → 推荐区 col 3
    expect(navStep(3, s, 1, 'y')).toBe(12 + 3)
    // 推荐区 col 2 向上 → 主区 col 2
    expect(navStep(14, s, -1, 'y')).toBe(2)
  })

  it('跨界列号夹紧到目标区行数', () => {
    // col 5 超出推荐区长度 4 → 夹紧到推荐区末位
    expect(navStep(5, s, 1, 'y')).toBe(12 + 3)
  })

  it('x 在区内循环、不跨区', () => {
    expect(navStep(11, s, 1, 'x')).toBe(0)
    expect(navStep(12, s, -1, 'x')).toBe(12 + 3)
  })

  it('末区向下/首区向上无相邻区时夹紧本区边界', () => {
    expect(navStep(15, s, 1, 'y')).toBe(15)
    expect(navStep(14, s, 1, 'y')).toBe(15)
    expect(navStep(1, s, -1, 'y')).toBe(0)
  })
})

describe('navStep 空态段形状（C2：剪贴板行+最近行合并前缀 1×N + 9 列网格）', () => {
  const K = 2
  const R = K + 5 // 前缀 = 剪贴板 2 + 最近 5
  const A = 18
  const s = [
    { start: 0, count: R, cols: 9 },
    { start: R, count: A, cols: 9 }
  ]

  it('网格向上回前缀按列对齐、列号夹紧到前缀长度', () => {
    expect(navStep(R + 4, s, -1, 'y')).toBe(4)
    expect(navStep(R + 8, s, -1, 'y')).toBe(Math.min(8 % 9, R - 1))
  })

  it('前缀行向下落网格同列', () => {
    expect(navStep(1, s, 1, 'y')).toBe(R + 1)
  })

  it('前缀内 x 循环（两行段合并为一条 1×N，区内循环不跨区）', () => {
    expect(navStep(0, s, -1, 'x')).toBe(R - 1)
    expect(navStep(R - 1, s, 1, 'x')).toBe(0)
  })
})

describe('navStep 退化输入', () => {
  it('无区/零长区原样返回', () => {
    expect(navStep(0, [], 1, 'y')).toBe(0)
    expect(navStep(3, [{ start: 0, count: 0, cols: 9 }], 1, 'x')).toBe(3)
  })
})
