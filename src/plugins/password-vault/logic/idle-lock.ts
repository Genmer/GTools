// 空闲自动上锁计时器：解锁期间任何用户活动重置倒计时，到期回调上锁
export interface TimerScheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

export const defaultTimerScheduler: TimerScheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>)
}

export const AUTO_LOCK_CHOICES = [0, 1, 5, 15, 30] as const
export type AutoLockChoice = (typeof AUTO_LOCK_CHOICES)[number]

export function normalizeAutoLockMinutes(raw: unknown): AutoLockChoice {
  const n = typeof raw === 'number' ? raw : Number.NaN
  return (AUTO_LOCK_CHOICES as readonly number[]).includes(n) ? (n as AutoLockChoice) : 5
}

export class IdleLockTimer {
  private timerId: unknown = null

  constructor(
    private readonly timeoutMs: () => number,
    private readonly onLock: () => void,
    private readonly scheduler: TimerScheduler = defaultTimerScheduler
  ) {}

  isArmed(): boolean {
    return this.timerId !== null
  }

  /** 开始计时空闲；timeoutMs() ≤ 0 视为永不自动上锁 */
  arm(): void {
    this.disarm()
    const ms = this.timeoutMs()
    if (ms <= 0) return
    this.timerId = this.scheduler.setTimeout(() => {
      this.timerId = null
      this.onLock()
    }, ms)
  }

  /** 用户活动：仅在已布防时重置（锁定态不自动布防） */
  touch(): void {
    if (this.timerId !== null) this.arm()
  }

  disarm(): void {
    if (this.timerId !== null) this.scheduler.clearTimeout(this.timerId)
    this.timerId = null
  }
}
