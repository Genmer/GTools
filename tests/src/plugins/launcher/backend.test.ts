import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendContext } from '@sdk/api'
import { createLauncherBackend } from '../../../../src/plugins/launcher/backend/index'
import { CACHE_STALE_MS, parseCache, type AppEntry, type AppsCache, type ScanDeps } from '../../../../src/plugins/launcher/types'

const POLL_MS = 1000
const T0 = Date.parse('2026-09-23T10:00:00Z')

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
} {
  const map = new Map<string, unknown>()
  const emits: { event: string; payload: unknown }[] = []
  const notifications: { title: string; body: string }[] = []
  const ctx = {
    storage: {
      get: async (key: string): Promise<unknown> => map.get(key) ?? null,
      set: async (key: string, value: unknown): Promise<void> => {
        map.set(key, value)
      }
    },
    notification: {
      show: async (title: string, body: string): Promise<void> => {
        notifications.push({ title, body })
      }
    },
    emit: (event: string, payload: unknown): void => {
      emits.push({ event, payload })
    }
  }
  return { ctx: ctx as unknown as BackendContext, map, emits, notifications }
}

function freshCache(): AppsCache {
  return { version: 1, scannedAt: T0 - 1000, apps: [{ name: 'Old', path: '/old.app' }] }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('launcher backend 生命周期', () => {
  it('未 init 即 start 抛错', async () => {
    const backend = createLauncherBackend({ pollMs: POLL_MS })
    await expect(backend.start()).rejects.toThrow('init')
  })

  it('无缓存 start 触发补扫：事件 + 缓存落盘', async () => {
    const { ctx, map, emits } = fakeCtx()
    let scanCalls = 0
    const backend = createLauncherBackend({
      deps: async () => fakeDeps,
      scan: async () => {
        scanCalls++
        return [{ name: 'Alpha', path: '/Applications/Alpha.app' }]
      },
      pollMs: POLL_MS
    })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(emits.map((e) => e.event)).toEqual(['scan-started', 'scan-done'])
    expect(emits[0].payload).toEqual({ reason: 'stale' })
    expect(emits[1].payload).toMatchObject({ reason: 'stale', count: 1 })
    const cache = parseCache(map.get('apps'))
    expect(cache?.apps).toEqual<AppEntry[]>([{ name: 'Alpha', path: '/Applications/Alpha.app' }])
    expect(scanCalls).toBe(1)
  })

  it('新鲜缓存 start 不重扫', async () => {
    const { ctx, map, emits } = fakeCtx()
    map.set('apps', freshCache())
    const backend = createLauncherBackend({
      deps: async () => fakeDeps,
      scan: async () => {
        throw new Error('不应触发')
      },
      pollMs: POLL_MS
    })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(emits).toEqual([])
  })

  it('过期缓存（>24h）start 补扫', async () => {
    const { ctx, map, emits } = fakeCtx()
    map.set('apps', { version: 1, scannedAt: T0 - CACHE_STALE_MS - 1, apps: [] })
    const backend = createLauncherBackend({ deps: async () => fakeDeps, scan: async () => [], pollMs: POLL_MS })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(emits.map((e) => e.event)).toEqual(['scan-started', 'scan-done'])
  })

  it('手动刷新：scanRequest 变化经轮询触发重扫', async () => {
    const { ctx, map, emits } = fakeCtx()
    map.set('apps', freshCache())
    let scanCalls = 0
    const backend = createLauncherBackend({
      deps: async () => fakeDeps,
      scan: async () => {
        scanCalls++
        return []
      },
      pollMs: POLL_MS
    })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(emits).toEqual([])

    map.set('scanRequest', T0 + 500) // 晚于上次扫描 → 触发
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(scanCalls).toBe(1)
    expect(emits.map((e) => e.event)).toEqual(['scan-started', 'scan-done'])
    expect(emits[0].payload).toEqual({ reason: 'manual' })

    map.set('scanRequest', T0 + 500) // 同值不再触发
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(scanCalls).toBe(1)
  })

  it('早于上次扫描的残留请求只作基准，不触发重扫', async () => {
    const { ctx, map, emits } = fakeCtx()
    map.set('apps', freshCache())
    const backend = createLauncherBackend({ deps: async () => fakeDeps, scan: async () => [], pollMs: POLL_MS })
    await backend.init(ctx)
    await backend.start()
    map.set('scanRequest', T0 - 5000)
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(emits).toEqual([])
  })

  it('stop 后轮询停止', async () => {
    const { ctx, map, emits } = fakeCtx()
    map.set('apps', freshCache())
    const backend = createLauncherBackend({ deps: async () => fakeDeps, scan: async () => [], pollMs: POLL_MS })
    await backend.init(ctx)
    await backend.start()
    await backend.stop()
    map.set('scanRequest', Date.now() + 1)
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(emits).toEqual([])
  })

  it('扫描失败：scan-error 事件 + 通知，且可重试', async () => {
    const { ctx, map, emits, notifications } = fakeCtx()
    let calls = 0
    const backend = createLauncherBackend({
      deps: async () => fakeDeps,
      scan: async () => {
        calls++
        if (calls === 1) throw new Error('disk boom')
        return [{ name: 'Ok', path: '/ok.app' }]
      },
      pollMs: POLL_MS
    })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(emits.map((e) => e.event)).toEqual(['scan-started', 'scan-error'])
    expect(emits[1].payload).toMatchObject({ message: 'disk boom' })
    expect(notifications).toEqual([{ title: '应用扫描失败', body: 'disk boom' }])

    map.set('scanRequest', Date.now() + 10)
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(calls).toBe(2)
    expect(emits.map((e) => e.event)).toEqual(['scan-started', 'scan-error', 'scan-started', 'scan-done'])
    expect(emits[3].payload).toMatchObject({ count: 1 })
  })

  it('扫描进行中的请求不并发触发（单飞），完成后旧请求不补扫', async () => {
    const { ctx, map, emits } = fakeCtx()
    let release!: (apps: AppEntry[]) => void
    let scanCalls = 0
    const backend = createLauncherBackend({
      deps: async () => fakeDeps,
      scan: () =>
        new Promise<AppEntry[]>((resolve) => {
          scanCalls++
          release = (apps) => resolve(apps)
        }),
      pollMs: POLL_MS
    })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(emits.map((e) => e.event)).toEqual(['scan-started'])

    map.set('scanRequest', T0 + 10) // 扫描进行中写入
    await vi.advanceTimersByTimeAsync(POLL_MS) // 轮询 tick 到达，但 scanning 中被跳过
    expect(scanCalls).toBe(1)

    release([{ name: 'X', path: '/x.app' }])
    await vi.advanceTimersByTimeAsync(POLL_MS) // 扫描落盘（scannedAt 已推进到当前假时钟），旧请求只作基准
    expect(scanCalls).toBe(1)
    expect(emits.map((e) => e.event)).toEqual(['scan-started', 'scan-done'])
  })
})
