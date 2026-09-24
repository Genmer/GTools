import { describe, expect, it } from 'vitest'
import {
  HEAL_DELAY_MS,
  TICK_MS,
  TIMER_EVENT,
  TodoPomodoroBackend,
  type BackendScheduler
} from '../../../../src/plugins/todo-pomodoro/backend'
import { CMD_KEY } from '../../../../src/plugins/todo-pomodoro/logic/commands'
import { IDLE_TIMER_STATE, startFocus, toPersistedTimer, pauseTimer } from '../../../../src/plugins/todo-pomodoro/logic/timer'
import { emptyLog, parsePomodoroLog } from '../../../../src/plugins/todo-pomodoro/logic/stats'
import { dateKeyOf } from '../../../../src/plugins/todo-pomodoro/logic/todos'
import type { BackendContext } from '@sdk/api'

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
  created: string[]
  updates: { id: string; html: string }[]
  closed: string[]
  failUpdate: boolean
  lastHtml: string
}

interface Harness {
  backend: TodoPomodoroBackend
  scheduler: ManualScheduler
  storage: Map<string, unknown>
  notifications: { title: string; body: string }[]
  emits: { event: string; payload: unknown }[]
  float: FloatCalls
  flags: { failNotify: boolean }
  setNow(ms: number): void
  sendCmd(cmd: unknown, seq?: number): void
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
  const flags = { failNotify: false }
  let nowMs = T0
  let floatSeq = 0

  const ctx: BackendContext = {
    apiVersion: 1,
    clipboard: {
      readText: async () => '',
      writeText: async () => {},
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
        if (flags.failNotify) throw new Error('notification denied')
        notifications.push({ title, body })
      }
    },
    shell: { openApp: async () => {}, openPath: async () => {}, openExternal: async () => {} },
    window: {
      hide: async () => {},
      float: {
        create: async (opts: { html: string }) => {
          const id = `todo-pomodoro#${++floatSeq}`
          float.created.push(id)
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
    events: { on: () => () => {} },
    emit: (event: string, payload: unknown) => {
      emits.push({ event, payload })
    }
  }

  const backend = new TodoPomodoroBackend(scheduler, { now: () => nowMs })
  await backend.init(ctx)
  await backend.start()

  let cmdSeq = 1000
  return {
    backend,
    scheduler,
    storage,
    notifications,
    emits,
    float,
    flags,
    setNow: (ms: number) => {
      nowMs = ms
    },
    sendCmd: (cmd: unknown, seq?: number) => {
      storage.set(CMD_KEY, { seq: seq ?? ++cmdSeq, cmd })
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

function startCmd(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'start',
    todoId: 't1',
    todoTitle: '写周报',
    focusMin: 25,
    breakMin: 5,
    autoStartBreak: true,
    ...overrides
  }
}

describe('命令 → 计时全链路', () => {
  it('start：进入专注、落盘、发快照、开便签', async () => {
    const h = await makeHarness()
    h.sendCmd(startCmd())
    await h.tick()

    const snap = h.lastSnapshot()
    expect((snap.state as Record<string, unknown>).status).toBe('running')
    expect((snap.state as Record<string, unknown>).phase).toBe('focus')
    expect((snap.state as Record<string, unknown>).endAt).toBe(T0 + 25 * MIN)
    expect((snap.state as Record<string, unknown>).linkedTodoId).toBe('t1')

    const persisted = h.storage.get('timer') as Record<string, unknown>
    expect((persisted.session as Record<string, unknown>).focusMin).toBe(25)
    expect(persisted.noteVisible).toBe(true)

    expect(h.float.created.length).toBe(1)
    expect(h.float.lastHtml).toContain('专注中')
    expect(h.float.lastHtml).toContain('写周报')
  })

  it('专注到期：通知 + 记统计 + 自动进入休息 + 便签刷新', async () => {
    const h = await makeHarness()
    h.sendCmd(startCmd())
    await h.tick()

    const doneAt = T0 + 25 * MIN + 100
    h.setNow(doneAt)
    await h.tick()

    expect(h.notifications.length).toBe(1)
    expect(h.notifications[0]!.title).toBe('🍅 番茄完成！')
    expect(h.notifications[0]!.body).toContain('写周报')

    const log = parsePomodoroLog(h.storage.get('pomodoro-log'))!
    expect(log.entries.length).toBe(1)
    expect(log.entries[0]).toEqual({ ts: doneAt, dateKey: dateKeyOf(doneAt), todoId: 't1' })

    const snap = h.lastSnapshot()
    expect((snap.state as Record<string, unknown>).phase).toBe('break')
    expect((snap.state as Record<string, unknown>).endAt).toBe(doneAt + 5 * MIN)
    expect(snap.todayCount).toBe(1)
    expect(snap.countsByTodo).toEqual({ t1: 1 })
    expect(h.float.lastHtml).toContain('休息中')
  })

  it('休息到期：通知并回空闲', async () => {
    const h = await makeHarness()
    h.sendCmd(startCmd())
    await h.tick()
    h.setNow(T0 + 25 * MIN + 100)
    await h.tick()
    h.setNow(T0 + 30 * MIN + 200)
    await h.tick()

    expect(h.notifications.length).toBe(2)
    expect(h.notifications[1]!.title).toBe('☕ 休息结束')
    const snap = h.lastSnapshot()
    expect((snap.state as Record<string, unknown>).status).toBe('idle')
  })

  it('关闭自动休息：专注到期直接回空闲', async () => {
    const h = await makeHarness()
    h.sendCmd(startCmd({ autoStartBreak: false }))
    await h.tick()
    h.setNow(T0 + 25 * MIN)
    await h.tick()
    expect((h.lastSnapshot().state as Record<string, unknown>).status).toBe('idle')
    expect(parsePomodoroLog(h.storage.get('pomodoro-log'))!.entries.length).toBe(1)
  })

  it('暂停定格剩余、继续按剩余续跑、停止回空闲并关便签', async () => {
    const h = await makeHarness()
    h.sendCmd(startCmd())
    await h.tick()

    h.setNow(T0 + 5 * MIN)
    h.sendCmd({ type: 'pause' })
    await h.tick()
    let state = h.lastSnapshot().state as Record<string, unknown>
    expect(state.status).toBe('paused')
    expect(state.remainingMs).toBe(20 * MIN)

    h.setNow(T0 + 6 * MIN)
    h.sendCmd({ type: 'resume' })
    await h.tick()
    state = h.lastSnapshot().state as Record<string, unknown>
    expect(state.status).toBe('running')
    expect(state.endAt).toBe(T0 + 6 * MIN + 20 * MIN)

    h.sendCmd({ type: 'stop' })
    await h.tick()
    state = h.lastSnapshot().state as Record<string, unknown>
    expect(state.status).toBe('idle')
    const persisted = h.storage.get('timer') as Record<string, unknown>
    expect(persisted.session).toBeNull()
    expect(h.float.closed.length).toBe(1)
  })

  it('跳过专注：进休息但不记统计；跳过休息：回空闲', async () => {
    const h = await makeHarness()
    h.sendCmd(startCmd())
    await h.tick()
    h.sendCmd({ type: 'skip' })
    await h.tick()
    let state = h.lastSnapshot().state as Record<string, unknown>
    expect(state.phase).toBe('break')
    // 跳过不算完成：日志键可能从未写过
    expect(parsePomodoroLog(h.storage.get('pomodoro-log'))?.entries.length ?? 0).toBe(0)
    expect(h.notifications.length).toBe(0)

    h.sendCmd({ type: 'skip' })
    await h.tick()
    state = h.lastSnapshot().state as Record<string, unknown>
    expect(state.status).toBe('idle')
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
})

describe('便签浮窗', () => {
  it('note-toggle 关闭后再打开（空闲态强制创建）', async () => {
    const h = await makeHarness()
    h.sendCmd(startCmd())
    await h.tick()
    expect(h.float.created.length).toBe(1)

    h.sendCmd({ type: 'note-toggle', visible: false })
    await h.tick()
    expect(h.float.closed.length).toBe(1)
    expect((h.storage.get('timer') as Record<string, unknown>).noteVisible).toBe(false)

    h.sendCmd({ type: 'note-toggle', visible: true })
    await h.tick()
    expect(h.float.created.length).toBe(2)
    expect(h.float.lastHtml).toContain('专注中')
  })

  it('用户手动关掉便签后：不再复活，noteVisible 落盘为 false', async () => {
    const h = await makeHarness()
    h.sendCmd(startCmd())
    await h.tick()
    h.float.failUpdate = true

    h.setNow(T0 + 25 * MIN)
    await h.tick()
    expect((h.storage.get('timer') as Record<string, unknown>).noteVisible).toBe(false)
    expect(h.lastSnapshot().noteVisible).toBe(false)
    // 统计不受便签失败影响
    expect(parsePomodoroLog(h.storage.get('pomodoro-log'))!.entries.length).toBe(1)
  })
})

describe('重启恢复', () => {
  it('离开期间专注到期：补记统计 + 一次性告知，不自动开始休息', async () => {
    const running = startFocus(IDLE_TIMER_STATE, { focusMin: 25, breakMin: 5, autoStartBreak: true, todoId: 't1', todoTitle: '写周报' }, T0 - 35 * MIN)
    const h = await makeHarness({
      timer: toPersistedTimer(running, { focusMin: 25, breakMin: 5, autoStartBreak: true }, true),
      'pomodoro-log': emptyLog()
    })

    expect(h.notifications.length).toBe(1)
    expect(h.notifications[0]!.title).toContain('应用关闭期间')
    const log = parsePomodoroLog(h.storage.get('pomodoro-log'))!
    expect(log.entries.length).toBe(1)
    expect(log.entries[0]!.todoId).toBe('t1')

    const snap = h.lastSnapshot()
    expect((snap.state as Record<string, unknown>).status).toBe('idle')
    expect(h.float.created.length).toBe(0)
  })

  it('未到期的运行会话：恢复并重建便签', async () => {
    const running = startFocus(IDLE_TIMER_STATE, { focusMin: 25, breakMin: 5, autoStartBreak: true, todoId: null, todoTitle: '' }, T0)
    const h = await makeHarness({ timer: toPersistedTimer(running, { focusMin: 25, breakMin: 5, autoStartBreak: true }, true) })
    const snap = h.lastSnapshot()
    expect((snap.state as Record<string, unknown>).status).toBe('running')
    expect((snap.state as Record<string, unknown>).endAt).toBe(T0 + 25 * MIN)
    expect(h.float.created.length).toBe(1)
  })

  it('暂停态：原样恢复剩余时间', async () => {
    const paused = pauseTimer(
      startFocus(IDLE_TIMER_STATE, { focusMin: 25, breakMin: 5, autoStartBreak: true, todoId: null, todoTitle: '' }, T0),
      T0 + 5 * MIN
    )
    const h = await makeHarness({ timer: toPersistedTimer(paused, { focusMin: 25, breakMin: 5, autoStartBreak: true }, false) })
    const state = h.lastSnapshot().state as Record<string, unknown>
    expect(state.status).toBe('paused')
    expect(state.remainingMs).toBe(20 * MIN)
    expect(h.lastSnapshot().noteVisible).toBe(false)
  })
})

describe('统计落盘自愈', () => {
  it('并发写覆盖丢失日志后，复查延迟点重写找回', async () => {
    const h = await makeHarness()
    h.sendCmd(startCmd())
    await h.tick()

    const doneAt = T0 + 25 * MIN
    h.setNow(doneAt)
    await h.tick()
    expect(parsePomodoroLog(h.storage.get('pomodoro-log'))!.entries.length).toBe(1)

    // 模拟渲染层并发写用旧快照覆盖了整个 kv.json（backend 的日志键被抹掉）
    h.storage.set('pomodoro-log', emptyLog())
    h.setNow(doneAt + HEAL_DELAY_MS + 100)
    await h.tick()
    expect(parsePomodoroLog(h.storage.get('pomodoro-log'))!.entries.length).toBe(1)
  })
})

describe('快照与生命周期', () => {
  it('空存储启动：空闲 + 今日 0 + noteVisible 默认 true', async () => {
    const h = await makeHarness()
    const snap = h.lastSnapshot()
    expect((snap.state as Record<string, unknown>).status).toBe('idle')
    expect(snap.todayCount).toBe(0)
    expect(snap.totalCount).toBe(0)
    expect(snap.noteVisible).toBe(true)
  })

  it('跨日统计：旧日记录不进今日数', async () => {
    const h = await makeHarness({
      'pomodoro-log': { v: 1, entries: [{ ts: T0 - 1, dateKey: '2000-01-01', todoId: 't1' }] }
    })
    expect(h.lastSnapshot().todayCount).toBe(0)
    expect(h.lastSnapshot().totalCount).toBe(1)
  })

  it('start 只挂一个 interval，stop 清理', async () => {
    const h = await makeHarness()
    expect(h.scheduler.live().length).toBe(1)
    expect(h.scheduler.live()[0]!.ms).toBe(TICK_MS)
    await h.backend.start() // 幂等
    expect(h.scheduler.live().length).toBe(1)
    await h.backend.stop()
    expect(h.scheduler.live().length).toBe(0)
  })

  it('通知抛错不影响计时与统计', async () => {
    const h = await makeHarness()
    h.sendCmd(startCmd())
    await h.tick()
    h.flags.failNotify = true
    h.setNow(T0 + 25 * MIN)
    await h.tick()
    expect(h.notifications.length).toBe(0)
    const state = h.lastSnapshot().state as Record<string, unknown>
    expect(state.phase).toBe('break') // 自动休息照常推进
    expect(parsePomodoroLog(h.storage.get('pomodoro-log'))!.entries.length).toBe(1)
  })
})
