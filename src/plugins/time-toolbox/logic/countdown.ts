/** 倒计时纯函数层：时长解析、endAt 绝对时刻推进、跨休眠/重启恢复（无状态，backend 与渲染层共用） */

export type CountdownStatus = 'idle' | 'running' | 'paused' | 'expired'

export interface CountdownState {
  status: CountdownStatus
  /** running: 绝对到期时刻（tick/恢复都比对该时刻而非累减，休眠漂移零累积）；其余状态为 0 或留作展示 */
  endAt: number
  /** paused: 冻结的剩余毫秒；其余状态为 0 */
  remainingMs: number
  /** 本次设定总时长（进度与通知文案用） */
  totalMs: number
}

export const IDLE_COUNTDOWN: CountdownState = { status: 'idle', endAt: 0, remainingMs: 0, totalMs: 0 }

/** 单次时长上限 7 天：防溢出，也防超长倒计时被遗忘占用通知 */
export const MAX_DURATION_MS = 7 * 24 * 3_600_000

function clampDuration(ms: number): number | null {
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_DURATION_MS) return null
  return ms
}

/**
 * '90s' / '25m' / '1h30m' / 纯数字（按分钟）→ 毫秒；非法/非正/超 7 天返回 null。
 * 单位可任意组合（h/m/s 各至多一段），允许段间空白。
 */
export function parseDuration(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (s === '') return null
  if (/^\d+$/.test(s)) return clampDuration(Number(s) * 60_000)
  const m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/.exec(s)
  if (m === null || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null
  return clampDuration((Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0)) * 1000)
}

/** backend 命令侧时长校验：渲染层传来的任意值收敛为合法毫秒或 null */
export function clampDurationMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return clampDuration(value)
}

export function startCountdown(durationMs: number, now: number): CountdownState {
  return { status: 'running', endAt: now + durationMs, remainingMs: 0, totalMs: durationMs }
}

export function pauseCountdown(state: CountdownState, now: number): CountdownState {
  if (state.status !== 'running') return state
  return { ...state, status: 'paused', remainingMs: remaining(state.endAt, now) }
}

export function resumeCountdown(state: CountdownState, now: number): CountdownState {
  if (state.status !== 'paused') return state
  return { ...state, status: 'running', endAt: now + state.remainingMs }
}

export function stopCountdown(): CountdownState {
  return { ...IDLE_COUNTDOWN }
}

/** endAt 距 now 的剩余毫秒，已钳 0 */
export function remaining(endAt: number, now: number): number {
  return Math.max(0, endAt - now)
}

export function isExpired(endAt: number, now: number): boolean {
  return now >= endAt
}

/** 单次推进：未到点返回 null（无变化），到点返回 expired 收尾态 */
export function tickCountdown(state: CountdownState, now: number): CountdownState | null {
  if (state.status !== 'running' || !isExpired(state.endAt, now)) return null
  return { ...state, status: 'expired', remainingMs: 0 }
}

/** 跨休眠/跨重启恢复：running 且 endAt 已过 → expired 收尾态；其余原样返回（endAt 是绝对时刻，天然免重算） */
export function restoreSnapshot(state: CountdownState, now: number): CountdownState {
  if (state.status === 'running' && isExpired(state.endAt, now)) {
    return { ...state, status: 'expired', remainingMs: 0 }
  }
  return state
}

/** 持久化状态防御式解析：结构不对返回 null（视为空闲） */
export function parseCountdownState(raw: unknown): CountdownState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const status = o.status
  if (status !== 'idle' && status !== 'running' && status !== 'paused' && status !== 'expired') return null
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0)
  return { status, endAt: num(o.endAt), remainingMs: num(o.remainingMs), totalMs: num(o.totalMs) }
}

/** 渲染层 → backend 命令通道：storage 单槽 + 单调 seq（同 todo-pomodoro「最新者胜」模式） */
export const COUNTDOWN_CMD_KEY = 'countdown-cmd'
export const COUNTDOWN_STATE_KEY = 'countdown'

/** backend → 渲染层状态推送事件名（放 logic 侧，渲染层不必为常量把 backend 单例拖进 bundle） */
export const COUNTDOWN_EVENT = 'countdown-changed'

export type CountdownCommand = { type: 'start'; ms: number } | { type: 'pause' } | { type: 'resume' } | { type: 'stop' }

export interface CountdownCommandEnvelope {
  seq: number
  cmd: CountdownCommand
}

/** 解析命令；seq 不大于 lastSeq（乱序/回放）或结构非法一律忽略 */
export function takeCountdownCommand(raw: unknown, lastSeq: number): CountdownCommandEnvelope | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.seq !== 'number' || !Number.isFinite(r.seq) || r.seq <= lastSeq) return null
  const body = r.cmd
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  switch (b.type) {
    case 'start': {
      const ms = clampDurationMs(b.ms)
      if (ms === null) return null
      return { seq: r.seq, cmd: { type: 'start', ms } }
    }
    case 'pause':
    case 'resume':
    case 'stop':
      return { seq: r.seq, cmd: { type: b.type } }
    default:
      return null
  }
}

/** 毫秒 → 人话时长：'25 分钟' / '1 小时 30 分钟' / '90 秒'（通知与页内文案用） */
export function formatDuration(ms: number): string {
  const totalSec = Math.round(Math.max(0, ms) / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h} 小时`)
  if (m > 0) parts.push(`${m} 分钟`)
  if (s > 0 || parts.length === 0) parts.push(`${s} 秒`)
  return parts.join(' ')
}

/** 剩余毫秒 → 'mm:ss'（满 1 小时 'h:mm:ss'），向上取整让首帧显示满时长 */
export function formatRemaining(ms: number): string {
  const totalSec = Math.ceil(Math.max(0, ms) / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${p2(m)}:${p2(s)}`
}
