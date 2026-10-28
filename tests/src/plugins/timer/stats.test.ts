import { describe, expect, it } from 'vitest'
import {
  MAX_LOG_ENTRIES,
  appendEntry,
  dateKeyOf,
  emptyLog,
  logContains,
  parsePomodoroLog,
  todayCount,
  totalCount,
  type PomodoroEntry
} from '../../../../src/plugins/timer/logic/stats'

function e(ts: number, dateKey = '2026-09-24'): PomodoroEntry {
  return { ts, dateKey }
}

describe('appendEntry / 裁剪', () => {
  it('追加保序', () => {
    let log = emptyLog()
    log = appendEntry(log, e(1))
    log = appendEntry(log, e(2))
    expect(log.entries.map((x) => x.ts)).toEqual([1, 2])
  })

  it('超过上限按 ts 保留最新', () => {
    let log = emptyLog()
    for (let i = 0; i < MAX_LOG_ENTRIES; i++) log = appendEntry(log, e(i))
    expect(log.entries.length).toBe(MAX_LOG_ENTRIES)
    log = appendEntry(log, e(999_999))
    expect(log.entries.length).toBe(MAX_LOG_ENTRIES)
    expect(log.entries[0]!.ts).toBe(1)
    expect(log.entries[MAX_LOG_ENTRIES - 1]!.ts).toBe(999_999)
  })
})

describe('派生统计', () => {
  const log = {
    v: 1 as const,
    entries: [e(1, '2026-09-23'), e(2, '2026-09-24'), e(3, '2026-09-24'), e(4, '2026-09-24')]
  }

  it('todayCount 只数当日', () => {
    expect(todayCount(log, '2026-09-24')).toBe(3)
    expect(todayCount(log, '2026-09-23')).toBe(1)
    expect(todayCount(log, '2026-09-25')).toBe(0)
  })

  it('totalCount', () => {
    expect(totalCount(log)).toBe(4)
  })

  it('logContains 按 ts 比对（旧日志含多余字段也兼容）', () => {
    expect(logContains(log, e(2))).toBe(true)
    expect(logContains(log, e(999))).toBe(false)
  })
})

describe('parsePomodoroLog', () => {
  it('结构不对返回 null', () => {
    expect(parsePomodoroLog(null)).toBeNull()
    expect(parsePomodoroLog({})).toBeNull()
    expect(parsePomodoroLog({ entries: 5 })).toBeNull()
  })

  it('坏条目丢弃：非数值 ts、坏 dateKey；旧格式残留 todoId 字段忽略', () => {
    const out = parsePomodoroLog({
      v: 1,
      entries: [
        { ts: 1, dateKey: '2026-09-24' },
        { ts: 'x', dateKey: '2026-09-24' },
        { ts: 2, dateKey: '2026/09/24' },
        { ts: 3, dateKey: '2026-09-24', todoId: 't1' },
        'garbage'
      ]
    })!
    expect(out.entries).toEqual([{ ts: 1, dateKey: '2026-09-24' }, { ts: 3, dateKey: '2026-09-24' }])
  })

  it('roundtrip 经 JSON 序列化无损', () => {
    const log = appendEntry(emptyLog(), e(7, '2026-09-24'))
    expect(parsePomodoroLog(JSON.parse(JSON.stringify(log)))).toEqual(log)
  })
})

describe('dateKeyOf', () => {
  it('本地时区 YYYY-MM-DD', () => {
    const d = new Date(2026, 8, 24, 23, 59, 59)
    expect(dateKeyOf(d.getTime())).toBe('2026-09-24')
    const d2 = new Date(2026, 0, 1, 0, 0, 0)
    expect(dateKeyOf(d2.getTime())).toBe('2026-01-01')
  })
})
