import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BackendContext } from '@sdk/api'
import {
  LanFileShareBackend,
  createLanFileShareBackend,
  type LanShareDeps
} from '../../../../src/plugins/lan-file-share/backend/index'
import { CONTROL_KEY, STATE_KEY, type ShareState } from '../../../../src/plugins/lan-file-share/shared'
import { createFakeCtx } from './fake-ctx'

const POLL_MS = 1000
const T0 = Date.parse('2026-09-24T10:00:00Z')

class FakeServer {
  readonly errorCbs = new Set<(e: Error) => void>()
  onceError: ((e: Error) => void) | null = null
  listeningPort: number | null = null
  closed = false
  constructor(readonly failPorts: ReadonlySet<number>) {}
  on(event: 'error', cb: (err: Error) => void): this {
    if (event === 'error') this.errorCbs.add(cb)
    return this
  }
  once(event: 'error', cb: (err: Error) => void): this {
    if (event === 'error') this.onceError = cb
    return this
  }
  listen(port: number, _host: string, onListening: () => void): this {
    if (this.failPorts.has(port)) {
      const err = Object.assign(new Error(`listen EADDRINUSE :::${port}`), { code: 'EADDRINUSE' })
      for (const cb of this.errorCbs) cb(err)
      this.onceError?.(err)
      return this
    }
    this.listeningPort = port
    onListening()
    return this
  }
  address(): { port: number } | null {
    return this.listeningPort === null ? null : { port: this.listeningPort }
  }
  close(cb?: (err?: Error | null) => void): this {
    this.closed = true
    this.listeningPort = null
    cb?.(null)
    return this
  }
  closeAllConnections(): void {}
}

function fakeDeps(failPorts: number[] = []): { deps: LanShareDeps; servers: FakeServer[] } {
  const servers: FakeServer[] = []
  const fails = new Set(failPorts)
  const deps: LanShareDeps = {
    now: () => Date.now(),
    deflate: (b) => b,
    createServer: () => {
      const s = new FakeServer(fails)
      servers.push(s)
      return s
    },
    listen: (server, port, host) =>
      new Promise<number>((resolve, reject) => {
        server.on('error', () => {})
        server.once('error', reject)
        server.listen(port, host, () => resolve(port))
      }),
    close: async (server) => {
      server.close()
    }
  }
  return { deps, servers }
}

function stateOf(backend: LanFileShareBackend): ShareState {
  return backend.snapshot()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('lan-file-share backend 生命周期', () => {
  it('未 init 即 start 抛错', async () => {
    const backend = createLanFileShareBackend({ pollMs: POLL_MS })
    await expect(backend.start()).rejects.toThrow('init')
  })

  it('init 重置上次残留 running 状态并吃掉旧控制请求，不补启动', async () => {
    const { ctx, storageMap } = createFakeCtx({ '/share/a.txt': 'x' })
    storageMap.set(STATE_KEY, { running: true, port: 3776, dir: '/share', lastHandledId: 0, devices: [], log: [{ t: 1, kind: 'start', device: '本机' }] })
    storageMap.set(CONTROL_KEY, { id: 9, op: 'start', dir: '/share', port: 3776 })
    const { deps, servers } = fakeDeps()
    const backend = new LanFileShareBackend({ pollMs: POLL_MS, deps: () => Promise.resolve(deps) })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)

    expect(servers).toHaveLength(0) // 残留请求只作基准
    const s = stateOf(backend)
    expect(s.running).toBe(false) // 进程重启后服务不可能存活
    expect(s.lastHandledId).toBe(9)
    expect(s.log.map((e) => e.kind)).toEqual(['start']) // 上次日志保留
  })

  it('start 控制启动服务：监听/状态回显/日志/emit/落盘', async () => {
    const { ctx, storageMap, emits } = createFakeCtx({ '/share/a.txt': 'x' })
    const { deps, servers } = fakeDeps()
    const backend = new LanFileShareBackend({ pollMs: POLL_MS, deps: () => Promise.resolve(deps) })
    await backend.init(ctx)
    await backend.start()
    await vi.advanceTimersByTimeAsync(0)

    storageMap.set(CONTROL_KEY, { id: 10, op: 'start', dir: '/share', port: 3776 })
    await vi.advanceTimersByTimeAsync(POLL_MS)

    expect(servers).toHaveLength(1)
    expect(servers[0].listeningPort).toBe(3776)
    const s = stateOf(backend)
    expect(s.running).toBe(true)
    expect(s.port).toBe(3776)
    expect(s.dir).toBe('/share')
    expect(s.lastHandledId).toBe(10)
    expect(s.error).toBeNull()
    expect(s.log.at(-1)?.kind).toBe('start')
    expect(emits.some((e) => e.event === 'state' && (e.payload as ShareState).running)).toBe(true)
    const persisted = storageMap.get(STATE_KEY) as ShareState
    expect(persisted.running).toBe(true)
  })

  it('共享目录不存在：错误状态且不创建监听', async () => {
    const { ctx, storageMap } = createFakeCtx()
    const { deps, servers } = fakeDeps()
    const backend = new LanFileShareBackend({ pollMs: POLL_MS, deps: () => Promise.resolve(deps) })
    await backend.init(ctx)
    await backend.start()
    storageMap.set(CONTROL_KEY, { id: 11, op: 'start', dir: '/nope', port: 3776 })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(servers).toHaveLength(0)
    const s = stateOf(backend)
    expect(s.running).toBe(false)
    expect(s.error).toContain('共享目录不存在')
    expect(s.lastHandledId).toBe(11) // 失败也确认，渲染层据此展示错误
  })

  it('端口被占自动顺延一位', async () => {
    const { ctx, storageMap } = createFakeCtx({ '/share/a.txt': 'x' })
    const { deps, servers } = fakeDeps([3776])
    const backend = new LanFileShareBackend({ pollMs: POLL_MS, deps: () => Promise.resolve(deps) })
    await backend.init(ctx)
    await backend.start()
    storageMap.set(CONTROL_KEY, { id: 12, op: 'start', dir: '/share', port: 3776 })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(servers[0].listeningPort).toBe(3777)
    expect(stateOf(backend).port).toBe(3777)
  })

  it('候选端口全部失败：错误状态并关闭句柄', async () => {
    const { ctx, storageMap } = createFakeCtx({ '/share/a.txt': 'x' })
    const fails = Array.from({ length: 10 }, (_, i) => 3776 + i)
    const { deps, servers } = fakeDeps(fails)
    const backend = new LanFileShareBackend({ pollMs: POLL_MS, deps: () => Promise.resolve(deps) })
    await backend.init(ctx)
    await backend.start()
    storageMap.set(CONTROL_KEY, { id: 13, op: 'start', dir: '/share', port: 3776 })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(servers[0].closed).toBe(true)
    const s = stateOf(backend)
    expect(s.running).toBe(false)
    expect(s.error).toContain('端口不可用')
  })

  it('stop 控制关闭服务；重复 id 不再执行', async () => {
    const { ctx, storageMap } = createFakeCtx({ '/share/a.txt': 'x' })
    const { deps, servers } = fakeDeps()
    const backend = new LanFileShareBackend({ pollMs: POLL_MS, deps: () => Promise.resolve(deps) })
    await backend.init(ctx)
    await backend.start()
    storageMap.set(CONTROL_KEY, { id: 20, op: 'start', dir: '/share', port: 3776 })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(stateOf(backend).running).toBe(true)

    storageMap.set(CONTROL_KEY, { id: 21, op: 'stop' })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(servers[0].closed).toBe(true)
    const s = stateOf(backend)
    expect(s.running).toBe(false)
    expect(s.lastHandledId).toBe(21)
    expect(s.log.at(-1)?.kind).toBe('stop')

    // 同 id 重写不触发（servers 未新增，也未被再次 close 改动状态）
    storageMap.set(CONTROL_KEY, { id: 21, op: 'stop' })
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(stateOf(backend).lastHandledId).toBe(21)
  })

  it('backend.stop()（禁用/退出）关服务并停止轮询', async () => {
    const { ctx, storageMap } = createFakeCtx({ '/share/a.txt': 'x' })
    const { deps, servers } = fakeDeps()
    const backend = new LanFileShareBackend({ pollMs: POLL_MS, deps: () => Promise.resolve(deps) })
    await backend.init(ctx as BackendContext)
    await backend.start()
    storageMap.set(CONTROL_KEY, { id: 30, op: 'start', dir: '/share', port: 3776 })
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(stateOf(backend).running).toBe(true)

    await backend.stop()
    expect(servers[0].closed).toBe(true)
    expect(stateOf(backend).running).toBe(false)

    storageMap.set(CONTROL_KEY, { id: 31, op: 'start', dir: '/share', port: 3776 })
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(stateOf(backend).running).toBe(false) // 轮询已停，不再响应
  })
})
