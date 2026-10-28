import { describe, expect, it } from 'vitest'
import { dateToTs, formatDate, tsToDate } from '../../../../src/plugins/devtools/views/logic/time'

describe('devtools 时间戳互转', () => {
  it('tsToDate：s 乘 1000，ms 原样', () => {
    expect(tsToDate(1700000000, 's')?.getTime()).toBe(1700000000000)
    expect(tsToDate(1700000000123, 'ms')?.getTime()).toBe(1700000000123)
  })

  it('tsToDate：超大/非法值返回 null，不再产出 NaN-NaN-NaN 串', () => {
    expect(tsToDate(1e30, 's')).toBeNull()
    expect(tsToDate(1e21, 'ms')).toBeNull()
    expect(tsToDate(-1e30, 's')).toBeNull()
    expect(tsToDate(Number.NaN, 's')).toBeNull()
    expect(tsToDate(Number.POSITIVE_INFINITY, 'ms')).toBeNull()
  })

  it('tsToDate：±8.64e15 ms 为 Date 极限边界，边界内可用、越界为 null', () => {
    expect(tsToDate(8.64e15, 'ms')?.getTime()).toBe(8.64e15)
    expect(tsToDate(-8.64e15, 'ms')?.getTime()).toBe(-8.64e15)
    expect(tsToDate(8.64e15 + 1, 'ms')).toBeNull()
    expect(formatDate(tsToDate(8.64e15, 'ms')!)).not.toContain('NaN')
  })

  it('dateToTs：s 为 ms 整除向下取整', () => {
    expect(dateToTs(new Date(1700000000123))).toEqual({ s: 1700000000, ms: 1700000000123 })
    // 负时间戳也走 Math.floor（-1.5s → -2s），与秒级时间戳惯例一致
    expect(dateToTs(new Date(-1500))).toEqual({ s: -2, ms: -1500 })
  })

  it('formatDate：本地时区可读格式，个位数补零（用本地构造避免时区依赖）', () => {
    expect(formatDate(new Date(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05')
    expect(formatDate(new Date(2026, 10, 20, 13, 40, 9))).toBe('2026-11-20 13:40:09')
  })

  it('往返一致', () => {
    const d = new Date(2026, 8, 24, 18, 30, 15)
    expect(tsToDate(dateToTs(d).ms, 'ms')?.getTime()).toBe(d.getTime())
  })
})
