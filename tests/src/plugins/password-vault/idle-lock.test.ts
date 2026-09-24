import { describe, expect, it } from 'vitest'
import { IdleLockTimer, normalizeAutoLockMinutes } from '../../../../src/plugins/password-vault/logic/idle-lock'

function fakeScheduler(): {
  scheduler: { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void }
  fire(id?: number): void
  ids(): number[]
  created(): number
} {
  const tasks = new Map<number, () => void>()
  let seq = 0
  let made = 0
  return {
    scheduler: {
      setTimeout: (fn, _ms) => {
        made++
        const id = ++seq
        tasks.set(id, fn)
        return id
      },
      clearTimeout: (id) => tasks.delete(id as number)
    },
    fire: (id) => {
      const first = id === undefined ? [...tasks.keys()][0] : id
      const fn = first === undefined ? undefined : tasks.get(first)
      if (first !== undefined) tasks.delete(first)
      fn?.()
    },
    ids: () => [...tasks.keys()],
    created: () => made
  }
}

describe('normalizeAutoLockMinutes', () => {
  it('只认 0/1/5/15/30，其余回默认 5', () => {
    for (const ok of [0, 1, 5, 15, 30]) expect(normalizeAutoLockMinutes(ok)).toBe(ok)
    for (const bad of [2, 7, -1, 60, Number.NaN, '5', null, undefined]) {
      expect(normalizeAutoLockMinutes(bad)).toBe(5)
    }
  })
})

describe('IdleLockTimer', () => {
  it('arm 后到期触发一次 onLock，随后未布防', () => {
    const f = fakeScheduler()
    let locked = 0
    const t = new IdleLockTimer(() => 5000, () => locked++, f.scheduler)
    t.arm()
    expect(t.isArmed()).toBe(true)
    f.fire()
    expect(locked).toBe(1)
    expect(t.isArmed()).toBe(false)
  })

  it('touch 重置倒计时（旧任务被清掉，不重复触发）', () => {
    const f = fakeScheduler()
    let locked = 0
    const t = new IdleLockTimer(() => 5000, () => locked++, f.scheduler)
    t.arm()
    const firstId = f.ids()[0]
    t.touch()
    expect(f.ids()).toHaveLength(1)
    expect(f.ids()[0]).not.toBe(firstId)
    expect(f.created()).toBe(2)
    f.fire(firstId) // 旧任务已取消，触发不了
    expect(locked).toBe(0)
    f.fire()
    expect(locked).toBe(1)
  })

  it('未布防时 touch 不会布防（锁定态不被活动唤醒）', () => {
    const f = fakeScheduler()
    const t = new IdleLockTimer(() => 5000, () => {}, f.scheduler)
    t.touch()
    expect(t.isArmed()).toBe(false)
    expect(f.ids()).toHaveLength(0)
  })

  it('timeoutMs() ≤ 0 视为永不自动上锁', () => {
    const f = fakeScheduler()
    let locked = 0
    const t = new IdleLockTimer(() => 0, () => locked++, f.scheduler)
    t.arm()
    expect(t.isArmed()).toBe(false)
    expect(f.ids()).toHaveLength(0)
    expect(locked).toBe(0)
  })

  it('disarm 取消后不再触发；重新 arm 生效', () => {
    const f = fakeScheduler()
    let locked = 0
    const t = new IdleLockTimer(() => 5000, () => locked++, f.scheduler)
    t.arm()
    t.disarm()
    expect(f.ids()).toHaveLength(0)
    f.fire()
    expect(locked).toBe(0)
    t.arm()
    f.fire()
    expect(locked).toBe(1)
  })

  it('timeoutMs 动态取值：改时长后重新 arm 用新值', () => {
    const f = fakeScheduler()
    let captured = -1
    const scheduler = {
      setTimeout: (fn: () => void, m: number) => {
        captured = m
        return f.scheduler.setTimeout(fn, m)
      },
      clearTimeout: (id: number) => f.scheduler.clearTimeout(id)
    }
    let cur = 60_000
    const t = new IdleLockTimer(() => cur, () => {}, scheduler)
    t.arm()
    expect(captured).toBe(60_000)
    cur = 120_000
    t.touch()
    expect(captured).toBe(120_000)
  })
})
