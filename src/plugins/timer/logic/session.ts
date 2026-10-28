/** backend → 渲染层快照事件名与持久化态解析（渲染层不必为常量把 backend 模块拖进 bundle） */

import { parseCountdownState, type CountdownState } from './countdown'
import { normalizeTimerSettings, parsePomodoroState, type PomodoroState } from './pomodoro'

export const TIMER_EVENT = 'timer-changed'

export interface SessionSettings {
  focusMin: number
  breakMin: number
  autoStartBreak: boolean
}

export interface TimerSnapshot {
  countdown: CountdownState
  pomodoro: PomodoroState
  session: SessionSettings | null
  ballVisible: boolean
  todayCount: number
  totalCount: number
}

export interface PersistedTimerState {
  v: 1
  countdown: CountdownState
  pomodoro: PomodoroState
  session: SessionSettings | null
  ballVisible: boolean
  ballPos: { x: number; y: number } | null
}

function parseBallPos(raw: unknown): { x: number; y: number } | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.x !== 'number' || !Number.isFinite(r.x)) return null
  if (typeof r.y !== 'number' || !Number.isFinite(r.y)) return null
  return { x: r.x, y: r.y }
}

/** 持久化态防御式解析：结构不对返回 null（backend 按空闲/默认态启动） */
export function parsePersistedTimerState(raw: unknown): PersistedTimerState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const countdown = parseCountdownState(r.countdown)
  const pomodoro = parsePomodoroState(r.pomodoro)
  if (countdown === null || pomodoro === null) return null
  return {
    v: 1,
    countdown,
    pomodoro,
    session: pomodoro.status === 'idle' ? null : normalizeTimerSettings(r.session),
    ballVisible: r.ballVisible !== false,
    ballPos: parseBallPos(r.ballPos)
  }
}
