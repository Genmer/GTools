import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendContext } from '@sdk/api'

// 照 storage-cache-disk.test.ts 的内存 fs 脚手架：本文件验证「插件空闲轮询 × 存储内存缓存」
// 的端到端行为——慢档 tick 只经 storage.get 接命令，全命中主进程缓存，零盘读
const mem = vi.hoisted(() => {
  const state = {
    files: new Map<string, string>(),
    reads: 0,
    writes: [] as { file: string; content: string }[],
    renames: [] as { from: string; to: string }[]
  }
  return state
})

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readdir: vi.fn(async () => [] as Array<{ name: string; isDirectory(): boolean }>),
  readFile: vi.fn(async (file: string): Promise<string> => {
    mem.reads++
    const content = mem.files.get(file)
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file: ${file}`) as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }
    return content
  }),
  rename: vi.fn(async (from: string, to: string): Promise<void> => {
    mem.renames.push({ from, to })
    const content = mem.files.get(from)
    mem.files.delete(from)
    if (content !== undefined) mem.files.set(to, content)
  }),
  writeFile: vi.fn(async (file: string, content: string): Promise<void> => {
    mem.writes.push({ file, content })
    mem.files.set(file, content)
  })
}))

import { PluginStorageService } from '../src/main/services/storage'
import { IDLE_POLL_MS, TICK_MS, TimerBackend } from '../src/plugins/timer/backend'
import { CMD_KEY } from '../src/plugins/timer/logic/commands'
import { join } from 'node:path'

const ROOT = '/gtools-test/storage'
const PLUGIN = 'timer'
// storage 内部用 join 拼路径（win 反斜杠），断言键必须同构
const KV = join(ROOT, PLUGIN, 'kv.json')
const STATE_KEY = 'timer-state'

interface FakeTimer {
  id: number
  ms: number
  fn: () => void
}

beforeEach(() => {
  mem.files.clear()
  mem.reads = 0
  mem.writes.length = 0
  mem.renames.length = 0
})

async function makeHarness(): Promise<{
  backend: TimerBackend
  timers: FakeTimer[]
  fireTick: () => Promise<void>
  setSlot: (key: string, value: unknown) => Promise<void>
}> {
  const svc = new PluginStorageService(ROOT)
  const timers: FakeTimer[] = []
  let nextId = 1
  const scheduler = {
    setInterval: (fn: () => void, ms: number): unknown => {
      const t: FakeTimer = { id: nextId++, ms, fn }
      timers.push(t)
      return t.id
    },
    clearInterval: (id: unknown): void => {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    }
  }
  const nowMs = { v: 1_700_000_000_000 }
  const backend = new TimerBackend(scheduler, { now: () => nowMs.v })
  const ctx = {
    storage: {
      get: (key: string) => svc.get(PLUGIN, key),
      set: (key: string, value: unknown) => svc.set(PLUGIN, key, value),
      remove: (key: string) => svc.remove(PLUGIN, key)
    },
    emit: () => {},
    notification: { show: async () => {} },
    events: { on: () => () => {} }
  } as unknown as BackendContext
  await backend.init(ctx)
  const fireTick = async (): Promise<void> => {
    expect(timers).toHaveLength(1)
    timers[0]!.fn()
    await new Promise((r) => setTimeout(r, 0)) // 等 onTick 微任务链走完
  }
  return { backend, timers, fireTick, setSlot: (key, value) => svc.set(PLUGIN, key, value) }
}

describe('计时器 backend 空闲轮询 × 存储内存缓存', () => {
  it('空闲期多轮慢档 tick：零盘读零写，interval 不重建', async () => {
    const h = await makeHarness()
    await h.backend.start()
    expect(h.timers.map((t) => t.ms)).toEqual([IDLE_POLL_MS]) // 空闲慢档
    expect(mem.reads).toBe(1) // 仅 init 恢复状态那一次盘读（文件不存在）

    const timerIdBefore = h.timers[0]!.id
    for (let i = 0; i < 5; i++) await h.fireTick()
    expect(mem.reads).toBe(1) // 命令轮询全走内存缓存
    expect(mem.writes).toHaveLength(0) // 空闲无事可写
    expect(h.timers[0]!.id).toBe(timerIdBefore) // 同档不清不挂

    await h.backend.stop()
    expect(h.timers).toHaveLength(0)
  })

  it('慢档仍接得住命令：storage 槽下发 cd-start 被空闲 tick 接住，切快档且状态落盘（全程零新增盘读）', async () => {
    const h = await makeHarness()
    await h.backend.start()
    await h.fireTick()
    expect(mem.reads).toBe(1)

    // 渲染层等价动作：命令写进 storage 槽（同一 service 实例，写盘但读走缓存）
    await h.setSlot(CMD_KEY, { seq: 1, cmd: { type: 'cd-start', ms: 60_000, label: '' } })
    await h.fireTick() // 空闲慢档 tick 接住命令
    expect(h.backend.snapshot().countdown.status).toBe('running')
    expect(h.timers.map((t) => t.ms)).toEqual([TICK_MS]) // 活跃切快档
    const persisted = JSON.parse(mem.files.get(KV) ?? '{}')[STATE_KEY]
    expect(persisted?.countdown?.status).toBe('running')
    expect(mem.reads).toBe(1) // 命令读取同样命中缓存：全程只有 init 那一次盘读
  })
})
