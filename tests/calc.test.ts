import { describe, expect, it } from 'vitest'
import { calc } from '../src/renderer/src/core/calc'

describe('calc 内联计算器', () => {
  it('四则运算与优先级：1+2*3 = 7', () => {
    expect(calc('1+2*3')).toBe('7')
  })

  it('括号与幂：(2-0.5)^2 = 2.25', () => {
    expect(calc('(2-0.5)^2')).toBe('2.25')
  })

  it('一元负号：-4/8 = -0.5', () => {
    expect(calc('-4/8')).toBe('-0.5')
  })

  it('取模与内部空白：10 % 3 = 1', () => {
    expect(calc('10 % 3')).toBe('1')
  })

  it('幂右结合且指数可负：2^3^2 = 512、2^-1 = 0.5', () => {
    expect(calc('2^3^2')).toBe('512')
    expect(calc('2^-1')).toBe('0.5')
  })

  it('-2^2 按惯例解析为 -(2^2) = -4', () => {
    expect(calc('-2^2')).toBe('-4')
  })

  it('小数至多 10 位去尾零：1/3、0.1+0.2', () => {
    expect(calc('1/3')).toBe('0.3333333333')
    expect(calc('0.1+0.2')).toBe('0.3')
  })

  it('整数结果不带千分位分隔', () => {
    expect(calc('123456*1000')).toBe('123456000')
  })

  it('非法输入返回 null 不抛：残缺/字符/除零/超长', () => {
    expect(calc('')).toBeNull()
    expect(calc('   ')).toBeNull()
    expect(calc('1++')).toBeNull()
    expect(calc('alert(1)')).toBeNull()
    expect(calc('(1+2')).toBeNull()
    expect(calc('1+2)')).toBeNull()
    expect(calc('1/0')).toBeNull()
    expect(calc('5%0')).toBeNull()
    expect(calc('1..2')).toBeNull()
    expect(calc('(1+1)'.repeat(21))).toBeNull() // 105 字符，超 100 上限
    expect(calc('9999^9999')).toBeNull() // 溢出 Infinity
  })

  it('纯数字合法（透传展示）', () => {
    expect(calc('3.14')).toBe('3.14')
  })
})
