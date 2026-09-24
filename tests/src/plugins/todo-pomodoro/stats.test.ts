import { describe, expect, it } from 'vitest'
import {
  MAX_LOG_ENTRIES,
  appendEntry,
  emptyLog,
  logContains,
  parsePomodoroLog,
  todayCount,
  todoCounts,
  totalCount,
  type PomodoroEntry
} from '../../../../src/plugins/todo-pomodoro/logic/stats'

function e(ts: number, todoId: string | null = null, dateKey = '2026-09-24'): PomodoroEntry {
  return { ts, dateKey, todoId }
}

describe('appendEntry / 裁剪', () => {
  it('追加保序', () => {
    let log = emptyLog()
    log = appendEntry(log, e(1, 'a'))
    log = appendEntry(log, e(2, 'b'))
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
    entries: [e(1, 'a', '2026-09-23'), e(2, 'a', '2026-09-24'), e(3, 'b', '2026-09-24'), e(4, null, '2026-09-24')]
  }

  it('todayCount 只数当日', () => {
    expect(todayCount(log, '2026-09-24')).toBe(3)
    expect(todayCount(log, '2026-09-23')).toBe(1)
    expect(todayCount(log, '2026-09-25')).toBe(0)
  })

  it('totalCount / todoCounts', () => {
    expect(totalCount(log)).toBe(4)
    expect(todoCounts(log)).toEqual({ a: 2, b: 1 })
  })

  it('logContains 同 ts 且同 todoId 才算命中', () => {
    expect(logContains(log, e(2, 'a'))).toBe(true)
    expect(logContains(log, e(2, 'b'))).toBe(false)
    expect(logContains(log, e(999, 'a'))).toBe(false)
  })
})

describe('parsePomodoroLog', () => {
  it('结构不对返回 null', () => {
    expect(parsePomodoroLog(null)).toBeNull()
    expect(parsePomodoroLog({})).toBeNull()
    expect(parsePomodoroLog({ entries: 5 })).toBeNull()
  })

  it('坏条目丢弃：非数值 ts、坏 dateKey、非字符串 todoId 归 null', () => {
    const out = parsePomodoroLog({
      v: 1,
      entries: [
        { ts: 1, dateKey: '2026-09-24', todoId: 'a' },
        { ts: 'x', dateKey: '2026-09-24' },
        { ts: 2, dateKey: '2026/09/24' },
        { ts: 3, dateKey: '2026-09-24', todoId: '' },
        'garbage'
      ]
    })!
    expect(out.entries).toEqual([
      { ts: 1, dateKey: '2026-09-24', todoId: 'a' },
      { ts: 3, dateKey: '2026-09-24', todoId: null }
    ])
  })

  it('roundtrip 经 JSON 序列化无损', () => {
    const log = appendEntry(emptyLog(), e(7, 'a', '2026-09-24'))
    expect(parsePomodoroLog(JSON.parse(JSON.stringify(log)))).toEqual(log)
  })
})
