/**
 * 待办·番茄钟常驻 backend：计时归主进程（视图切走/窗口隐藏不断秒）、
 * 键位属主划分——backend 只写 timer/pomodoro-log，渲染层只写 todos/settings/timer-cmd，
 * 避免双方对同一 kv.json 的写写竞争（storage 是整文件读改写）。
 */

import type { BackendContext, PluginBackend } from '@sdk/api'
import { CMD_KEY, takeCommand, type TimerCommand } from '../logic/commands'
import {
  DEFAULT_TIMER_SETTINGS,
  IDLE_TIMER_STATE,
  parsePersistedTimer,
  pauseTimer,
  resumeTimer,
  startBreak,
  startFocus,
  stopTimer,
  tickTimer,
  toPersistedTimer,
  type SessionSettings,
  type TimerState
} from '../logic/timer'
import {
  appendEntry,
  emptyLog,
  logContains,
  parsePomodoroLog,
  todayCount,
  todoCounts,
  totalCount,
  type PomodoroEntry,
  type PomodoroLog
} from '../logic/stats'
import { NOTE_HEIGHT, NOTE_WIDTH, buildNoteHtml, noteModelOf } from '../logic/float'
import { dateKeyOf } from '../logic/todos'

export const TICK_MS = 500
/** 统计落盘自愈复查延迟：避开与并发写在同一毫秒窗口互相覆盖 */
export const HEAL_DELAY_MS = 1500
const TIMER_KEY = 'timer'
const LOG_KEY = 'pomodoro-log'
export const TIMER_EVENT = 'timer-changed'

export interface BackendScheduler {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(id: unknown): void
}

export interface BackendClock {
  now(): number
}

const nodeScheduler: BackendScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>)
}
const systemClock: BackendClock = { now: () => Date.now() }

export interface TimerSnapshot {
  state: TimerState
  noteVisible: boolean
  todayCount: number
  totalCount: number
  countsByTodo: Record<string, number>
}

export class TodoPomodoroBackend implements PluginBackend {
  private ctx: BackendContext | null = null
  private state: TimerState = { ...IDLE_TIMER_STATE }
  private session: SessionSettings | null = null
  private noteVisible = true
  private log: PomodoroLog = emptyLog()
  private noteId: string | null = null
  private lastSeq = 0
  private tick: unknown = null
  private heal: { entry: PomodoroEntry; at: number } | null = null

  constructor(
    private readonly scheduler: BackendScheduler = nodeScheduler,
    private readonly clock: BackendClock = systemClock
  ) {}

  async init(ctx: BackendContext): Promise<void> {
    this.ctx = ctx
    await this.restore()
  }

  async start(): Promise<void> {
    if (this.tick !== null) return
    await this.onTick()
    this.tick = this.scheduler.setInterval(() => void this.onTick(), TICK_MS)
  }

  async stop(): Promise<void> {
    if (this.tick !== null) this.scheduler.clearInterval(this.tick)
    this.tick = null
    await this.persistTimer()
  }

  async dispose(): Promise<void> {
    await this.persistTimer()
  }

  snapshot(): TimerSnapshot {
    const today = dateKeyOf(this.clock.now())
    return {
      state: this.state,
      noteVisible: this.noteVisible,
      todayCount: todayCount(this.log, today),
      totalCount: totalCount(this.log),
      countsByTodo: todoCounts(this.log)
    }
  }

  /** 读持久化态并收尾「离开期间到期」的会话（关机/休眠跨过 endAt） */
  private async restore(): Promise<void> {
    try {
      const persisted = parsePersistedTimer(await this.ctx?.storage.get(TIMER_KEY))
      if (persisted !== null) {
        this.state = persisted.state
        this.session = persisted.session
        this.noteVisible = persisted.noteVisible
      }
    } catch {
      // 读失败按空闲启动
    }
    try {
      this.log = parsePomodoroLog(await this.ctx?.storage.get(LOG_KEY)) ?? emptyLog()
    } catch {
      this.log = emptyLog()
    }
    const now = this.clock.now()
    let changed = false
    let guard = 0
    // 恢复场景不做自动休息：离开期间错过的休息时刻已无意义，直接回空闲
    const restoreOpts = { ...(this.session ?? DEFAULT_TIMER_SETTINGS), autoStartBreak: false }
    while (this.state.status === 'running' && guard++ < 4) {
      const prev = this.state
      const r = tickTimer(prev, now, restoreOpts)
      if (r === null) break
      this.state = r.state
      changed = true
      if (r.completed === 'focus') await this.onFocusCompleted(prev, true)
      else await this.onBreakCompleted(true)
      if (this.state.status === 'idle') this.session = null
    }
    // 便签只在有活动会话时随启动恢复；空闲态等用户下次开始（避免每次启动弹窗打扰）
    if (this.state.status !== 'idle') await this.refreshNote()
    if (changed) await this.persistTimer()
    this.emitSnapshot()
  }

  private async onTick(): Promise<void> {
    try {
      await this.pollCommand()
      await this.advance()
      await this.checkHeal()
    } catch {
      // 单轮失败静默放弃，下一轮 500ms 后重试
    }
  }

  private async pollCommand(): Promise<void> {
    if (this.ctx === null) return
    let env
    try {
      env = takeCommand(await this.ctx.storage.get(CMD_KEY), this.lastSeq)
    } catch {
      return
    }
    if (env === null) return
    this.lastSeq = env.seq
    await this.applyCommand(env.cmd)
  }

  private async applyCommand(cmd: TimerCommand): Promise<void> {
    const now = this.clock.now()
    switch (cmd.type) {
      case 'start':
        this.session = { focusMin: cmd.focusMin, breakMin: cmd.breakMin, autoStartBreak: cmd.autoStartBreak }
        this.state = startFocus(this.state, cmd, now)
        break
      case 'pause':
        this.state = pauseTimer(this.state, now)
        break
      case 'resume':
        this.state = resumeTimer(this.state, now)
        break
      case 'stop':
        this.state = stopTimer()
        this.session = null
        break
      case 'skip':
        if (this.state.status !== 'idle') {
          // 跳过不算完成、不记统计
          if (this.state.phase === 'focus') {
            this.state = startBreak(this.state, this.session?.breakMin ?? DEFAULT_TIMER_SETTINGS.breakMin, now)
          } else {
            this.state = stopTimer()
            this.session = null
          }
        }
        break
      case 'note-toggle':
        this.noteVisible = cmd.visible
        await this.afterStateChange(true)
        return
    }
    await this.afterStateChange()
  }

  /** 到期推进；一次 tick 最多收尾两阶段（离开很久时不连环空转） */
  private async advance(): Promise<void> {
    if (this.state.status !== 'running' || this.session === null) return
    const now = this.clock.now()
    let changed = false
    let guard = 0
    while (guard++ < 2) {
      const prev = this.state
      const r = tickTimer(prev, now, this.session)
      if (r === null) break
      this.state = r.state
      changed = true
      if (r.completed === 'focus') await this.onFocusCompleted(prev, false)
      else await this.onBreakCompleted(false)
      if (this.state.status === 'idle') {
        this.session = null
        break
      }
    }
    if (changed) await this.afterStateChange()
  }

  private async onFocusCompleted(prev: TimerState, duringRestore: boolean): Promise<void> {
    const now = this.clock.now()
    const entry: PomodoroEntry = { ts: now, dateKey: dateKeyOf(now), todoId: prev.linkedTodoId }
    this.log = appendEntry(this.log, entry)
    await this.persistLog()
    this.heal = { entry, at: now + HEAL_DELAY_MS }
    const minutes = Math.max(1, Math.round(prev.totalMs / 60_000))
    const head = duringRestore ? '🍅 番茄完成（应用关闭期间已结束）' : '🍅 番茄完成！'
    const body =
      prev.linkedTodoTitle !== ''
        ? `「${prev.linkedTodoTitle}」专注 ${minutes} 分钟完成，休息一下吧`
        : `专注 ${minutes} 分钟完成，休息一下吧`
    await this.notify(head, body)
  }

  private async onBreakCompleted(duringRestore: boolean): Promise<void> {
    const head = duringRestore ? '☕ 休息结束（应用关闭期间已结束）' : '☕ 休息结束'
    await this.notify(head, '回来继续下一个番茄吧')
  }

  private async notify(title: string, body: string): Promise<void> {
    try {
      await this.ctx?.notification.show(title, body)
    } catch {
      // 通知失败不影响计时与统计（Windows 分支本机 darwin 未实测）
    }
  }

  /** 统计写后复查：与渲染层并发写 kv.json 有毫秒级丢写窗口，丢失则重写一次 */
  private async checkHeal(): Promise<void> {
    if (this.heal === null || this.clock.now() < this.heal.at || this.ctx === null) return
    const { entry } = this.heal
    this.heal = null
    try {
      const cur = parsePomodoroLog(await this.ctx.storage.get(LOG_KEY))
      if (cur === null || !logContains(cur, entry)) await this.persistLog()
    } catch {
      // 复查失败放弃（概率极低的单次丢失，不做无限重试）
    }
  }

  private async afterStateChange(forceNote = false): Promise<void> {
    await this.persistTimer()
    await this.refreshNote(forceNote)
    this.emitSnapshot()
  }

  private async refreshNote(force = false): Promise<void> {
    const ctx = this.ctx
    if (ctx === null) return
    const active = this.state.status !== 'idle'
    if (!this.noteVisible || (!active && !force)) {
      if (this.noteId !== null) {
        try {
          await ctx.window.float.close(this.noteId)
        } catch {
          // 已被宿主/用户关掉
        }
        this.noteId = null
      }
      return
    }
    const html = buildNoteHtml(noteModelOf(this.state, todayCount(this.log, dateKeyOf(this.clock.now())), this.clock.now()))
    if (this.noteId === null) {
      try {
        this.noteId = await ctx.window.float.create({
          html,
          width: NOTE_WIDTH,
          height: NOTE_HEIGHT,
          focus: false,
          alwaysOnTop: true,
          title: '番茄钟'
        })
      } catch {
        this.noteId = null
      }
      return
    }
    try {
      await ctx.window.float.update(this.noteId, { html })
    } catch {
      // 用户点 ✕ 关闭后 update 报不存在：视为关闭常驻便签（不再复活打扰）
      this.noteId = null
      this.noteVisible = false
      await this.persistTimer()
      this.emitSnapshot()
    }
  }

  private async persistTimer(): Promise<void> {
    try {
      await this.ctx?.storage.set(
        TIMER_KEY,
        toPersistedTimer(this.state, this.state.status === 'idle' ? null : this.session, this.noteVisible)
      )
    } catch {
      // 写失败保持内存态，下一状态变化重写
    }
  }

  private async persistLog(): Promise<void> {
    try {
      await this.ctx?.storage.set(LOG_KEY, this.log)
    } catch {
      // 同上；heal 复查会兜一次
    }
  }

  private emitSnapshot(): void {
    this.ctx?.emit(TIMER_EVENT, this.snapshot())
  }
}

const backend = new TodoPomodoroBackend()
export default backend
