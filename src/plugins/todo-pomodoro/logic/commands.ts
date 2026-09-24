/**
 * 渲染层 → backend 的计时命令通道：storage 单槽 + 单调 seq。
 * backend 只认 seq 更新的命令，渲染层覆盖写「最新者胜」——
 * 500ms 轮询窗口内连点多个命令时，语义上最后一条就是用户当前意图（如连点 开始→停止 只落「停止」）。
 */

import { clampMinutes, DEFAULT_TIMER_SETTINGS } from './timer'

export const CMD_KEY = 'timer-cmd'

export interface StartCommand {
  type: 'start'
  todoId: string | null
  todoTitle: string
  focusMin: number
  breakMin: number
  autoStartBreak: boolean
}

export type TimerCommand =
  | StartCommand
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'skip' }
  | { type: 'note-toggle'; visible: boolean }

export interface CommandEnvelope {
  seq: number
  cmd: TimerCommand
}

function parseCommandBody(raw: unknown): TimerCommand | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  switch (r.type) {
    case 'start':
      return {
        type: 'start',
        todoId: typeof r.todoId === 'string' && r.todoId !== '' ? r.todoId : null,
        todoTitle: typeof r.todoTitle === 'string' ? r.todoTitle.trim().slice(0, 120) : '',
        focusMin: clampMinutes(r.focusMin, DEFAULT_TIMER_SETTINGS.focusMin),
        breakMin: clampMinutes(r.breakMin, DEFAULT_TIMER_SETTINGS.breakMin),
        autoStartBreak: r.autoStartBreak !== false
      }
    case 'pause':
    case 'resume':
    case 'stop':
    case 'skip':
      return { type: r.type }
    case 'note-toggle':
      return { type: 'note-toggle', visible: r.visible === true }
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
