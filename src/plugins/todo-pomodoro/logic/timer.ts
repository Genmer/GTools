/** 番茄钟纯状态机：钟面时间以 endAt 换算，容忍 tick 漂移与系统休眠。 */

export type TimerPhase = 'focus' | 'break'
export type TimerStatus = 'idle' | 'running' | 'paused'

export interface TimerSettings {
  focusMin: number
  breakMin: number
  autoStartBreak: boolean
}

export const DEFAULT_TIMER_SETTINGS: TimerSettings = { focusMin: 25, breakMin: 5, autoStartBreak: true }

export const MIN_MINUTES = 1
export const MAX_MINUTES = 120

export function clampMinutes(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(n)))
}

export function normalizeTimerSettings(raw: unknown): TimerSettings {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    focusMin: clampMinutes(r.focusMin, DEFAULT_TIMER_SETTINGS.focusMin),
    breakMin: clampMinutes(r.breakMin, DEFAULT_TIMER_SETTINGS.breakMin),
    autoStartBreak: r.autoStartBreak !== false
  }
}

export interface TimerState {
  status: TimerStatus
  phase: TimerPhase
  /** paused/idle 定格的剩余毫秒；running 时以 endAt 为准 */
  remainingMs: number
  endAt: number | null
  /** 当前阶段总时长，供进度展示 */
  totalMs: number
  linkedTodoId: string | null
  linkedTodoTitle: string
}

export const IDLE_TIMER_STATE: TimerState = {
  status: 'idle',
  phase: 'focus',
  remainingMs: 0,
  endAt: null,
  totalMs: 0,
  linkedTodoId: null,
  linkedTodoTitle: ''
}

export interface SessionSettings extends TimerSettings {}

export interface StartOptions {
  focusMin: number
  breakMin: number
  autoStartBreak: boolean
  todoId: string | null
  todoTitle: string
}

function titleOf(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().slice(0, 120)
}

export function startFocus(_s: TimerState, opts: StartOptions, now: number): TimerState {
  const focusMin = clampMinutes(opts.focusMin, DEFAULT_TIMER_SETTINGS.focusMin)
  const totalMs = focusMin * 60_000
  return {
    status: 'running',
    phase: 'focus',
    remainingMs: totalMs,
    endAt: now + totalMs,
    totalMs,
    linkedTodoId: typeof opts.todoId === 'string' && opts.todoId !== '' ? opts.todoId : null,
    linkedTodoTitle: titleOf(opts.todoTitle)
  }
}

export function startBreak(s: TimerState, breakMin: number, now: number): TimerState {
  const totalMs = clampMinutes(breakMin, DEFAULT_TIMER_SETTINGS.breakMin) * 60_000
  return {
    status: 'running',
    phase: 'break',
    remainingMs: totalMs,
    endAt: now + totalMs,
    totalMs,
    // 休息期保留关联待办，便签/通知可显示上下文
    linkedTodoId: s.linkedTodoId,
    linkedTodoTitle: s.linkedTodoTitle
  }
}

export function pauseTimer(s: TimerState, now: number): TimerState {
  if (s.status !== 'running' || s.endAt === null) return s
  return { ...s, status: 'paused', remainingMs: Math.max(0, s.endAt - now), endAt: null }
}

export function resumeTimer(s: TimerState, now: number): TimerState {
  if (s.status !== 'paused') return s
  return { ...s, status: 'running', endAt: now + Math.max(0, s.remainingMs) }
}

export function stopTimer(): TimerState {
  return { ...IDLE_TIMER_STATE }
}

export interface TickResult {
  state: TimerState
  /** 本 tick 刚结束的阶段（跳过不算） */
  completed: TimerPhase | null
}

export interface TickOptions {
  breakMin: number
  autoStartBreak: boolean
}

/**
 * 推进计时：未到期返回 null（调用方免写盘/免通知）。
 * focus 结束按 autoStartBreak 决定自动进入 break 或回 idle；break 结束回 idle。
 */
export function tickTimer(s: TimerState, now: number, opts: TickOptions): TickResult | null {
  if (s.status !== 'running' || s.endAt === null || now < s.endAt) return null
  if (s.phase === 'focus') {
    if (opts.autoStartBreak) {
      return { state: startBreak(s, opts.breakMin, now), completed: 'focus' }
    }
    return { state: { ...stopTimer(), linkedTodoId: null, linkedTodoTitle: '' }, completed: 'focus' }
  }
  return { state: { ...stopTimer(), linkedTodoId: null, linkedTodoTitle: '' }, completed: 'break' }
}

export function remainingMsOf(s: TimerState, now: number): number {
  if (s.status === 'running' && s.endAt !== null) return Math.max(0, s.endAt - now)
  return Math.max(0, s.remainingMs)
}

/** 钟面取向上取整：25:00 整段可见，结束瞬间才显示 00:00 */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(m)}:${pad(s)}`
}

export interface PersistedTimer {
  v: 1
  state: TimerState
  /** 会话设置快照（idle 时为 null），重启恢复自动休息等行为 */
  session: SessionSettings | null
  noteVisible: boolean
}

export function toPersistedTimer(state: TimerState, session: SessionSettings | null, noteVisible: boolean): PersistedTimer {
  return { v: 1, state, session, noteVisible }
}

function parseState(raw: unknown): TimerState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const status = r.status
  if (status !== 'idle' && status !== 'running' && status !== 'paused') return null
  const phase = r.phase === 'break' ? 'break' : 'focus'
  const endAt = typeof r.endAt === 'number' && Number.isFinite(r.endAt) ? r.endAt : null
  if (status === 'running' && endAt === null) return null
  return {
    status,
    phase,
    remainingMs: typeof r.remainingMs === 'number' && Number.isFinite(r.remainingMs) ? Math.max(0, r.remainingMs) : 0,
    endAt,
    totalMs: typeof r.totalMs === 'number' && Number.isFinite(r.totalMs) ? Math.max(0, r.totalMs) : 0,
    linkedTodoId: typeof r.linkedTodoId === 'string' && r.linkedTodoId !== '' ? r.linkedTodoId : null,
    linkedTodoTitle: titleOf(r.linkedTodoTitle)
  }
}

/** 解析持久化计时态；结构非法返回 null（按空闲启动） */
export function parsePersistedTimer(raw: unknown): PersistedTimer | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const state = parseState(r.state)
  if (state === null) return null
  const session = state.status === 'idle' ? null : normalizeTimerSettings(r.session)
  return { v: 1, state, session, noteVisible: r.noteVisible !== false }
}
