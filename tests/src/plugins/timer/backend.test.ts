import { describe, expect, it } from 'vitest'
import {
  BALL_AUTO_CLOSE_MS,
  HEAL_DELAY_MS,
  IDLE_POLL_MS,
  TICK_MS,
  TimerBackend,
  type BackendScheduler
} from '../../../../src/plugins/timer/backend'
import { CMD_KEY } from '../../../../src/plugins/timer/logic/commands'
import { IDLE_COUNTDOWN, type CountdownState } from '../../../../src/plugins/timer/logic/countdown'
import { IDLE_POMODORO_STATE, type PomodoroState } from '../../../../src/plugins/timer/logic/pomodoro'
import { emptyLog, parsePomodoroLog } from '../../../../src/plugins/timer/logic/stats'
import { TIMER_EVENT, type PersistedTimerState } from '../../../../src/plugins/timer/logic/session'
import type { BackendContext, ShowMainOptions } from '@sdk/api'

const T0 = 1_700_000_000_000
const MIN = 60_000

type Timer = { id: number; fn: () => void; ms: number; cleared: boolean }

class ManualScheduler implements BackendScheduler {
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

interface FloatCalls {
  created: { id: string; opts: Record<string, unknown> }[]
  updates: { id: string; html: string }[]
  closed: string[]
  failUpdate: boolean
  lastHtml: string
}

interface Harness {
  backend: TimerBackend
  /** 同 ctx/clock 新建 backend 并 init+start（模拟应用重启恢复） */
  reinit(): Promise<TimerBackend>
  scheduler: ManualScheduler
  storage: Map<string, unknown>
  notifications: { title: string; body: string }[]
  emits: { event: string; payload: unknown }[]
  float: FloatCalls
  showMainCalls: (ShowMainOptions | undefined)[]
  setNow(ms: number): void
  sendCmd(cmd: unknown, seq?: number): void
  emitFloat(payload: unknown): Promise<void>
  tick(): Promise<void>
  lastSnapshot(): Record<string, unknown>
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

async function makeHarness(seed?: Record<string, unknown>): Promise<Harness> {
  const scheduler = new ManualScheduler()
  const storage = new Map<string, unknown>(Object.entries(seed ?? {}))
  const notifications: { title: string; body: string }[] = []
  const emits: { event: string; payload: unknown }[] = []
  const float: FloatCalls = { created: [], updates: [], closed: [], failUpdate: false, lastHtml: '' }
  const showMainCalls: (ShowMainOptions | undefined)[] = []
  const floatHandlers: ((p: unknown) => void)[] = []
  let nowMs = T0
  let floatSeq = 0

  const ctx: BackendContext = {
    apiVersion: 1,
    clipboard: {
      readText: async () => '',
      writeText: async () => {},
      writeTextEphemeral: async () => {},
      isTextExempted: async () => false,
      readImage: async () => null,
      writeImage: async () => {}
    },
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
    net: { fetch: async () => { throw new Error('no net in test') }, lanAddresses: async () => [] },
    notification: {
      show: async (title: string, body: string) => {
        notifications.push({ title, body })
      }
    },
    shell: { openApp: async () => {}, openPath: async () => {}, openExternal: async () => {} },
    screenshot: { capture: async () => ({ action: 'cancel' as const }) },
    window: {
      hide: async () => {},
      showMain: async (opts?: ShowMainOptions) => {
        showMainCalls.push(opts)
      },
      float: {
        create: async (opts: { html: string; width?: number; height?: number; x?: number; y?: number }) => {
          const id = `timer#${++floatSeq}`
          float.created.push({ id, opts: opts as unknown as Record<string, unknown> })
          float.lastHtml = opts.html
          return id
        },
        update: async (id: string, patch: { html?: string }) => {
          if (float.failUpdate) throw new Error('浮窗不存在或不属于插件')
          float.updates.push({ id, html: patch.html ?? '' })
          if (patch.html !== undefined) float.lastHtml = patch.html
        },
        close: async (id: string) => {
          float.closed.push(id)
        },
        closeAll: async () => {}
      }
    },
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
    apis: {
      invoke: () => Promise.reject(new Error('apis 未用于本测试')),
      status: () => Promise.reject(new Error('apis 未用于本测试'))
    },
    events: {
      on: (event: string, cb: (p: unknown) => void) => {
        if (event === 'float-event') floatHandlers.push(cb)
        return () => {
          const i = floatHandlers.indexOf(cb)
          if (i >= 0) floatHandlers.splice(i, 1)
        }
      }
    },
    emit: (event: string, payload: unknown) => {
      emits.push({ event, payload })
    }
  }

  const backend = new TimerBackend(scheduler, { now: () => nowMs })
  await backend.init(ctx)
  await backend.start()

  let cmdSeq = 1000
  return {
    backend,
    reinit: async () => {
      const b = new TimerBackend(scheduler, { now: () => nowMs })
      await b.init(ctx)
      await b.start()
      return b
    },
    scheduler,
    storage,
    notifications,
    emits,
    float,
    showMainCalls,
    setNow: (ms: number) => {
      nowMs = ms
    },
    sendCmd: (cmd: unknown, seq?: number) => {
      storage.set(CMD_KEY, { seq: seq ?? ++cmdSeq, cmd })
    },
    emitFloat: async (payload: unknown) => {
      for (const h of [...floatHandlers]) h(payload)
      await flush()
    },
    tick: async () => {
      const timers = scheduler.live()
      expect(timers.length).toBe(1)
      timers[0]!.fn()
      await flush()
    },
    lastSnapshot: () => emits.filter((e) => e.event === TIMER_EVENT).at(-1)!.payload as Record<string, unknown>
  }
}

function persistedState(storage: Map<string, unknown>): PersistedTimerState {
  return storage.get('timer-state') as PersistedTimerState
}

function cdStart(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'cd-start', ms: 60_000, label: '', ...overrides }
}

function pmStart(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'pm-start', focusMin: 25, breakMin: 5, autoStartBreak: true, ...overrides }
}

describe('命令 → 计时全链路（storage 命令槽轮询接续）', () => {
  it('cd-start：进入运行、落盘、发快照、出球', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart({ label: '泡面' }))
    await h.tick()

    const snap = h.lastSnapshot()
    const cd = snap.countdown as Record<string, unknown>
    expect(cd.status).toBe('running')
    expect(cd.endAt).toBe(T0 + MIN)
    expect(cd.label).toBe('泡面')
    expect(persistedState(h.storage).countdown.status).toBe('running')
    expect(h.float.created.length).toBe(1)
    expect(h.float.lastHtml).toContain('泡面')
  })

  it('pm-start：session 快照落盘并进专注', async () => {
    const h = await makeHarness()
    h.sendCmd(pmStart({ focusMin: 30, breakMin: 10, autoStartBreak: false }))
    await h.tick()

    const pm = h.lastSnapshot().pomodoro as Record<string, unknown>
    expect(pm.status).toBe('running')
    expect(pm.phase).toBe('focus')
    expect(pm.endAt).toBe(T0 + 30 * MIN)
    expect(persistedState(h.storage).session).toEqual({ focusMin: 30, breakMin: 10, autoStartBreak: false })
  })

  it('互斥：cd-start 顶掉运行中的番茄；pm-start 顶掉运行中的倒计时', async () => {
    const h = await makeHarness()
    h.sendCmd(pmStart())
    await h.tick()
    expect((h.lastSnapshot().pomodoro as Record<string, unknown>).status).toBe('running')

    h.sendCmd(cdStart({ ms: 30_000 }))
    await h.tick()
    let snap = h.lastSnapshot()
    expect((snap.pomodoro as Record<string, unknown>).status).toBe('idle')
    expect((snap.countdown as Record<string, unknown>).status).toBe('running')
    expect(snap.session).toBeNull()

    h.sendCmd(pmStart())
    await h.tick()
    snap = h.lastSnapshot()
    expect((snap.countdown as Record<string, unknown>).status).toBe('idle')
    expect((snap.pomodoro as Record<string, unknown>).status).toBe('running')
    expect(snap.session).toEqual({ focusMin: 25, breakMin: 5, autoStartBreak: true })
  })

  it('pause/resume 作用于当前活跃的会话；stop 清两者', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart())
    await h.tick()
    h.setNow(T0 + 20_000)
    h.sendCmd({ type: 'pause' })
    await h.tick()
    let cd = h.lastSnapshot().countdown as Record<string, unknown>
    expect(cd.status).toBe('paused')
    expect(cd.remainingMs).toBe(40_000)

    h.sendCmd({ type: 'resume' })
    await h.tick()
    cd = h.lastSnapshot().countdown as Record<string, unknown>
    expect(cd.status).toBe('running')

    h.sendCmd({ type: 'stop' })
    await h.tick()
    const snap = h.lastSnapshot()
    expect((snap.countdown as Record<string, unknown>).status).toBe('idle')
    expect((snap.pomodoro as Record<string, unknown>).status).toBe('idle')
    expect(snap.session).toBeNull()
    expect(h.float.closed.length).toBe(1) // 球收起
  })

  it('skip：番茄跳相不计统计；倒计时活跃时 skip 等同 stop', async () => {
    const h = await makeHarness()
    h.sendCmd(pmStart())
    await h.tick()
    h.sendCmd({ type: 'skip' })
    await h.tick()
    expect((h.lastSnapshot().pomodoro as Record<string, unknown>).phase).toBe('break')
    expect(parsePomodoroLog(h.storage.get('pomodoro-log'))?.entries.length ?? 0).toBe(0)
    expect(h.notifications.length).toBe(0)

    h.sendCmd({ type: 'skip' })
    await h.tick()
    expect((h.lastSnapshot().pomodoro as Record<string, unknown>).status).toBe('idle')

    h.sendCmd(cdStart())
    await h.tick()
    h.sendCmd({ type: 'skip' })
    await h.tick()
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('idle')
  })

  it('seq 门卫：已处理的 seq 不再触发（渲染层重放安全）', async () => {
    const h = await makeHarness()
    h.sendCmd({ type: 'stop' }, 7)
    await h.tick()
    const emitsBefore = h.emits.length
    h.sendCmd({ type: 'stop' }, 7) // 同 seq 重放
    h.sendCmd({ type: 'stop' }, 3) // 更旧的 seq
    await h.tick()
    expect(h.emits.length).toBe(emitsBefore)
  })

  it('重启不重放遗留命令：init 采纳存量 seq 基线，start() 首轮 poll 不复活旧计时', async () => {
    const leftoverSeq = Date.now()
    const h = await makeHarness({ [CMD_KEY]: { seq: leftoverSeq, cmd: cdStart() } })
    await h.tick()
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('idle')
    expect(h.notifications.length).toBe(0)

    h.sendCmd(cdStart(), leftoverSeq + 1)
    await h.tick()
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('running')
  })
})

describe('到期推进与通知', () => {
  it('倒计时到点：通知（含 label 文案）恰好一次、转 expired、球 8s 自动收（ballVisible 保持 true）', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart({ label: '泡面' }))
    await h.tick()

    h.setNow(T0 + MIN)
    await h.tick()
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0]).toMatchObject({ title: '⏰ 倒计时时间到', body: '「泡面」设定的 1 分钟 已到' })
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('expired')
    expect(h.float.closed.length).toBe(0) // 展示期球还在
    expect(h.scheduler.live()[0]!.ms).toBe(TICK_MS) // expired + 待收球仍快档

    h.setNow(T0 + MIN + BALL_AUTO_CLOSE_MS + 100)
    await h.tick()
    expect(h.float.closed.length).toBe(1)
    const snap = h.lastSnapshot()
    expect(snap.ballVisible).toBe(true) // 自动收 ≠ 用户关
    expect(persistedState(h.storage).ballVisible).toBe(true)
    expect(h.scheduler.live()[0]!.ms).toBe(IDLE_POLL_MS) // 收完球降慢档

    await h.tick()
    expect(h.notifications).toHaveLength(1) // 不重复通知
  })

  it('expired 展示期内再起新倒计时：旧 autoCloseAt 不误关新倒计时的球', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart())
    await h.tick()
    h.setNow(T0 + MIN)
    await h.tick() // 到点：expired，autoCloseAt=T0+MIN+8000，球在展示期
    expect(h.float.closed.length).toBe(0)

    h.sendCmd(cdStart({ ms: 30_000 })) // 展示期内起第二个倒计时
    await h.tick()
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('running')

    h.setNow(T0 + MIN + BALL_AUTO_CLOSE_MS + 100) // 拨过旧 autoCloseAt 时刻
    await h.tick()
    expect(h.float.closed.length).toBe(0) // 旧收球定时已随 cd-start 作废，不关新球
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('running') // 新倒计时照常（30s 未到）

    h.setNow(T0 + MIN + 30_000 + 100) // 新倒计时自身到点
    await h.tick()
    expect(h.notifications).toHaveLength(2)
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('expired')
  })

  it('无 label 的到点文案', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart())
    await h.tick()
    h.setNow(T0 + MIN)
    await h.tick()
    expect(h.notifications[0]!.body).toBe('设定的 1 分钟 已到')
  })

  it('番茄专注到期：通知 + 记统计 + 自动进入休息 + 球刷新；休息到期回空闲', async () => {
    const h = await makeHarness()
    h.sendCmd(pmStart())
    await h.tick()

    h.setNow(T0 + 25 * MIN + 100)
    await h.tick()
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0]!.title).toBe('🍅 番茄完成！')
    expect(h.notifications[0]!.body).toContain('专注 25 分钟')
    const log = parsePomodoroLog(h.storage.get('pomodoro-log'))!
    expect(log.entries.length).toBe(1)
    const snap = h.lastSnapshot()
    expect((snap.pomodoro as Record<string, unknown>).phase).toBe('break')
    expect((snap.pomodoro as Record<string, unknown>).endAt).toBe(T0 + 25 * MIN + 100 + 5 * MIN)
    expect(snap.todayCount).toBe(1)
    expect(h.float.lastHtml).toContain('k-break')

    h.setNow(T0 + 30 * MIN + 200)
    await h.tick()
    expect(h.notifications).toHaveLength(2)
    expect(h.notifications[1]!.title).toBe('☕ 休息结束')
    expect((h.lastSnapshot().pomodoro as Record<string, unknown>).status).toBe('idle')
    expect(h.lastSnapshot().session).toBeNull()
  })

  it('关闭自动休息：专注到期直接回空闲但仍记统计', async () => {
    const h = await makeHarness()
    h.sendCmd(pmStart({ autoStartBreak: false }))
    await h.tick()
    h.setNow(T0 + 25 * MIN)
    await h.tick()
    expect((h.lastSnapshot().pomodoro as Record<string, unknown>).status).toBe('idle')
    expect(parsePomodoroLog(h.storage.get('pomodoro-log'))!.entries.length).toBe(1)
  })
})

describe('悬浮球', () => {
  it('球开关：ball-toggle false 关球 true 重开（活跃态）', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart())
    await h.tick()
    expect(h.float.created.length).toBe(1)

    h.sendCmd({ type: 'ball-toggle', visible: false })
    await h.tick()
    expect(h.float.closed.length).toBe(1)
    expect(persistedState(h.storage).ballVisible).toBe(false)

    h.sendCmd({ type: 'ball-toggle', visible: true })
    await h.tick()
    expect(h.float.created.length).toBe(2)
    expect((h.float.created[1]!.opts as { html: string }).html).toContain('01:00')
  })

  it('用户点 ✕ 关球后（update 报不存在）：ballVisible 落盘 false，后续状态变化不复活', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart())
    await h.tick()
    h.float.failUpdate = true

    h.setNow(T0 + 30_000)
    h.sendCmd({ type: 'pause' })
    await h.tick()
    expect(persistedState(h.storage).ballVisible).toBe(false)
    expect(h.lastSnapshot().ballVisible).toBe(false)
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('paused') // 计时不受球影响

    h.float.failUpdate = false
    h.sendCmd({ type: 'resume' }) // 状态变化不复活球
    await h.tick()
    expect(h.float.created.length).toBe(1)

    h.sendCmd({ type: 'ball-toggle', visible: true }) // 显式重开：活跃会话下重新出球
    await h.tick()
    expect(h.float.created.length).toBe(2)
  })

  it('create 参数：96x96、置顶、透明、不抢焦点、不可缩放', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart())
    await h.tick()
    const opts = h.float.created[0]!.opts
    expect(opts.width).toBe(96)
    expect(opts.height).toBe(96)
    expect(opts.alwaysOnTop).toBe(true)
    expect(opts.transparent).toBe(true)
    expect(opts.focus).toBe(false)
    expect(opts.resizable).toBe(false)
  })

  it('状态变化走 update 不重建球：create 仅一次，updates 均打在同一球 id 上', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart())
    await h.tick()
    h.setNow(T0 + 30_000)
    h.sendCmd({ type: 'pause' })
    await h.tick()
    h.sendCmd({ type: 'resume' })
    await h.tick()
    expect(h.float.created).toHaveLength(1)
    expect(h.float.updates).toHaveLength(2)
    expect(h.float.updates.every((u) => u.id === h.float.created[0]!.id)).toBe(true)
  })

  it('球位置持久化：create 用 ballPos，ball-pos 事件更新且不发快照', async () => {
    const h = await makeHarness({
      'timer-state': {
        v: 1,
        countdown: { ...IDLE_COUNTDOWN },
        pomodoro: { ...IDLE_POMODORO_STATE },
        session: null,
        ballVisible: true,
        ballPos: { x: 120, y: 80 }
      }
    })
    h.sendCmd(cdStart())
    await h.tick()
    expect(h.float.created[0]!.opts.x).toBe(120)
    expect(h.float.created[0]!.opts.y).toBe(80)

    const emitsBefore = h.emits.length
    await h.emitFloat({ event: 'ball-pos', payload: { x: 200, y: 40 } })
    expect(persistedState(h.storage).ballPos).toEqual({ x: 200, y: 40 })
    expect(h.emits.length).toBe(emitsBefore) // 位置变化不 emitSnapshot

    await h.emitFloat({ event: 'ball-pos', payload: { x: 200, y: 40 } }) // 同位置不重复写
    await h.emitFloat({ event: 'ball-pos', payload: { x: NaN, y: 40 } }) // 非法忽略
    await h.emitFloat({ event: 'ball-pos', payload: { x: 'a', y: 40 } })
    expect(persistedState(h.storage).ballPos).toEqual({ x: 200, y: 40 })
  })

  it('球事件 click：运行中暂停、再点继续、expired 点收尾；dblclick 调 showMain 直达对应命令', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart())
    await h.tick()

    await h.emitFloat({ event: 'ball-action', payload: { action: 'click' } })
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('paused')
    await h.emitFloat({ event: 'ball-action', payload: { action: 'click' } })
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('running')

    await h.emitFloat({ event: 'ball-action', payload: { action: 'dblclick' } })
    expect(h.showMainCalls).toEqual([{ pluginId: 'timer', commandId: 'countdown' }])

    // 到点（未到自动收球时点）：轻点即收尾
    h.setNow(T0 + MIN + 100)
    await h.tick()
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('expired')
    await h.emitFloat({ event: 'ball-action', payload: { action: 'click' } })
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('idle')

    h.sendCmd(pmStart())
    await h.tick()
    await h.emitFloat({ event: 'ball-action', payload: { action: 'dblclick' } })
    expect(h.showMainCalls).toHaveLength(2)
    expect(h.showMainCalls[1]).toEqual({ pluginId: 'timer', commandId: 'pomodoro' })
  })
})

describe('重启恢复', () => {
  it('离开期间倒计时到期：expired + 补发一次通知；再次 init 不重复', async () => {
    const seed: Record<string, unknown> = {
      'timer-state': {
        v: 1,
        countdown: { status: 'running', endAt: T0 + 60_000, remainingMs: 0, totalMs: 300_000, label: '泡面' },
        pomodoro: { ...IDLE_POMODORO_STATE },
        session: null,
        ballVisible: false,
        ballPos: null
      }
    }
    const h = await makeHarness(seed)
    expect(h.notifications).toHaveLength(0) // init 时 endAt 未到，正常恢复运行

    h.setNow(T0 + 61_000) // 离开期间跨过 endAt 后「重启」
    await h.reinit()
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0]!.title).toContain('应用离开期间到期')
    expect(h.notifications[0]!.body).toBe('「泡面」设定的 5 分钟 已到')
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('expired')
    // ballVisible false：不弹球
    expect(h.float.created.length).toBe(0)

    await h.reinit() // 收尾态已落盘，不再打扰
    expect(h.notifications).toHaveLength(1)
  })

  it('未到期运行会话恢复并重建球（ballVisible 开）', async () => {
    const h = await makeHarness({
      'timer-state': {
        v: 1,
        countdown: { status: 'running', endAt: T0 + 25 * MIN, remainingMs: 0, totalMs: 25 * MIN, label: '' },
        pomodoro: { ...IDLE_POMODORO_STATE },
        session: null,
        ballVisible: true,
        ballPos: null
      }
    })
    const cd = h.lastSnapshot().countdown as Record<string, unknown>
    expect(cd.status).toBe('running')
    expect(cd.endAt).toBe(T0 + 25 * MIN)
    expect(h.float.created.length).toBe(1)
  })

  it('空闲态启动不弹球', async () => {
    const h = await makeHarness()
    expect(h.float.created.length).toBe(0)
    expect(h.lastSnapshot().ballVisible).toBe(true)
  })

  it('离开期间专注到期：补记统计 + 一次性告知，不自动开始休息', async () => {
    const pomodoro: PomodoroState = { status: 'running', phase: 'focus', remainingMs: 0, endAt: T0 - 10 * MIN, totalMs: 25 * MIN }
    const h = await makeHarness({
      'timer-state': {
        v: 1,
        countdown: { ...IDLE_COUNTDOWN },
        pomodoro,
        session: { focusMin: 25, breakMin: 5, autoStartBreak: true },
        ballVisible: true,
        ballPos: null
      },
      'pomodoro-log': emptyLog()
    })
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0]!.title).toContain('应用关闭期间已结束')
    const log = parsePomodoroLog(h.storage.get('pomodoro-log'))!
    expect(log.entries.length).toBe(1)
    const snap = h.lastSnapshot()
    expect((snap.pomodoro as Record<string, unknown>).status).toBe('idle')
    expect(snap.session).toBeNull()
    expect(h.float.created.length).toBe(0) // 回空闲不弹球
  })

  it('暂停态：原样恢复剩余时间', async () => {
    const pomodoro: PomodoroState = { status: 'paused', phase: 'focus', remainingMs: 20 * MIN, endAt: null, totalMs: 25 * MIN }
    const h = await makeHarness({
      'timer-state': {
        v: 1,
        countdown: { ...IDLE_COUNTDOWN },
        pomodoro,
        session: { focusMin: 25, breakMin: 5, autoStartBreak: true },
        ballVisible: true,
        ballPos: null
      }
    })
    const pm = h.lastSnapshot().pomodoro as Record<string, unknown>
    expect(pm.status).toBe('paused')
    expect(pm.remainingMs).toBe(20 * MIN)
  })

  it('倒计时暂停态跨重启恢复：仍 paused、remainingMs 不变、到期语义不误触发', async () => {
    const h = await makeHarness({
      'timer-state': {
        v: 1,
        countdown: { status: 'paused', endAt: 0, remainingMs: 40_000, totalMs: 60_000, label: '泡面' },
        pomodoro: { ...IDLE_POMODORO_STATE },
        session: null,
        ballVisible: true,
        ballPos: null
      }
    })
    const cd = h.lastSnapshot().countdown as Record<string, unknown>
    expect(cd.status).toBe('paused')
    expect(cd.remainingMs).toBe(40_000)
    expect(persistedState(h.storage).countdown.status).toBe('paused')
    expect(h.notifications).toHaveLength(0) // 暂停无到期收尾

    // 重启后 resume 命令以冻结 remainingMs 重算 endAt
    h.sendCmd({ type: 'resume' })
    await h.tick()
    const resumed = h.lastSnapshot().countdown as Record<string, unknown>
    expect(resumed.status).toBe('running')
    expect(resumed.endAt).toBe(T0 + 40_000)
  })
})

describe('统计落盘自愈', () => {
  it('并发写覆盖丢失日志后，复查延迟点重写找回；复查期保持快档', async () => {
    const h = await makeHarness()
    h.sendCmd(pmStart({ autoStartBreak: false }))
    await h.tick()

    const doneAt = T0 + 25 * MIN
    h.setNow(doneAt)
    await h.tick()
    expect(parsePomodoroLog(h.storage.get('pomodoro-log'))!.entries.length).toBe(1)
    expect(h.scheduler.live()[0]!.ms).toBe(TICK_MS) // heal 待复查仍快档

    h.storage.set('pomodoro-log', emptyLog()) // 模拟并发覆盖丢日志
    h.setNow(doneAt + HEAL_DELAY_MS + 100)
    await h.tick()
    expect(parsePomodoroLog(h.storage.get('pomodoro-log'))!.entries.length).toBe(1)
    expect(h.scheduler.live()[0]!.ms).toBe(IDLE_POLL_MS) // 复查完降慢档
  })
})

describe('生命周期与轮询分档', () => {
  it('档位与收球延迟常量钉死验收口径：活跃 500ms / 空闲 1000ms / 自动收球 8s', () => {
    expect(TICK_MS).toBe(500)
    expect(IDLE_POLL_MS).toBe(1000)
    expect(BALL_AUTO_CLOSE_MS).toBe(8000)
  })

  it('空闲慢档兜命令，会话激活快档，结束回慢档；start 幂等、stop 清理', async () => {
    const h = await makeHarness()
    expect(h.scheduler.live()[0]!.ms).toBe(IDLE_POLL_MS)
    await h.backend.start() // 幂等
    expect(h.scheduler.live().length).toBe(1)

    h.sendCmd(cdStart())
    await h.tick()
    expect(h.scheduler.live()[0]!.ms).toBe(TICK_MS)

    h.sendCmd({ type: 'stop' })
    await h.tick()
    expect(h.scheduler.live()[0]!.ms).toBe(IDLE_POLL_MS)

    await h.backend.stop()
    expect(h.scheduler.live().length).toBe(0)
  })

  it('stop 后宿主已关球：重新 start 后活跃会话走 create 重建球，ballVisible 保持 true', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart())
    await h.tick()
    expect(h.float.created.length).toBe(1)

    await h.backend.stop()
    // 停用期间宿主 closeAllForPlugin 已关全部浮窗：此后对陈旧 id 的 update 会抛「不存在」
    h.float.failUpdate = true
    const updatesBefore = h.float.updates.length

    await h.backend.start()
    h.sendCmd({ type: 'pause' }) // 活跃会话状态变化触发 refreshBall
    await h.tick()
    expect(h.float.updates.length).toBe(updatesBefore) // 未走 update（陈旧 id 会被误判用户✕）
    expect(h.float.created.length).toBe(2) // 走 create 重建
    expect((h.lastSnapshot().countdown as Record<string, unknown>).status).toBe('paused') // 计时本身未受停用影响
    expect(h.lastSnapshot().ballVisible).toBe(true)
    expect(persistedState(h.storage).ballVisible).toBe(true)
  })

  it('stop 与在途 tick 并发：不重挂僵尸 interval', async () => {
    const h = await makeHarness()
    h.sendCmd(cdStart())
    h.scheduler.live()[0]!.fn() // 触发本轮但不等它走完
    await h.backend.stop()
    await new Promise((r) => setTimeout(r, 0))
    expect(h.scheduler.live().length).toBe(0)
  })

  it('持久化结构：timer-state 含 v/双会话/session/ballVisible/ballPos', async () => {
    const h = await makeHarness()
    h.sendCmd(pmStart())
    await h.tick()
    const p = persistedState(h.storage)
    expect(p.v).toBe(1)
    expect((p as { countdown: CountdownState }).countdown.status).toBe('idle')
    expect((p as { pomodoro: PomodoroState }).pomodoro.status).toBe('running')
    expect(p.session).toEqual({ focusMin: 25, breakMin: 5, autoStartBreak: true })
    expect(p.ballVisible).toBe(true)
    expect(p.ballPos).toBeNull()
  })
})
