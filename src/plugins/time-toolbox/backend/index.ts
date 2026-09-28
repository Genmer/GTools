/**
 * 倒计时常驻 backend：到点通知必须主进程驱动——窗口隐藏后渲染层 timer 被 Chromium 节流到
 * 最低 1 次/分钟（DESIGN 4.3），渲染层只负责展示与下发命令（storage 命令槽，seq 单调最新者胜）。
 */
import type { BackendContext, PluginBackend } from '@sdk/api'
import {
  COUNTDOWN_CMD_KEY,
  COUNTDOWN_EVENT,
  COUNTDOWN_STATE_KEY,
  IDLE_COUNTDOWN,
  formatDuration,
  parseCountdownState,
  pauseCountdown,
  restoreSnapshot,
  resumeCountdown,
  startCountdown,
  stopCountdown,
  takeCountdownCommand,
  tickCountdown,
  type CountdownCommand,
  type CountdownState
} from '../logic/countdown'

export const COUNTDOWN_TICK_MS = 500

export interface CountdownScheduler {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(id: unknown): void
}

export interface CountdownClock {
  now(): number
}

const nodeScheduler: CountdownScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>)
}
const systemClock: CountdownClock = { now: () => Date.now() }

export class CountdownBackend implements PluginBackend {
  private ctx: BackendContext | null = null
  private state: CountdownState = { ...IDLE_COUNTDOWN }
  private lastSeq = 0
  private tick: unknown = null

  constructor(
    private readonly scheduler: CountdownScheduler = nodeScheduler,
    private readonly clock: CountdownClock = systemClock
  ) {}

  async init(ctx: BackendContext): Promise<void> {
    this.ctx = ctx
    await this.restore()
    await this.adoptCommandBaseline()
  }

  async start(): Promise<void> {
    if (this.tick !== null) return
    await this.onTick()
    this.tick = this.scheduler.setInterval(() => void this.onTick(), COUNTDOWN_TICK_MS)
  }

  async stop(): Promise<void> {
    if (this.tick !== null) this.scheduler.clearInterval(this.tick)
    this.tick = null
    await this.persist()
  }

  async dispose(): Promise<void> {
    await this.persist()
  }

  snapshot(): CountdownState {
    return this.state
  }

  /** 恢复持久化状态；离开期间（休眠/关机）到点的补发一次通知——收尾态已落盘，不会重复打扰 */
  private async restore(): Promise<void> {
    try {
      const persisted = parseCountdownState(await this.ctx?.storage.get(COUNTDOWN_STATE_KEY))
      if (persisted !== null) {
        const next = restoreSnapshot(persisted, this.clock.now())
        const expiredDuringDowntime = next.status === 'expired' && persisted.status === 'running'
        this.state = next
        if (expiredDuringDowntime) {
          await this.persist()
          await this.notify('⏰ 倒计时已结束（应用离开期间到期）', `设定的 ${formatDuration(this.state.totalMs)} 已到`)
        }
      }
    } catch {
      // 读失败按空闲启动
    }
    this.emitSnapshot()
  }

  /**
   * 重启/重启用防重放：命令槽不清理、lastSeq 只在内存，init 不采纳存量 seq 的话
   * start() 首轮 poll 会重放上次会话遗留的命令（幽灵倒计时/误暂停）。渲染层 seq 取 Date.now()，
   * 只认基线之后的新命令即封死重放。
   */
  private async adoptCommandBaseline(): Promise<void> {
    try {
      const env = takeCountdownCommand(await this.ctx?.storage.get(COUNTDOWN_CMD_KEY), Number.NEGATIVE_INFINITY)
      if (env !== null) this.lastSeq = env.seq
    } catch {
      // 读失败保持 0 基线，行为退回修复前
    }
  }

  private async onTick(): Promise<void> {
    try {
      await this.pollCommand()
      await this.advance()
    } catch {
      // 单轮失败静默放弃，下一轮 500ms 后重试
    }
  }

  private async pollCommand(): Promise<void> {
    if (this.ctx === null) return
    let env
    try {
      env = takeCountdownCommand(await this.ctx.storage.get(COUNTDOWN_CMD_KEY), this.lastSeq)
    } catch {
      return
    }
    if (env === null) return
    this.lastSeq = env.seq
    await this.applyCommand(env.cmd)
  }

  private async applyCommand(cmd: CountdownCommand): Promise<void> {
    const now = this.clock.now()
    switch (cmd.type) {
      case 'start':
        this.state = startCountdown(cmd.ms, now)
        break
      case 'pause':
        this.state = pauseCountdown(this.state, now)
        break
      case 'resume':
        this.state = resumeCountdown(this.state, now)
        break
      case 'stop':
        this.state = stopCountdown()
        break
    }
    await this.persist()
    this.emitSnapshot()
  }

  /** 到点推进：tick 用 endAt 时刻比对，休眠漂移零累积 */
  private async advance(): Promise<void> {
    const next = tickCountdown(this.state, this.clock.now())
    if (next === null) return
    this.state = next
    await this.persist()
    await this.notify('⏰ 倒计时时间到', `设定的 ${formatDuration(this.state.totalMs)} 已到`)
    this.emitSnapshot()
  }

  private async notify(title: string, body: string): Promise<void> {
    try {
      await this.ctx?.notification.show(title, body)
    } catch {
      // 通知失败不影响计时（win32 分支需人工验证）
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.ctx?.storage.set(COUNTDOWN_STATE_KEY, this.state)
    } catch {
      // 写失败保持内存态，下次状态变化重写
    }
  }

  private emitSnapshot(): void {
    this.ctx?.emit(COUNTDOWN_EVENT, this.state)
  }
}

const backend = new CountdownBackend()
export default backend
