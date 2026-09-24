import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_SETTINGS,
  IDLE_TIMER_STATE,
  clampMinutes,
  formatClock,
  normalizeTimerSettings,
  parsePersistedTimer,
  pauseTimer,
  remainingMsOf,
  resumeTimer,
  startBreak,
  startFocus,
  stopTimer,
  tickTimer,
  toPersistedTimer
} from '../../../../src/plugins/todo-pomodoro/logic/timer'

const T0 = 1_700_000_000_000
const MIN = 60_000

const opts = { focusMin: 25, breakMin: 5, autoStartBreak: true, todoId: null, todoTitle: '' }

describe('设置与钳制', () => {
  it('clampMinutes：非法回退、越界钳制、四舍五入', () => {
    expect(clampMinutes(NaN, 25)).toBe(25)
    expect(clampMinutes('x', 25)).toBe(25)
    expect(clampMinutes(0, 25)).toBe(1)
    expect(clampMinutes(-3, 25)).toBe(1)
    expect(clampMinutes(999, 25)).toBe(120)
    expect(clampMinutes(25.4, 25)).toBe(25)
    expect(clampMinutes(25.6, 25)).toBe(26)
  })

  it('normalizeTimerSettings：默认、部分覆盖、autoStartBreak 仅 false 关闭', () => {
    expect(normalizeTimerSettings(null)).toEqual(DEFAULT_TIMER_SETTINGS)
    expect(normalizeTimerSettings({ focusMin: 50 })).toEqual({ focusMin: 50, breakMin: 5, autoStartBreak: true })
    expect(normalizeTimerSettings({ autoStartBreak: false }).autoStartBreak).toBe(false)
    expect(normalizeTimerSettings({ autoStartBreak: 'no' }).autoStartBreak).toBe(true)
  })
})

describe('startFocus / startBreak', () => {
  it('startFocus 设置 endAt/totalMs/关联待办，并钳制分钟数与标题', () => {
    const s = startFocus(IDLE_TIMER_STATE, { ...opts, focusMin: 30, todoId: 't1', todoTitle: '  写周报  ' }, T0)
    expect(s.status).toBe('running')
    expect(s.phase).toBe('focus')
    expect(s.endAt).toBe(T0 + 30 * MIN)
    expect(s.totalMs).toBe(30 * MIN)
    expect(s.linkedTodoId).toBe('t1')
    expect(s.linkedTodoTitle).toBe('写周报')
  })

  it('startFocus 非法分钟回退 25；空 todoId 归一为 null', () => {
    const s = startFocus(IDLE_TIMER_STATE, { ...opts, focusMin: 'bad' as unknown as number, todoId: '' }, T0)
    expect(s.endAt).toBe(T0 + 25 * MIN)
    expect(s.linkedTodoId).toBeNull()
  })

  it('startBreak 保留关联待办上下文', () => {
    const focus = startFocus(IDLE_TIMER_STATE, { ...opts, todoId: 't1', todoTitle: 'x' }, T0)
    const br = startBreak(focus, 5, T0)
    expect(br.phase).toBe('break')
    expect(br.endAt).toBe(T0 + 5 * MIN)
    expect(br.linkedTodoId).toBe('t1')
  })
})

describe('pause / resume / stop', () => {
  it('暂停定格剩余、恢复按剩余续跑、非运行态不动', () => {
    const s = startFocus(IDLE_TIMER_STATE, opts, T0)
    const paused = pauseTimer(s, T0 + 10 * MIN)
    expect(paused.status).toBe('paused')
    expect(paused.endAt).toBeNull()
    expect(paused.remainingMs).toBe(15 * MIN)
    expect(pauseTimer(paused, T0)).toBe(paused)
    const resumed = resumeTimer(paused, T0 + 60_000)
    expect(resumed.status).toBe('running')
    expect(resumed.endAt).toBe(T0 + 60_000 + 15 * MIN)
    expect(resumeTimer(s, T0)).toBe(s)
  })

  it('stop 回空闲并清关联', () => {
    const s = stopTimer()
    expect(s.status).toBe('idle')
    expect(s.endAt).toBeNull()
  })
})

describe('tickTimer 到期推进', () => {
  it('未到期返回 null', () => {
    const s = startFocus(IDLE_TIMER_STATE, opts, T0)
    expect(tickTimer(s, T0 + MIN, { breakMin: 5, autoStartBreak: true })).toBeNull()
  })

  it('focus 到期 + 自动休息：进入 break 且 completed=focus', () => {
    const s = startFocus(IDLE_TIMER_STATE, opts, T0)
    const r = tickTimer(s, T0 + 25 * MIN, { breakMin: 5, autoStartBreak: true })!
    expect(r.completed).toBe('focus')
    expect(r.state.status).toBe('running')
    expect(r.state.phase).toBe('break')
    expect(r.state.endAt).toBe(T0 + 25 * MIN + 5 * MIN)
  })

  it('focus 到期 + 不自动休息：回 idle 且清空关联', () => {
    const s = startFocus(IDLE_TIMER_STATE, { ...opts, todoId: 't1', todoTitle: 'x' }, T0)
    const r = tickTimer(s, T0 + 25 * MIN, { breakMin: 5, autoStartBreak: false })!
    expect(r.completed).toBe('focus')
    expect(r.state.status).toBe('idle')
    expect(r.state.linkedTodoId).toBeNull()
  })

  it('break 到期回 idle', () => {
    const br = startBreak(IDLE_TIMER_STATE, 5, T0)
    const r = tickTimer(br, T0 + 5 * MIN + 1, { breakMin: 5, autoStartBreak: true })!
    expect(r.completed).toBe('break')
    expect(r.state.status).toBe('idle')
  })
})

describe('钟面', () => {
  it('remainingMsOf：running 按 endAt 换算且不为负；paused 用定格值', () => {
    const s = startFocus(IDLE_TIMER_STATE, opts, T0)
    expect(remainingMsOf(s, T0 + 5 * MIN)).toBe(20 * MIN)
    expect(remainingMsOf(s, T0 + 30 * MIN)).toBe(0)
    const paused = pauseTimer(s, T0 + 5 * MIN)
    expect(remainingMsOf(paused, T0 + 99 * MIN)).toBe(20 * MIN)
  })

  it('formatClock：向上取整到秒', () => {
    expect(formatClock(25 * MIN)).toBe('25:00')
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(1500)).toBe('00:02')
    expect(formatClock(5 * MIN - 1)).toBe('05:00')
    expect(formatClock(-100)).toBe('00:00')
  })
})

describe('持久化解析', () => {
  it('roundtrip：running 会话带 session 快照与 noteVisible', () => {
    const s = startFocus(IDLE_TIMER_STATE, { ...opts, focusMin: 30 }, T0)
    const persisted = toPersistedTimer(s, { focusMin: 30, breakMin: 5, autoStartBreak: false }, false)
    const back = parsePersistedTimer(JSON.parse(JSON.stringify(persisted)))!
    expect(back.state).toEqual(s)
    expect(back.session).toEqual({ focusMin: 30, breakMin: 5, autoStartBreak: false })
    expect(back.noteVisible).toBe(false)
  })

  it('idle 会话 session 为 null；noteVisible 缺省 true', () => {
    const back = parsePersistedTimer(toPersistedTimer(IDLE_TIMER_STATE, null, true))!
    expect(back.session).toBeNull()
    expect(back.state.status).toBe('idle')
    expect(back.noteVisible).toBe(true)
  })

  it('running 缺 endAt 或结构非法返回 null', () => {
    expect(parsePersistedTimer({ v: 1, state: { status: 'running', phase: 'focus' } })).toBeNull()
    expect(parsePersistedTimer('x')).toBeNull()
    expect(parsePersistedTimer({ v: 1, state: { status: 'weird' } })).toBeNull()
  })
})
