/**
 * 计时器常驻 backend（倒计时 + 番茄钟单会话互斥）：计时归主进程（视图切走/窗口隐藏不断秒），
 * 到点通知必须主进程驱动（渲染层 timer 被 Chromium 节流）。
 * 键位属主划分——backend 只写 timer-state/pomodoro-log，渲染层只写 settings/cmd，
 * 避免双方对同一 kv.json 的写写竞争（storage 是整文件读改写）。
 */

import type { BackendContext, PluginBackend } from '@sdk/api'
import { CMD_KEY, takeCommand, type TimerPluginCommand } from '../logic/commands'
import {
  pauseCountdown,
  restoreSnapshot,
  resumeCountdown,
  startCountdown,
  stopCountdown,
  tickCountdown,
  formatDuration,
  type CountdownState
} from '../logic/countdown'
import {
  DEFAULT_TIMER_SETTINGS,
  IDLE_POMODORO_STATE,
  pausePomodoro,
  resumePomodoro,
  startBreak,
  startFocus,
  stopPomodoro,
  tickPomodoro,
  type PomodoroState
} from '../logic/pomodoro'
import {
  appendEntry,
  dateKeyOf,
  emptyLog,
  logContains,
  parsePomodoroLog,
  todayCount,
  totalCount,
  type PomodoroEntry,
  type PomodoroLog
} from '../logic/stats'
import { TIMER_EVENT, parsePersistedTimerState, type SessionSettings, type TimerSnapshot } from '../logic/session'
import { BALL_SIZE, ballModelOf, buildBallHtml } from '../logic/ball-html'

export const TICK_MS = 500
/**
 * 空闲档轮询周期：storage 是协议内唯一渲染层→backend 命令通道，
 * 空闲期不能全停否则丢 start 命令，降频到 1s 只兜命令接续（get 命中主进程内存缓存，零盘读）。
 */
export const IDLE_POLL_MS = 1000
/** 统计落盘自愈复查延迟：避开与并发写在同一毫秒窗口互相覆盖 */
export const HEAL_DELAY_MS = 1500
/** 倒计时到点后悬浮球自动收起延迟（自动收 ≠ 用户关，ballVisible 保持 true） */
export const BALL_AUTO_CLOSE_MS = 8000
const STATE_KEY = 'timer-state'
const LOG_KEY = 'pomodoro-log'

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

export class TimerBackend implements PluginBackend {
  private ctx: BackendContext | null = null
  private countdown: CountdownState = { status: 'idle', endAt: 0, remainingMs: 0, totalMs: 0, label: '' }
  private pomodoro: PomodoroState = { ...IDLE_POMODORO_STATE }
  private session: SessionSettings | null = null
  private ballVisible = true
  private ballPos: { x: number; y: number } | null = null
  private log: PomodoroLog = emptyLog()
  private ballId: string | null = null
  private autoCloseAt: number | null = null
  private lastSeq = 0
  private tick: unknown = null
  private tickMs = 0
  private gen = 0
  private heal: { entry: PomodoroEntry; at: number } | null = null
  private offFloatEvent: (() => void) | null = null

  constructor(
    private readonly scheduler: BackendScheduler = nodeScheduler,
    private readonly clock: BackendClock = systemClock
  ) {}

  async init(ctx: BackendContext): Promise<void> {
    this.ctx = ctx
    await this.restore()
    await this.adoptCommandBaseline()
    // T6 后球事件直达 backend（轻点/双击/位置上报），直改状态不走命令槽
    this.offFloatEvent?.()
    this.offFloatEvent = ctx.events.on('float-event', (p) => {
      void this.onFloatEvent(p)
    })
  }

  async start(): Promise<void> {
    if (this.tick !== null) return
    // onTick 尾部按当前状态挂对应档位的 interval
    await this.onTick()
  }

  async stop(): Promise<void> {
    this.gen++ // 在途 onTick 的尾部不再重挂 interval
    if (this.tick !== null) this.scheduler.clearInterval(this.tick)
    this.tick = null
    this.tickMs = 0
    // 停用时宿主已关掉本插件全部浮窗：陈旧 ballId 会让重启用后的 update 报「不存在」
    // 被误判成用户✕（宿主关 ≠ 用户关），重新 start 后由 refreshBall 按活跃态重建球
    this.ballId = null
    await this.persist()
  }

  async dispose(): Promise<void> {
    await this.persist()
  }

  snapshot(): TimerSnapshot {
    const today = dateKeyOf(this.clock.now())
    return {
      countdown: this.countdown,
      pomodoro: this.pomodoro,
      session: this.session,
      ballVisible: this.ballVisible,
      todayCount: todayCount(this.log, today),
      totalCount: totalCount(this.log)
    }
  }

  /** 读持久化态并收尾「离开期间到期」的会话（关机/休眠跨过 endAt） */
  private async restore(): Promise<void> {
    try {
      const persisted = parsePersistedTimerState(await this.ctx?.storage.get(STATE_KEY))
      if (persisted !== null) {
        this.countdown = persisted.countdown
        this.pomodoro = persisted.pomodoro
        this.session = persisted.session
        this.ballVisible = persisted.ballVisible
        this.ballPos = persisted.ballPos
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
    // 倒计时：running 且 endAt 已过 → expired 收尾态（收尾态已落盘，补发通知只此一次）
    const expiredDuringDowntimeStart = this.countdown.status === 'running'
    const nextCd = restoreSnapshot(this.countdown, now)
    if (nextCd !== this.countdown) {
      this.countdown = nextCd
      changed = true
    }
    const expiredDuringDowntime = expiredDuringDowntimeStart && this.countdown.status === 'expired'
    // 番茄：恢复场景不做自动休息（离开期间错过的休息时刻已无意义），focus 完成照记日志
    const restoreOpts = { ...(this.session ?? DEFAULT_TIMER_SETTINGS), autoStartBreak: false }
    let guard = 0
    while (this.pomodoro.status === 'running' && guard++ < 4) {
      const prev = this.pomodoro
      const r = tickPomodoro(prev, now, restoreOpts)
      if (r === null) break
      this.pomodoro = r.state
      changed = true
      if (r.completed === 'focus') await this.onFocusCompleted(prev, true)
      else await this.onBreakCompleted(true)
      if (this.pomodoro.status === 'idle') this.session = null
    }
    // 球只在有活动会话时随启动恢复；空闲态等用户下次开始（避免每次启动弹球打扰）
    const active = this.countdown.status !== 'idle' || this.pomodoro.status !== 'idle'
    if (active) await this.refreshBall()
    if (expiredDuringDowntime) {
      await this.notify('⏰ 倒计时已结束（应用离开期间到期）', this.countdownBody(this.countdown))
      if (this.ballId !== null) this.autoCloseAt = now + BALL_AUTO_CLOSE_MS
    }
    if (changed) await this.persist()
    this.emitSnapshot()
  }

  /**
   * 重启/重启用防重放：命令槽不清理、lastSeq 只在内存，init 不采纳存量 seq 的话
   * start() 首轮 poll 会重放上次会话遗留的命令（幽灵计时）。渲染层 seq 取 Date.now()，
   * 只认基线之后的新命令即封死重放。
   */
  private async adoptCommandBaseline(): Promise<void> {
    try {
      const env = takeCommand(await this.ctx?.storage.get(CMD_KEY), Number.NEGATIVE_INFINITY)
      if (env !== null) this.lastSeq = env.seq
    } catch {
      // 读失败保持 0 基线
    }
  }

  private async onTick(): Promise<void> {
    const g = this.gen
    try {
      await this.pollCommand()
      await this.advance()
      await this.checkHeal()
      await this.checkBallAutoClose()
    } catch {
      // 单轮失败静默放弃，下一轮重试
    }
    if (g === this.gen) this.syncInterval() // stop 与本轮并发时不重挂
  }

  /** 轮询分档：活跃会话（含暂停）、expired 展示期（待自动收球）与统计自愈复查期走 500ms，空闲降 1s */
  private syncInterval(): void {
    const active =
      this.countdown.status === 'running' ||
      this.countdown.status === 'paused' ||
      (this.countdown.status === 'expired' && this.autoCloseAt !== null) ||
      this.pomodoro.status !== 'idle' ||
      this.heal !== null
    const ms = active ? TICK_MS : IDLE_POLL_MS
    if (this.tick !== null && this.tickMs === ms) return
    if (this.tick !== null) this.scheduler.clearInterval(this.tick)
    this.tick = this.scheduler.setInterval(() => void this.onTick(), ms)
    this.tickMs = ms
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

  private async applyCommand(cmd: TimerPluginCommand): Promise<void> {
    const now = this.clock.now()
    switch (cmd.type) {
      case 'cd-start':
        // 单会话互斥：新倒计时无条件顶掉番茄
        this.pomodoro = stopPomodoro()
        this.session = null
        this.countdown = startCountdown(cmd.ms, cmd.label, now)
        // 上一会话遗留的到点收球定时作废，否则 8s 后会把新倒计时的球错关
        this.autoCloseAt = null
        break
      case 'pm-start':
        this.countdown = stopCountdown()
        this.autoCloseAt = null
        this.session = { focusMin: cmd.focusMin, breakMin: cmd.breakMin, autoStartBreak: cmd.autoStartBreak }
        this.pomodoro = startFocus({ focusMin: cmd.focusMin }, now)
        break
      case 'pause':
      case 'resume':
        // 作用于「当前活跃的那个会话」：倒计时非 idle 优先（互斥下至多一个活跃）
        if (this.countdown.status !== 'idle') {
          this.countdown = cmd.type === 'pause' ? pauseCountdown(this.countdown, now) : resumeCountdown(this.countdown, now)
        } else {
          this.pomodoro = cmd.type === 'pause' ? pausePomodoro(this.pomodoro, now) : resumePomodoro(this.pomodoro, now)
        }
        break
      case 'stop':
        this.countdown = stopCountdown()
        this.pomodoro = stopPomodoro()
        this.session = null
        this.autoCloseAt = null
        break
      case 'skip':
        // skip 仅番茄有语义（跳相不计统计）；倒计时活跃时等同 stop
        if (this.pomodoro.status !== 'idle') {
          if (this.pomodoro.phase === 'focus') {
            this.pomodoro = startBreak(this.pomodoro, this.session?.breakMin ?? DEFAULT_TIMER_SETTINGS.breakMin, now)
          } else {
            this.pomodoro = stopPomodoro()
            this.session = null
          }
        } else if (this.countdown.status !== 'idle') {
          this.countdown = stopCountdown()
          this.autoCloseAt = null
        }
        break
      case 'ball-toggle':
        this.ballVisible = cmd.visible
        await this.afterStateChange(true)
        return
    }
    await this.afterStateChange()
  }

  /** 到期推进：倒计时一次收尾；番茄一次 tick 最多收尾两阶段（离开很久时不连环空转） */
  private async advance(): Promise<void> {
    const now = this.clock.now()
    let changed = false
    const nextCd = tickCountdown(this.countdown, now)
    if (nextCd !== null) {
      this.countdown = nextCd
      changed = true
      await this.notify('⏰ 倒计时时间到', this.countdownBody(this.countdown))
      if (this.ballId !== null) this.autoCloseAt = now + BALL_AUTO_CLOSE_MS
    }
    let guard = 0
    while (this.pomodoro.status === 'running' && this.session !== null && guard++ < 2) {
      const prev = this.pomodoro
      const r = tickPomodoro(prev, now, this.session)
      if (r === null) break
      this.pomodoro = r.state
      changed = true
      if (r.completed === 'focus') await this.onFocusCompleted(prev, false)
      else await this.onBreakCompleted(false)
      if (this.pomodoro.status === 'idle') {
        this.session = null
        break
      }
    }
    if (changed) await this.afterStateChange()
  }

  private countdownBody(s: CountdownState): string {
    const dur = formatDuration(s.totalMs)
    return s.label !== '' ? `「${s.label}」设定的 ${dur} 已到` : `设定的 ${dur} 已到`
  }

  private async onFocusCompleted(prev: PomodoroState, duringRestore: boolean): Promise<void> {
    const now = this.clock.now()
    const entry: PomodoroEntry = { ts: now, dateKey: dateKeyOf(now) }
    this.log = appendEntry(this.log, entry)
    await this.persistLog()
    this.heal = { entry, at: now + HEAL_DELAY_MS }
    const minutes = Math.max(1, Math.round(prev.totalMs / 60_000))
    const head = duringRestore ? '🍅 番茄完成（应用关闭期间已结束）' : '🍅 番茄完成！'
    await this.notify(head, `专注 ${minutes} 分钟完成，休息一下吧`)
  }

  private async onBreakCompleted(duringRestore: boolean): Promise<void> {
    const head = duringRestore ? '☕ 休息结束（应用关闭期间已结束）' : '☕ 休息结束'
    await this.notify(head, '回来继续下一个番茄吧')
  }

  private async notify(title: string, body: string): Promise<void> {
    try {
      await this.ctx?.notification.show(title, body)
    } catch {
      // 通知失败不影响计时与统计
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

  /** 到点展示期满自动收球：ballId 清空但 ballVisible 保持 true（自动收 ≠ 用户关，下次 start 重新出球） */
  private async checkBallAutoClose(): Promise<void> {
    if (this.autoCloseAt === null || this.clock.now() < this.autoCloseAt) return
    this.autoCloseAt = null
    if (this.ballId !== null) {
      try {
        await this.ctx?.window.float.close(this.ballId)
      } catch {
        // 已被宿主/用户关掉
      }
      this.ballId = null
    }
    await this.persist()
    this.emitSnapshot()
  }

  private async afterStateChange(forceBall = false): Promise<void> {
    await this.persist()
    await this.refreshBall(forceBall)
    this.emitSnapshot()
  }

  private async refreshBall(force = false): Promise<void> {
    const ctx = this.ctx
    if (ctx === null) return
    const activeBall = this.countdown.status !== 'idle' || this.pomodoro.status !== 'idle'
    if (!this.ballVisible || (!activeBall && !force)) {
      if (this.ballId !== null) {
        try {
          await ctx.window.float.close(this.ballId)
        } catch {
          // 已被宿主/用户关掉
        }
        this.ballId = null
      }
      return
    }
    const model = ballModelOf(this.countdown, this.pomodoro, todayCount(this.log, dateKeyOf(this.clock.now())), this.clock.now())
    if (model === null) return // 双 idle 无内容可展示（空闲态强开球等下次会话起效）
    const html = buildBallHtml(model)
    if (this.ballId === null) {
      try {
        this.ballId = await ctx.window.float.create({
          html,
          width: BALL_SIZE,
          height: BALL_SIZE,
          x: this.ballPos?.x,
          y: this.ballPos?.y,
          transparent: true,
          alwaysOnTop: true,
          focus: false,
          resizable: false,
          title: '计时器'
        })
      } catch {
        this.ballId = null
      }
      return
    }
    try {
      await ctx.window.float.update(this.ballId, { html })
    } catch {
      // 用户点 ✕ 关闭后 update 报不存在：视为关闭悬浮球（不再复活打扰）
      this.ballId = null
      this.ballVisible = false
      this.autoCloseAt = null
      await this.persist()
      this.emitSnapshot()
    }
  }

  /** 球事件直达（不走命令槽）：轻点切换暂停/继续、双击回主面板、位置上报持久化 */
  private async onFloatEvent(raw: unknown): Promise<void> {
    if (typeof raw !== 'object' || raw === null) return
    const p = raw as { event?: unknown; payload?: unknown }
    if (p.event === 'ball-action') {
      const action = (p.payload as { action?: unknown } | null | undefined)?.action
      const now = this.clock.now()
      if (this.countdown.status !== 'idle') {
        if (action === 'dblclick') {
          await this.showMain('countdown')
          return
        }
        if (action === 'click') {
          if (this.countdown.status === 'running') this.countdown = pauseCountdown(this.countdown, now)
          else if (this.countdown.status === 'paused') this.countdown = resumeCountdown(this.countdown, now)
          else {
            // expired：轻点即收尾
            this.countdown = stopCountdown()
            this.autoCloseAt = null
          }
          await this.afterStateChange()
        }
        return
      }
      if (this.pomodoro.status !== 'idle') {
        if (action === 'dblclick') {
          await this.showMain('pomodoro')
          return
        }
        if (action === 'click') {
          if (this.pomodoro.status === 'running') this.pomodoro = pausePomodoro(this.pomodoro, now)
          else if (this.pomodoro.status === 'paused') this.pomodoro = resumePomodoro(this.pomodoro, now)
          await this.afterStateChange()
        }
        return
      }
      return
    }
    if (p.event === 'ball-pos') {
      const pos = p.payload as { x?: unknown; y?: unknown } | null | undefined
      if (pos === null || typeof pos !== 'object') return
      if (typeof pos.x !== 'number' || !Number.isFinite(pos.x)) return
      if (typeof pos.y !== 'number' || !Number.isFinite(pos.y)) return
      if (this.ballPos !== null && this.ballPos.x === pos.x && this.ballPos.y === pos.y) return
      this.ballPos = { x: pos.x, y: pos.y }
      await this.persist() // 位置变化不 emitSnapshot（不影响页面态）
    }
  }

  private async showMain(commandId: 'countdown' | 'pomodoro'): Promise<void> {
    try {
      await this.ctx?.window.showMain({ pluginId: 'timer', commandId })
    } catch {
      // 权限缺失/窗口异常不致崩（球上其余交互不受影响）
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.ctx?.storage.set(STATE_KEY, {
        v: 1,
        countdown: this.countdown,
        pomodoro: this.pomodoro,
        session: this.session,
        ballVisible: this.ballVisible,
        ballPos: this.ballPos
      })
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

const backend = new TimerBackend()
export default backend
