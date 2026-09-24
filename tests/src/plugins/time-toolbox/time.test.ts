import { describe, expect, it } from 'vitest'
import {
  DEMO_MS,
  formatOffset,
  formatZoned,
  humanizeDistance,
  nowFormats,
  parseLocalDateTime,
  parseTimestamp,
  relativeMs,
  toDatetimeLocalValue,
  zoneOffsetMinutes,
  zoneRows,
  zonedParts
} from '../../../../src/plugins/time-toolbox/logic/time'

describe('parseTimestamp 秒/毫秒自动识别', () => {
  it('10 位按秒、13 位按毫秒', () => {
    expect(parseTimestamp('1699999999')).toEqual({ ts: 1699999999000, unit: 's' })
    expect(parseTimestamp('1699999999999')).toEqual({ ts: 1699999999999, unit: 'ms' })
  })
  it('12 位按毫秒（12 位秒不现实）', () => {
    expect(parseTimestamp('100000000000')).toEqual({ ts: 100000000000, unit: 'ms' })
  })
  it('容错空白与负数（1970 前）', () => {
    expect(parseTimestamp(' 1699999999\n')).toEqual({ ts: 1699999999000, unit: 's' })
    expect(parseTimestamp('-86400')).toEqual({ ts: -86400000, unit: 's' })
    expect(parseTimestamp('0')).toEqual({ ts: 0, unit: 's' })
  })
  it('非法输入返回 null', () => {
    expect(parseTimestamp('abc')).toBeNull()
    expect(parseTimestamp('12.5')).toBeNull()
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('1699999999秒')).toBeNull()
    expect(parseTimestamp('9999999999999999999')).toBeNull() // 超 Number.isSafeInteger
  })
  it('超出 Date 表示范围返回 null', () => {
    expect(parseTimestamp('99999999999999999')).toBeNull() // 17 位毫秒 > ±1e8 天
  })
  it('12 位及以上负数按毫秒（1970 前的毫秒时间戳）', () => {
    expect(parseTimestamp('-100000000000')).toEqual({ ts: -100000000000, unit: 'ms' })
  })
  it('前导 0 不影响位数判定：13 位含前导 0 仍按毫秒', () => {
    expect(parseTimestamp('0012345678901')).toEqual({ ts: 12345678901, unit: 'ms' })
  })
})

describe('zonedParts 直接断言', () => {
  it('指定时区各字段与中文星期', () => {
    expect(zonedParts(Date.UTC(2026, 0, 1, 16, 30, 5), 'Asia/Shanghai')).toEqual({
      year: 2026,
      month: 1,
      day: 2,
      hour: 0,
      minute: 30,
      second: 5,
      weekday: '周五'
    })
  })

  it('UTC 时刻字段与 DEMO_MS 周四', () => {
    expect(zonedParts(DEMO_MS, 'UTC')).toEqual({
      year: 2026,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
      weekday: '周四'
    })
  })
})

describe('时区换算', () => {
  it('formatZoned 显式时区正确换算', () => {
    const ms = Date.UTC(2026, 0, 1, 16, 30, 5)
    expect(formatZoned(ms, 'Asia/Shanghai')).toBe('2026-01-02 00:30:05')
    expect(formatZoned(ms, 'UTC')).toBe('2026-01-01 16:30:05')
    expect(formatZoned(ms, 'America/New_York')).toBe('2026-01-01 11:30:05')
  })
  it('formatZoned 无秒模式', () => {
    expect(formatZoned(Date.UTC(2026, 0, 1, 16, 30, 5), 'UTC', false)).toBe('2026-01-01 16:30')
  })
  it('zoneOffsetMinutes 覆盖固定偏移与夏令时', () => {
    const jan = Date.UTC(2026, 0, 15)
    const jul = Date.UTC(2026, 6, 15)
    expect(zoneOffsetMinutes(jan, 'Asia/Shanghai')).toBe(480)
    expect(zoneOffsetMinutes(jan, 'Asia/Tokyo')).toBe(540)
    expect(zoneOffsetMinutes(jan, 'America/New_York')).toBe(-300)
    expect(zoneOffsetMinutes(jul, 'America/New_York')).toBe(-240)
    expect(zoneOffsetMinutes(jan, 'Europe/London')).toBe(0)
    expect(zoneOffsetMinutes(jul, 'Europe/London')).toBe(60)
    expect(zoneOffsetMinutes(jan, 'Australia/Sydney')).toBe(660)
    expect(zoneOffsetMinutes(jul, 'Australia/Sydney')).toBe(600)
  })
  it('formatOffset', () => {
    expect(formatOffset(480)).toBe('+08:00')
    expect(formatOffset(-300)).toBe('-05:00')
    expect(formatOffset(0)).toBe('+00:00')
    expect(formatOffset(570)).toBe('+09:30')
  })
  it('zoneRows 输出对照表（北京行含相对差）', () => {
    // UTC 2026-01-01 00:00 → 北京当日 08:00（周四）、纽约仍在前一天
    const rows = zoneRows(Date.UTC(2026, 0, 1))
    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r]))
    expect(byLabel['北京']).toMatchObject({
      date: '2026-01-01',
      time: '08:00:00',
      weekday: '周四',
      offset: '+08:00',
      delta: '同一时区'
    })
    expect(byLabel['东京']).toMatchObject({ date: '2026-01-01', time: '09:00:00', delta: '+1 小时' })
    expect(byLabel['伦敦']).toMatchObject({ date: '2026-01-01', time: '00:00:00', delta: '-8 小时' })
    expect(byLabel['纽约']).toMatchObject({ date: '2025-12-31', time: '19:00:00', weekday: '周三', delta: '-13 小时' })
    expect(byLabel['悉尼']).toMatchObject({ date: '2026-01-01', time: '11:00:00', delta: '+3 小时' })
  })
})

describe('本地墙上时间 ↔ 时间戳', () => {
  it('标准格式解析（与 Date 构造等价）', () => {
    expect(parseLocalDateTime('2026-01-01T08:00')).toBe(new Date(2026, 0, 1, 8, 0, 0).getTime())
    expect(parseLocalDateTime('2026-01-01 08:30:15')).toBe(new Date(2026, 0, 1, 8, 30, 15).getTime())
    expect(parseLocalDateTime('2026-1-1T8:5')).toBe(new Date(2026, 0, 1, 8, 5, 0).getTime())
  })
  it('闰年判断', () => {
    expect(parseLocalDateTime('2024-02-29T12:00')).toBe(new Date(2024, 1, 29, 12, 0, 0).getTime())
    expect(parseLocalDateTime('2023-02-29T12:00')).toBeNull()
  })
  it('日历非法与非日期串返回 null', () => {
    expect(parseLocalDateTime('2026-02-31T00:00')).toBeNull()
    expect(parseLocalDateTime('2026-13-01T00:00')).toBeNull()
    expect(parseLocalDateTime('2026-01-01T25:00')).toBeNull()
    expect(parseLocalDateTime('not a date')).toBeNull()
    expect(parseLocalDateTime('')).toBeNull()
  })
  it('toDatetimeLocalValue 回填输入框（本机时区）', () => {
    expect(toDatetimeLocalValue(new Date(2026, 0, 1, 8, 5, 3).getTime())).toBe('2026-01-01T08:05')
  })
  it('toDatetimeLocalValue 与 parseLocalDateTime 互逆', () => {
    const ms = new Date(2026, 8, 24, 10, 30, 0).getTime()
    expect(parseLocalDateTime(toDatetimeLocalValue(ms))).toBe(ms)
  })
})

describe('相对时间', () => {
  it('前/后方向与单位换算', () => {
    expect(relativeMs(0, 90, 'minute', 'later')).toBe(5_400_000)
    expect(relativeMs(0, 90, 'minute', 'ago')).toBe(-5_400_000)
    expect(relativeMs(1_000, 2, 'week', 'later')).toBe(1_000 + 1_209_600_000)
    expect(relativeMs(1_000, 3, 'day', 'ago')).toBe(1_000 - 259_200_000)
    expect(relativeMs(1_000, 2, 'hour', 'later')).toBe(1_000 + 7_200_000)
  })
  it('humanizeDistance 分档', () => {
    const now = 1_700_000_000_000
    expect(humanizeDistance(now + 5_000, now)).toBe('刚刚')
    expect(humanizeDistance(now + 5 * 60_000, now)).toBe('5 分钟后')
    expect(humanizeDistance(now - 3 * 3_600_000, now)).toBe('3 小时前')
    expect(humanizeDistance(now + 2 * 86_400_000, now)).toBe('2 天后')
    expect(humanizeDistance(now - 45 * 86_400_000, now)).toBe('45 天前')
    expect(humanizeDistance(now - 400 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
  it('humanizeDistance 分档边界：恰好 10s 出「刚刚」档，10s 整落分钟档', () => {
    const now = 1_700_000_000_000
    expect(humanizeDistance(now + 9_999, now)).toBe('刚刚')
    expect(humanizeDistance(now + 10_000, now)).toBe('0 分钟后')
  })
})

describe('当前时间多格式与 demo 常量', () => {
  it('DEMO_MS 固定为 2026-01-01T00:00:00Z', () => {
    expect(DEMO_MS).toBe(1_767_225_600_000)
    expect(new Date(DEMO_MS).toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })
  it('nowFormats 输出五格式', () => {
    const rows = nowFormats(DEMO_MS)
    expect(rows.map((r) => r.key)).toEqual(['local', 'utc', 'iso', 's', 'ms'])
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(byKey['utc']).toBe('2026-01-01 00:00:00')
    expect(byKey['iso']).toBe('2026-01-01T00:00:00.000Z')
    expect(byKey['s']).toBe('1767225600')
    expect(byKey['ms']).toBe('1767225600000')
    expect(byKey['local']).toBe(formatZoned(DEMO_MS))
  })
})
