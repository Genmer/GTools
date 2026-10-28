/**
 * 渲染层 → backend 的统一命令槽（storage 单槽 + 单调 seq，倒计时与番茄钟共用）。
 * backend 只认 seq 更新的命令，渲染层覆盖写「最新者胜」——
 * 轮询窗口内连点多个命令时，语义上最后一条就是用户当前意图（如连点 开始→停止 只落「停止」）。
 */

import { clampDurationMs } from './countdown'
import { clampMinutes, DEFAULT_TIMER_SETTINGS } from './pomodoro'

export const CMD_KEY = 'cmd'

export type TimerPluginCommand =
  | { type: 'cd-start'; ms: number; label: string }
  | { type: 'pm-start'; focusMin: number; breakMin: number; autoStartBreak: boolean }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'skip' }
  | { type: 'ball-toggle'; visible: boolean }

export interface CommandEnvelope {
  seq: number
  cmd: TimerPluginCommand
}

function parseCommandBody(raw: unknown): TimerPluginCommand | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  switch (r.type) {
    case 'cd-start': {
      const ms = clampDurationMs(r.ms)
      if (ms === null) return null
      return {
        type: 'cd-start',
        ms,
        label: typeof r.label === 'string' ? r.label.trim().slice(0, 120) : ''
      }
    }
    case 'pm-start':
      return {
        type: 'pm-start',
        focusMin: clampMinutes(r.focusMin, DEFAULT_TIMER_SETTINGS.focusMin),
        breakMin: clampMinutes(r.breakMin, DEFAULT_TIMER_SETTINGS.breakMin),
        autoStartBreak: r.autoStartBreak !== false
      }
    case 'pause':
    case 'resume':
    case 'stop':
    case 'skip':
      return { type: r.type }
    case 'ball-toggle':
      return { type: 'ball-toggle', visible: r.visible === true }
    default:
      return null
  }
}

/** 解析 storage 里的命令；seq 不大于 lastSeq（含乱序/回放）或结构非法一律忽略 */
export function takeCommand(raw: unknown, lastSeq: number): CommandEnvelope | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.seq !== 'number' || !Number.isFinite(r.seq) || r.seq <= lastSeq) return null
  const cmd = parseCommandBody(r.cmd)
  if (cmd === null) return null
  return { seq: r.seq, cmd }
}
