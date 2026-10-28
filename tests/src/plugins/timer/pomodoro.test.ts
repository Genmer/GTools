import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TIMER_SETTINGS,
  IDLE_POMODORO_STATE,
  clampMinutes,
  formatClock,
  normalizeTimerSettings,
  parsePomodoroState,
  pausePomodoro,
  remainingMsOf,
  resumePomodoro,
  startBreak,
  startFocus,
  stopPomodoro,
  tickPomodoro
} from '../../../../src/plugins/timer/logic/pomodoro'

const T0 = 1_700_000_000_000
const MIN = 60_000

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
  it('startFocus 设置 endAt/totalMs 并钳制分钟数', () => {
    const s = startFocus({ focusMin: 30 }, T0)
    expect(s).toEqual({ status: 'running', phase: 'focus', remainingMs: 30 * MIN, endAt: T0 + 30 * MIN, totalMs: 30 * MIN })
  })

  it('startFocus 非法分钟回退 25', () => {
    expect(startFocus({ focusMin: 'bad' as unknown as number }, T0).endAt).toBe(T0 + 25 * MIN)
  })

  it('startBreak 进休息相位并钳制分钟', () => {
    const br = startBreak(IDLE_POMODORO_STATE, 5, T0)
    expect(br.phase).toBe('break')
    expect(br.endAt).toBe(T0 + 5 * MIN)
    expect(startBreak(IDLE_POMODORO_STATE, 0, T0).totalMs).toBe(1 * MIN) // clampMinutes(0) 钳到 1 而非回退
  })
})

describe('pause / resume / stop', () => {
  it('暂停定格剩余、恢复按剩余续跑、非运行态不动', () => {
    const s = startFocus({ focusMin: 25 }, T0)
    const paused = pausePomodoro(s, T0 + 10 * MIN)
    expect(paused.status).toBe('paused')
    expect(paused.endAt).toBeNull()
    expect(paused.remainingMs).toBe(15 * MIN)
    expect(pausePomodoro(paused, T0)).toBe(paused)
    const resumed = resumePomodoro(paused, T0 + 60_000)
    expect(resumed.status).toBe('running')
    expect(resumed.endAt).toBe(T0 + 60_000 + 15 * MIN)
    expect(resumePomodoro(s, T0)).toBe(s)
  })

  it('stop 回空闲', () => {
    expect(stopPomodoro()).toEqual(IDLE_POMODORO_STATE)
  })
})

describe('tickPomodoro 到期推进', () => {
  it('未到期返回 null', () => {
    expect(tickPomodoro(startFocus({ focusMin: 25 }, T0), T0 + MIN, { breakMin: 5, autoStartBreak: true })).toBeNull()
  })

  it('focus 到期 + 自动休息：进入 break 且 completed=focus', () => {
    const r = tickPomodoro(startFocus({ focusMin: 25 }, T0), T0 + 25 * MIN, { breakMin: 5, autoStartBreak: true })!
    expect(r.completed).toBe('focus')
    expect(r.state.status).toBe('running')
    expect(r.state.phase).toBe('break')
    expect(r.state.endAt).toBe(T0 + 25 * MIN + 5 * MIN)
  })

  it('focus 到期 + 不自动休息：回 idle', () => {
    const r = tickPomodoro(startFocus({ focusMin: 25 }, T0), T0 + 25 * MIN, { breakMin: 5, autoStartBreak: false })!
    expect(r.completed).toBe('focus')
    expect(r.state.status).toBe('idle')
  })

  it('break 到期回 idle', () => {
    const br = startBreak(IDLE_POMODORO_STATE, 5, T0)
    const r = tickPomodoro(br, T0 + 5 * MIN + 1, { breakMin: 5, autoStartBreak: true })!
    expect(r.completed).toBe('break')
    expect(r.state.status).toBe('idle')
  })
})

describe('钟面与解析', () => {
  it('remainingMsOf：running 按 endAt 换算且不为负；paused 用定格值', () => {
    const s = startFocus({ focusMin: 25 }, T0)
    expect(remainingMsOf(s, T0 + 5 * MIN)).toBe(20 * MIN)
    expect(remainingMsOf(s, T0 + 30 * MIN)).toBe(0)
    const paused = pausePomodoro(s, T0 + 5 * MIN)
    expect(remainingMsOf(paused, T0 + 99 * MIN)).toBe(20 * MIN)
  })

  it('formatClock：向上取整到秒', () => {
    expect(formatClock(25 * MIN)).toBe('25:00')
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(1500)).toBe('00:02')
    expect(formatClock(5 * MIN - 1)).toBe('05:00')
    expect(formatClock(-100)).toBe('00:00')
  })

  it('parsePomodoroState：roundtrip 无损；running 缺 endAt / 非法结构返回 null', () => {
    const s = pausePomodoro(startFocus({ focusMin: 25 }, T0), T0 + 5 * MIN)
    expect(parsePomodoroState(JSON.parse(JSON.stringify(s)))).toEqual(s)
    expect(parsePomodoroState({ status: 'running', phase: 'focus' })).toBeNull()
    expect(parsePomodoroState('x')).toBeNull()
    expect(parsePomodoroState({ status: 'weird' })).toBeNull()
  })
})
