import { afterEach, describe, expect, it } from 'vitest'
import type { HostApi } from '@sdk/api'
import {
  cancelAllPendingClears,
  pendingClearCount,
  resolveClear,
  scheduleClipboardClear
} from '../../../../src/plugins/password-vault/logic/clipboard-clear'

interface FakeClipboard {
  current: string
  failRead?: boolean
  writes: string[]
}

function fakeHost(clip: FakeClipboard): HostApi {
  return {
    clipboard: {
      readText: async () => {
        if (clip.failRead) throw new Error('clipboard busy')
        return clip.current
      },
      writeText: async (t: string) => {
        clip.writes.push(t)
        clip.current = t
      }
    }
  } as unknown as HostApi
}

function fakeScheduler(): {
  scheduler: { setTimeout(fn: () => void, ms: number): number; clearTimeout(id: number): void }
  fireAll(): void
  count(): number
} {
  const tasks = new Map<number, () => void>()
  let seq = 0
  return {
    scheduler: {
      setTimeout: (fn, _ms) => {
        const id = ++seq
        tasks.set(id, fn)
        return id
      },
      clearTimeout: (id) => tasks.delete(id as number)
    },
    fireAll: () => {
      for (const fn of [...tasks.values()]) fn()
    },
    count: () => tasks.size
  }
}

const flush = async (): Promise<void> => new Promise((r) => setTimeout(r, 0))

// 模块级 pending 跨测试残留会污染计数，逐用例清场
afterEach(() => cancelAllPendingClears())

describe('resolveClear 到期动作', () => {
  it('剪贴板仍是该密码 → 清空', async () => {
    const clip: FakeClipboard = { current: 'pw123', writes: [] }
    await expect(resolveClear(fakeHost(clip), 'pw123')).resolves.toBe('cleared')
    expect(clip.writes).toEqual([''])
  })
  it('用户已复制其他内容 → 跳过（不清掉新内容）', async () => {
    const clip: FakeClipboard = { current: '别的内容', writes: [] }
    await expect(resolveClear(fakeHost(clip), 'pw123')).resolves.toBe('skipped')
    expect(clip.writes).toEqual([])
  })
  it('读取失败（如被其他进程占用）→ 宁可清空', async () => {
    const clip: FakeClipboard = { current: 'pw123', failRead: true, writes: [] }
    await expect(resolveClear(fakeHost(clip), 'pw123')).resolves.toBe('cleared')
    expect(clip.writes).toEqual([''])
  })
})

describe('scheduleClipboardClear', () => {
  it('到期触发清空并退出 pending', async () => {
    const f = fakeScheduler()
    const clip: FakeClipboard = { current: 'pw123', writes: [] }
    scheduleClipboardClear(fakeHost(clip), 'pw123', 30_000, f.scheduler)
    expect(pendingClearCount()).toBe(1)
    f.fireAll()
    await flush()
    expect(clip.writes).toEqual([''])
    expect(pendingClearCount()).toBe(0)
  })
  it('到期时剪贴板已被覆盖 → 跳过清空', async () => {
    const f = fakeScheduler()
    const clip: FakeClipboard = { current: 'pw123', writes: [] }
    scheduleClipboardClear(fakeHost(clip), 'pw123', 30_000, f.scheduler)
    clip.current = '用户后来复制的'
    f.fireAll()
    await flush()
    expect(clip.writes).toEqual([])
  })
  it('空文本不排任务', () => {
    const f = fakeScheduler()
    scheduleClipboardClear(fakeHost({ current: '', writes: [] }), '', 30_000, f.scheduler)
    expect(pendingClearCount()).toBe(0)
    expect(f.count()).toBe(0)
  })
  it('多条并行任务各自独立判断', async () => {
    const f = fakeScheduler()
    const clip: FakeClipboard = { current: 'pw2', writes: [] }
    scheduleClipboardClear(fakeHost(clip), 'pw1', 30_000, f.scheduler)
    scheduleClipboardClear(fakeHost(clip), 'pw2', 30_000, f.scheduler)
    expect(pendingClearCount()).toBe(2)
    f.fireAll()
    await flush()
    // pw1 的任务发现剪贴板已是 pw2 → 跳过；pw2 的任务清空
    expect(clip.writes).toEqual([''])
    expect(pendingClearCount()).toBe(0)
  })
  it('cancelAllPendingClears 后到期不再清空', async () => {
    const f = fakeScheduler()
    const clip: FakeClipboard = { current: 'pw', writes: [] }
    scheduleClipboardClear(fakeHost(clip), 'pw', 30_000, f.scheduler)
    cancelAllPendingClears()
    expect(f.count()).toBe(0)
    expect(pendingClearCount()).toBe(0)
    f.fireAll()
    await flush()
    expect(clip.writes).toEqual([])
  })
})
