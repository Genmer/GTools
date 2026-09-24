// launcher backend 单测：storage/emit/notification 注入 fake，定时器用 vitest 假时钟，扫描依赖注入。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendContext } from '@sdk/api'
import { createLauncherBackend } from './backend/index'
import type { AppsCache, ScanDeps } from './types'

const POLL_MS = 500
const T0 = Date.parse('2026-09-23T12:00:00Z')

const fakeDeps: ScanDeps = {
  platform: 'darwin',
  homeDir: '/home/u',
  env: {},
  fs: { readdir: async () => [], readFile: async () => '' }
}

function fakeCtx(): {
  ctx: BackendContext
  map: Map<string, unknown>
  emits: { event: string; payload: unknown }[]
  notifications: { title: string; body: string }[]
  failNotification: () => void
} {
  const map = new Map<string, unknown>()
  const emits: { event: string; payload: unknown }[] = []
  const notifications: { title: string; body: string }[] = []
  let notifyShouldFail = false
  const ctx = {
    storage: {
      get: async (key: string): Promise<unknown> => map.get(key) ?? null,
      set: async (key: string, value: unknown): Promise<void> => {
        map.set(key, value)
      }
    },
    notification: {
      show: async (title: string, body: string): Promise<void> => {
        if (notifyShouldFail) throw new Error('notify failed')
        notifications.push({ title, body })
      }
    },
    emit: (event: string, payload: unknown): void => {
      emits.push({ event, payload })
    }
  }
  return {
    ctx: ctx as unknown as BackendContext,
    map,
    emits,
    notifications,
    failNotification: () => {
      notifyShouldFail = true
    }
  }
}

const freshCache = (): AppsCache => ({ version: 1, scannedAt: T0 - 60_000, apps: [{ name: 'Cached', path: '/c.app' }] })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('scanRequest 请求通道的非法输入', () => {
  it('字符串 / NaN / 负无穷请求被忽略，不触发扫描', async () => {
    for (const junk of ['refresh', Number.NaN, Number.NEGATIVE_INFINITY]) {
      const { ctx, map, emits } = fakeCtx()
      map.set('apps', freshCache())
      let calls = 0
      const backend = createLauncherBackend({
        deps: async () => fakeDeps,
        scan: async () => {
          calls++
          return []
        },
        pollMs: POLL_MS
      })
      await backend.init(ctx)
      await backend.start()
      map.set('scanRequest', junk)
      await vi.advanceTimersByTimeAsync(POLL_MS * 3)
      expect(calls).toBe(0)
      expect(emits).toEqual([])
      await backend.stop()
    }
  })

  it('storage.get 读 scanRequest 抛错被容忍（不影响后续轮询）', async () => {
    const { ctx, map, emits } = fakeCtx()
    map.set('apps', freshCache())
    const base = ctx as unknown as { storage: { get(key: string): Promise<unknown> } }
    base.storage.get = async (key: string): Promise<unknown> => {
      if (key === 'scanRequest') throw new Error('storage glitch')
      return map.get(key) ?? null
    }
    let calls = 0
    const backend = createLauncherBackend({
      deps: async () => fakeDeps,
      scan: async () => {
        calls++
        return []
      },
      pollMs: POLL_MS
    })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(calls).toBe(0)
    expect(emits).toEqual([])
    await backend.stop()
  })
})

describe('缓存状态判定', () => {
  it('损坏缓存（版本不符）按无缓存处理 → 启动即补扫', async () => {
    const { ctx, map, emits } = fakeCtx()
    map.set('apps', { version: 2, scannedAt: T0, apps: [] })
    const backend = createLauncherBackend({ deps: async () => fakeDeps, scan: async () => [], pollMs: POLL_MS })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(emits.map((e) => e.event)).toEqual(['scan-started', 'scan-done'])
    expect(emits[0].payload).toEqual({ reason: 'stale' })
    expect((map.get('apps') as AppsCache).version).toBe(1)
  })

  it('scan-done 携带 apps 全量与计数', async () => {
    const { ctx, emits } = fakeCtx()
    const backend = createLauncherBackend({
      deps: async () => fakeDeps,
      scan: async () => [
        { name: 'A', path: '/a.app' },
        { name: 'B', path: '/b.app' }
      ],
      pollMs: POLL_MS
    })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(emits[1].payload).toMatchObject({ reason: 'stale', count: 2 })
    expect((emits[1].payload as { apps: unknown[] }).apps).toHaveLength(2)
  })
})

describe('错误路径', () => {
  it('扫描失败且通知也失败：仍发 scan-error，进程不受影响', async () => {
    const { ctx, emits, notifications, failNotification } = fakeCtx()
    failNotification()
    const backend = createLauncherBackend({
      deps: async () => {
        throw new Error('fs broken')
      },
      scan: async () => [],
      pollMs: POLL_MS
    })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(emits.map((e) => e.event)).toEqual(['scan-started', 'scan-error'])
    expect(emits[1].payload).toMatchObject({ reason: 'stale', message: 'fs broken' })
    expect(notifications).toEqual([])
  })

  it('deps 抛错同样走 scan-error（不只是 scan 本体）', async () => {
    const { ctx, emits } = fakeCtx()
    const backend = createLauncherBackend({
      deps: async () => fakeDeps,
      scan: async () => {
        throw new Error('scan exploded')
      },
      pollMs: POLL_MS
    })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(emits[1].payload).toMatchObject({ message: 'scan exploded' })
  })
})

describe('stop/start 重置请求基准', () => {
  it('同一请求值在重启后再次生效（lastRequest 被 stop 清空）', async () => {
    const { ctx, map } = fakeCtx()
    map.set('apps', freshCache())
    let calls = 0
    const backend = createLauncherBackend({
      deps: async () => fakeDeps,
      scan: async () => {
        calls++
        return []
      },
      pollMs: POLL_MS
    })
    await backend.init(ctx)
    await backend.start()
    map.set('scanRequest', T0 + 10) // 晚于缓存扫描时间 → 触发
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(calls).toBe(1)

    await backend.stop()
    map.set('apps', { version: 1, scannedAt: T0, apps: [] }) // 重启前缓存已新鲜
    await backend.start() // 立即 checkScanRequest：lastRequest=null，req > scannedAt → 再扫
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(calls).toBe(2)
    await backend.stop()
  })
})
