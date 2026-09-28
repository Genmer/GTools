// 倒计时纯逻辑 + backend 单测：Electron 能力全部注入 fake，scheduler/clock 手动控制
import { describe, expect, it } from 'vitest'
import type { BackendContext } from '@sdk/api'
import defaultBackend, { COUNTDOWN_TICK_MS, CountdownBackend } from '../../../../src/plugins/time-toolbox/backend'
import {
  COUNTDOWN_CMD_KEY,
  COUNTDOWN_STATE_KEY,
  MAX_DURATION_MS,
  formatDuration,
  formatRemaining,
  parseCountdownState,
  parseDuration,
  pauseCountdown,
  remaining,
  resumeCountdown,
  restoreSnapshot,
  startCountdown,
  stopCountdown,
  takeCountdownCommand,
  tickCountdown
} from '../../../../src/plugins/time-toolbox/logic/countdown'

describe('parseDuration 时长解析', () => {
  it('单/组合单位与纯数字（按分钟）', () => {
    expect(parseDuration('25m')).toBe(1_500_000)
    expect(parseDuration('1h30m')).toBe(5_400_000)
    expect(parseDuration('90s')).toBe(90_000)
    expect(parseDuration('1h')).toBe(3_600_000)
    expect(parseDuration('45')).toBe(2_700_000)
    expect(parseDuration(' 1H 30M ')).toBe(5_400_000) // 大小写与段间空白容错
  })
  it('非法 / 非正 / 超 7 天返回 null', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('1x')).toBeNull()
    expect(parseDuration('0m')).toBeNull()
    expect(parseDuration('0')).toBeNull()
    expect(parseDuration('10080m')).toBe(MAX_DURATION_MS) // 恰 7 天放行
    expect(parseDuration('10081m')).toBeNull()
  })
})

describe('启动 / 暂停 / 恢复 / 停止（endAt 绝对时刻语义）', () => {
  const T0 = 1_000_000
  it('start 以绝对时刻为 endAt；剩余按比对不累减', () => {
    const s = startCountdown(60_000, T0)
    expect(s).toEqual({ status: 'running', endAt: T0 + 60_000, remainingMs: 0, totalMs: 60_000 })
    expect(remaining(s.endAt, T0 + 25_000)).toBe(35_000)
  })
  it('pause 冻结剩余，resume 以当前时刻重新锚定 endAt', () => {
    const s = startCountdown(60_000, T0)
    const paused = pauseCountdown(s, T0 + 20_000)
    expect(paused.status).toBe('paused')
    expect(paused.remainingMs).toBe(40_000)
    // 暂停期间时间继续流逝，恢复后剩余不受影响
    const resumed = resumeCountdown(paused, T0 + 500_000)
    expect(resumed.status).toBe('running')
    expect(resumed.endAt).toBe(T0 + 500_000 + 40_000)
    // 非 running 暂停 / 非 paused 恢复均原样返回
    expect(pauseCountdown(paused, T0)).toBe(paused)
    expect(resumeCountdown(s, T0)).toBe(s)
  })
  it('stop 回空闲；remaining 钳 0；到点判定', () => {
    expect(stopCountdown().status).toBe('idle')
    expect(remaining(T0 - 5, T0)).toBe(0)
    expect(tickCountdown(startCountdown(60_000, T0), T0 + 59_999)).toBeNull()
    const expired = tickCountdown(startCountdown(60_000, T0), T0 + 60_000)
    expect(expired).toMatchObject({ status: 'expired', remainingMs: 0 })
  })
})

describe('restoreSnapshot 跨休眠/跨重启', () => {
  const T0 = 1_000_000
  it('running 且 endAt 已过 → expired 收尾；未过原样（引用不变）', () => {
    const stale = startCountdown(60_000, T0 - 120_000)
    expect(restoreSnapshot(stale, T0)).toMatchObject({ status: 'expired' })
    const fresh = startCountdown(60_000, T0)
    expect(restoreSnapshot(fresh, T0 + 1000)).toBe(fresh)
  })
  it('paused / expired / idle 原样；坏结构解析为 null', () => {
    const paused = pauseCountdown(startCountdown(60_000, T0), T0 + 10_000)
    expect(restoreSnapshot(paused, T0 + 999_999_999)).toBe(paused)
    expect(parseCountdownState('junk')).toBeNull()
    expect(parseCountdownState({ status: 'warp', endAt: 1 })).toBeNull()
    expect(parseCountdownState({ status: 'running', endAt: 'x', remainingMs: -5, totalMs: null })).toEqual({
      status: 'running',
      endAt: 0,
      remainingMs: 0,
      totalMs: 0
    })
  })
})

describe('命令协议 takeCountdownCommand', () => {
  it('seq 更新才采纳；乱序/回放/坏结构/坏时长忽略', () => {
    expect(takeCountdownCommand({ seq: 5, cmd: { type: 'start', ms: 60_000 } }, 4)).toMatchObject({
      seq: 5,
      cmd: { type: 'start', ms: 60_000 }
    })
    expect(takeCountdownCommand({ seq: 4, cmd: { type: 'stop' } }, 4)).toBeNull()
    expect(takeCountdownCommand({ seq: 3, cmd: { type: 'stop' } }, 4)).toBeNull()
    expect(takeCountdownCommand({ seq: 9, cmd: { type: 'start', ms: -1 } }, 4)).toBeNull()
    expect(takeCountdownCommand({ seq: 9, cmd: { type: 'warp' } }, 4)).toBeNull()
    expect(takeCountdownCommand({ seq: 9 }, 4)).toBeNull()
    expect(takeCountdownCommand(null, 4)).toBeNull()
  })
})

describe('formatDuration / formatRemaining 文案', () => {
  it('时长人话与 mm:ss（满小时进位 h:mm:ss）', () => {
    expect(formatDuration(1_500_000)).toBe('25 分钟')
    expect(formatDuration(5_400_000)).toBe('1 小时 30 分钟')
    expect(formatDuration(0)).toBe('0 秒')
    expect(formatRemaining(1_500_000)).toBe('25:00')
    expect(formatRemaining(3_723_000)).toBe('1:02:03')
    expect(formatRemaining(-5)).toBe('00:00')
  })
})

// —— backend：ManualScheduler + 手动时钟，模拟「到点通知必须主进程驱动」的全链路 ——

interface Timer {
  id: number
  fn: () => void
  ms: number
  cleared: boolean
}

class ManualScheduler {
  readonly timers: Timer[] = []
  private seq = 0
  setInterval(fn: () => void, ms: number): unknown {
    const t: Timer = { id: ++this.seq, fn, ms, cleared: false }
    this.timers.push(t)
    return t.id
  }
  clearInterval(id: unknown): void {
    const t = this.timers.find((x) => x.id === id)
    if (t !== undefined) t.cleared = true
  }
  live(): Timer[] {
    return this.timers.filter((t) => !t.cleared)
  }
}

const T0 = 1_000_000

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

interface Harness {
  backend: CountdownBackend
  /** 同 ctx/clock 新建 backend 并 init（模拟应用重启恢复） */
  reinit(): Promise<CountdownBackend>
  scheduler: ManualScheduler
  storage: Map<string, unknown>
  notifications: { title: string; body: string }[]
  emits: { event: string; payload: unknown }[]
  setNow(ms: number): void
  sendCmd(cmd: unknown, seq?: number): void
  tick(): Promise<void>
}

async function makeHarness(seed?: Record<string, unknown>): Promise<Harness> {
  const scheduler = new ManualScheduler()
  const storage = new Map<string, unknown>(Object.entries(seed ?? {}))
  const notifications: { title: string; body: string }[] = []
  const emits: { event: string; payload: unknown }[] = []
  let nowMs = T0
  let cmdSeq = 0
  const ctx: BackendContext = {
    apiVersion: 1,
    clipboard: { readText: async () => '', writeText: async () => {}, readImage: async () => null, writeImage: async () => {} },
    storage: {
      get: async <T>(key: string): Promise<T | null> => (storage.has(key) ? (storage.get(key) as T) : null),
      set: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      remove: async (key: string) => {
        storage.delete(key)
      },
      keys: async () => [...storage.keys()]
    },
    net: { fetch: async () => ({ ok: true, status: 200, body: '' }), lanAddresses: async () => [] },
    notification: {
      show: async (title: string, body: string) => {
        notifications.push({ title, body })
      }
    },
    shell: { openApp: async () => {}, openPath: async () => {}, openExternal: async () => {} },
    window: { hide: async () => {}, float: { create: async () => '', update: async () => {}, close: async () => {}, closeAll: async () => {} } },
    dialog: { openFile: async () => [], saveFile: async () => null },
    fs: {
      grant: async () => {},
      read: async () => '',
      write: async () => {},
      rename: async () => {},
      remove: async () => {},
      stat: async () => null,
      list: async () => [],
      mkdir: async () => {}
    },
    app: { platform: 'test', version: '0' },
    apis: { invoke: async () => ({ resultText: '', providerId: '' }), status: async () => ({}) },
    events: { on: () => () => {} },
    emit: (event: string, payload: unknown) => {
      emits.push({ event, payload })
    }
  } as unknown as BackendContext
  const clock = { now: () => nowMs }
  const backend = new CountdownBackend(scheduler, clock)
  await backend.init(ctx)
  const reinit = async (): Promise<CountdownBackend> => {
    const b = new CountdownBackend(scheduler, clock)
    await b.init(ctx)
    return b
  }
  return {
    backend,
    reinit,
    scheduler,
    storage,
    notifications,
    emits,
    setNow: (ms: number) => {
      nowMs = ms
    },
    sendCmd: (cmd: unknown, seq?: number) => {
      storage.set(COUNTDOWN_CMD_KEY, { seq: seq ?? ++cmdSeq, cmd })
    },
    tick: async () => {
      const timers = scheduler.live()
      expect(timers.length).toBe(1)
      timers[0]!.fn()
      await flush()
    }
  }
}

describe('CountdownBackend', () => {
  it('start 命令：运行态落盘并 emit；500ms tick 注册且不重复', async () => {
    const h = await makeHarness()
    await h.backend.start()
    expect(h.scheduler.live().map((t) => t.ms)).toEqual([COUNTDOWN_TICK_MS])

    h.sendCmd({ type: 'start', ms: 60_000 })
    await h.tick()
    expect(h.backend.snapshot().status).toBe('running')
    const persisted = parseCountdownState(h.storage.get(COUNTDOWN_STATE_KEY))
    expect(persisted?.status).toBe('running')
    expect(h.emits.at(-1)).toMatchObject({ event: 'countdown-changed' })
    expect(h.notifications).toHaveLength(0)

    await h.backend.start() // 幂等
    expect(h.scheduler.live()).toHaveLength(1)
    await h.backend.stop()
  })

  it('到点推进：状态转 expired、落盘、系统通知恰好一次', async () => {
    const h = await makeHarness()
    await h.backend.start()
    h.sendCmd({ type: 'start', ms: 60_000 })
    await h.tick()

    h.setNow(T0 + 59_000)
    await h.tick()
    expect(h.backend.snapshot().status).toBe('running')
    expect(h.notifications).toHaveLength(0)

    h.setNow(T0 + 60_000)
    await h.tick()
    expect(h.backend.snapshot().status).toBe('expired')
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0]).toMatchObject({ title: '⏰ 倒计时时间到', body: '设定的 1 分钟 已到' })
    expect(parseCountdownState(h.storage.get(COUNTDOWN_STATE_KEY))?.status).toBe('expired')
    // init 恢复 emit 1 次 + start 命令 emit 1 次 + 到点 emit 1 次
    expect(h.emits.filter((e) => e.event === 'countdown-changed')).toHaveLength(3)

    await h.tick() // 已 expired 不重复通知
    expect(h.notifications).toHaveLength(1)
    await h.backend.stop()
  })

  it('暂停/恢复命令经命令槽生效', async () => {
    const h = await makeHarness()
    await h.backend.start()
    h.sendCmd({ type: 'start', ms: 60_000 })
    await h.tick()
    h.setNow(T0 + 20_000)
    h.sendCmd({ type: 'pause' })
    await h.tick()
    expect(h.backend.snapshot()).toMatchObject({ status: 'paused', remainingMs: 40_000 })

    h.setNow(T0 + 500_000) // 暂停期间时钟照走
    h.sendCmd({ type: 'resume' })
    await h.tick()
    expect(h.backend.snapshot().status).toBe('running')
    expect(h.backend.snapshot().endAt).toBe(T0 + 500_000 + 40_000)
    await h.backend.stop()
  })

  it('离开期间到点：init 恢复为 expired 并补发一次通知；再次 init 不重复', async () => {
    // makeHarness 首次 init 时 endAt 未到；把时钟推过 endAt 后「重启」才触发离开期间到期
    const seed = {
      [COUNTDOWN_STATE_KEY]: { status: 'running', endAt: T0 + 60_000, remainingMs: 0, totalMs: 300_000 }
    }
    const h = await makeHarness(seed)
    expect(h.notifications).toHaveLength(0)

    h.setNow(T0 + 61_000)
    const restarted = await h.reinit()
    expect(restarted.snapshot().status).toBe('expired')
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0].title).toContain('应用离开期间到期')

    await h.reinit()
    expect(h.notifications).toHaveLength(1) // 收尾态已落盘，不再打扰
  })

  it('重启不重放遗留命令：init 采纳存量 seq 基线，start() 首轮 poll 不复活旧倒计时；新 seq 命令照常生效', async () => {
    // 上次会话：启动倒计时后应用退出（命令槽遗留 start@1000，状态落盘 running）
    const h = await makeHarness()
    await h.backend.start()
    h.sendCmd({ type: 'start', ms: 60_000 }, 1000)
    await h.tick()
    await h.backend.stop()

    // 重启：离开期间到点补发一次（合法路径），遗留 start 不重放（修复前会重置倒计时并在到期后再弹一条幽灵通知）
    h.setNow(T0 + 300_000)
    const restarted = await h.reinit()
    await restarted.start()
    await h.tick()
    expect(restarted.snapshot().status).toBe('expired')
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0].title).toContain('应用离开期间到期')

    // 之后的真正新命令（seq 更大）正常生效
    h.sendCmd({ type: 'start', ms: 60_000 }, 2000)
    await h.tick()
    expect(restarted.snapshot().status).toBe('running')
    await restarted.stop()
  })

  it('reinit 不重放遗留命令槽：预置大 seq 存量 envelope（渲染层 Date.now() 量级），重建 backend + start 后不执行、新 seq 命令照常生效', async () => {
    // 存量命令不经过任何旧 backend 直接落槽；init 只采纳 seq 基线，start() 首轮 poll 不消费执行
    const leftoverSeq = Date.now()
    const h = await makeHarness({
      [COUNTDOWN_CMD_KEY]: { seq: leftoverSeq, cmd: { type: 'start', ms: 60_000 } }
    })
    const restarted = await h.reinit()
    await restarted.start()
    await h.tick()
    expect(restarted.snapshot().status).toBe('idle')
    expect(h.notifications).toHaveLength(0)
    // 两次 init（makeHarness 内建 + reinit）各 emit 一次恢复快照，均 idle，无命令生效的 emit
    expect(h.emits.map((e) => (e.payload as { status: string }).status)).toEqual(['idle', 'idle'])

    h.sendCmd({ type: 'start', ms: 60_000 }, leftoverSeq + 1)
    await h.tick()
    expect(restarted.snapshot().status).toBe('running')
    await restarted.stop()
  })

  it('stop 清定时器并落盘；默认导出可装配', async () => {
    const h = await makeHarness()
    await h.backend.start()
    await h.backend.stop()
    expect(h.scheduler.live()).toHaveLength(0)
    expect(typeof defaultBackend.init).toBe('function')
    expect(COUNTDOWN_TICK_MS).toBe(500)
  })
})
