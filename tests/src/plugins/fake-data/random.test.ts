import { describe, expect, it } from 'vitest'
import { chance, createRng, pick, randomDigits, randomLetters, randInt } from '../../../../src/plugins/fake-data/logic/random'

describe('random', () => {
  it('同种子序列完全确定且可重放', () => {
    const a = createRng(42)
    const b = createRng(42)
    const sa = Array.from({ length: 100 }, () => a())
    const sb = Array.from({ length: 100 }, () => b())
    expect(sa).toEqual(sb)
  })

  it('不同种子序列不同', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(Array.from({ length: 20 }, () => a())).not.toEqual(Array.from({ length: 20 }, () => b()))
  })

  it('输出均在 [0,1)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('randInt 落在闭区间内', () => {
    const rng = createRng(9)
    for (let i = 0; i < 1000; i++) {
      const v = randInt(rng, -3, 5)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(-3)
      expect(v).toBeLessThanOrEqual(5)
    }
  })

  it('pick 只返回数组元素', () => {
    const rng = createRng(11)
    const arr = ['x', 'y', 'z'] as const
    for (let i = 0; i < 100; i++) expect(arr).toContain(pick(rng, arr))
  })

  it('chance(1) 恒真、chance(0) 恒假', () => {
    const rng = createRng(13)
    expect(chance(rng, 1)).toBe(true)
    expect(chance(rng, 0)).toBe(false)
  })

  it('randomLetters / randomDigits 形态正确', () => {
    const rng = createRng(17)
    const letters = randomLetters(rng, 6, 12)
    expect(letters).toMatch(/^[a-z]{6,12}$/)
    expect(randomDigits(rng, 8)).toMatch(/^\d{8}$/)
  })
})
