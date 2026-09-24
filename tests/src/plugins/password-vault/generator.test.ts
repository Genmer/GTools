import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GENERATOR_OPTIONS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SYMBOL_CHARS,
  cryptoRandomInt,
  generatePassword,
  normalizeGeneratorOptions
} from '../../../../src/plugins/password-vault/logic/generator'

const LOWER = 'abcdefghijklmnopqrstuvwxyz'
const UPPER = LOWER.toUpperCase()
const DIGITS = '0123456789'
const ALL = LOWER + UPPER + DIGITS + SYMBOL_CHARS

describe('normalizeGeneratorOptions', () => {
  it('undefined / 非法输入回默认值', () => {
    expect(normalizeGeneratorOptions(undefined)).toEqual(DEFAULT_GENERATOR_OPTIONS)
    expect(normalizeGeneratorOptions('junk')).toEqual(DEFAULT_GENERATOR_OPTIONS)
  })
  it('长度夹取到 [4,128]，小数取整', () => {
    expect(normalizeGeneratorOptions({ length: 1 })).toMatchObject({ length: MIN_PASSWORD_LENGTH })
    expect(normalizeGeneratorOptions({ length: 9999 })).toMatchObject({ length: MAX_PASSWORD_LENGTH })
    expect(normalizeGeneratorOptions({ length: 12.6 })).toMatchObject({ length: 13 })
    expect(normalizeGeneratorOptions({ length: Number.NaN })).toMatchObject({ length: 16 })
  })
  it('全不勾回退为 小写+数字（不允许空字符集）', () => {
    const n = normalizeGeneratorOptions({ length: 12, lowercase: false, uppercase: false, digits: false, symbols: false })
    expect(n).toMatchObject({ lowercase: true, uppercase: false, digits: true, symbols: false })
    expect(generatePassword(n)).toMatch(new RegExp(`^[${LOWER}${DIGITS}]+$`))
  })
})

describe('generatePassword（注入确定性随机源）', () => {
  const rng = (vals: number[]): ((max: number) => number) => {
    let i = 0
    return (max: number) => {
      const v = vals[i % vals.length] ?? 0
      i++
      return v % max
    }
  }

  it('长度正确且每类勾选字符集至少出现一次', () => {
    const pw = generatePassword(
      { length: 10, lowercase: true, uppercase: true, digits: true, symbols: true },
      rng([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 0])
    )
    expect(pw).toHaveLength(10)
    for (const set of [LOWER, UPPER, DIGITS, SYMBOL_CHARS]) {
      expect([...pw].some((c) => set.includes(c)), `缺字符集 ${set[0]}`).toBe(true)
    }
    expect([...pw].every((c) => ALL.includes(c))).toBe(true)
  })

  it('仅勾数字时生成纯数字', () => {
    const pw = generatePassword({ length: 8, lowercase: false, uppercase: false, digits: true, symbols: false }, rng([5, 7]))
    expect(pw).toMatch(/^[0-9]{8}$/)
  })

  it('零随机源不越界（max=1 等边界）', () => {
    const pw = generatePassword({ length: 4, lowercase: true, uppercase: false, digits: false, symbols: false }, () => 0)
    expect(pw).toBe('aaaa')
  })
})

describe('generatePassword（真实 crypto 随机源）', () => {
  const opts = { length: 20, lowercase: true, uppercase: true, digits: true, symbols: true }
  it('多样本：长度、字符集合法、每类都出现', () => {
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword(opts)
      expect(pw).toHaveLength(20)
      expect([...pw].every((c) => ALL.includes(c))).toBe(true)
      for (const set of [LOWER, UPPER, DIGITS, SYMBOL_CHARS]) {
        expect([...pw].some((c) => set.includes(c))).toBe(true)
      }
    }
  })
  it('两次生成互不相同的概率极高（长度 32，连续 20 对）', () => {
    for (let i = 0; i < 20; i++) {
      expect(generatePassword({ ...opts, length: 32 })).not.toBe(generatePassword({ ...opts, length: 32 }))
    }
  })
  it('cryptoRandomInt 值域始终为 [0, max)', () => {
    for (const max of [1, 2, 3, 7, 26, 256, 1000]) {
      for (let i = 0; i < 200; i++) {
        const v = cryptoRandomInt(max)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(max)
        expect(Number.isInteger(v)).toBe(true)
      }
    }
  })
  it('cryptoRandomInt 非法 max 抛错', () => {
    expect(() => cryptoRandomInt(0)).toThrow()
    expect(() => cryptoRandomInt(-1)).toThrow()
    expect(() => cryptoRandomInt(1.5)).toThrow()
  })
})
