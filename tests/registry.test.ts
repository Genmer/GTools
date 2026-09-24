import { afterEach, describe, expect, it, vi } from 'vitest'
import { getPluginEntryLoader, loadWithRetry } from '../src/renderer/src/core/registry'

afterEach(() => {
  vi.useRealTimers()
})

describe('loadWithRetry 指数退避重试（插件视图异步加载容错）', () => {
  it('首次加载成功则不重试不等待', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const loader = vi.fn(async () => 'ok')
    await expect(loadWithRetry(loader)).resolves.toBe('ok')
    expect(loader).toHaveBeenCalledTimes(1)
    expect(setTimeoutSpy).not.toHaveBeenCalled()
  })

  it('瞬时失败后重试可恢复（默认最多 3 次重试内成功）', async () => {
    vi.useFakeTimers()
    let calls = 0
    const loader = vi.fn(async () => {
      calls++
      if (calls < 3) throw new Error('ChunkLoadError')
      return 'recovered'
    })
    const p = loadWithRetry(loader)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(p).resolves.toBe('recovered')
    expect(loader).toHaveBeenCalledTimes(3)
  })

  it('初始 1 次 + 重试 3 次全失败才抛最后一个错误', async () => {
    vi.useFakeTimers()
    const first = new Error('fail-1')
    const last = new Error('fail-4')
    let calls = 0
    const loader = vi.fn(async () => {
      calls++
      throw calls === 1 ? first : calls === 4 ? last : new Error(`fail-${calls}`)
    })
    const p = loadWithRetry(loader)
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(300 + 600 + 1200)
    await expect(p).rejects.toBe(last)
    expect(loader).toHaveBeenCalledTimes(4)
  })

  it('退避间隔按 300/600/1200 指数递增', async () => {
    vi.useFakeTimers()
    const stamps: number[] = []
    const loader = vi.fn(async () => {
      stamps.push(Date.now())
      throw new Error('offline')
    })
    const p = loadWithRetry(loader)
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(2100)
    await expect(p).rejects.toThrow('offline')
    expect(stamps).toHaveLength(4)
    expect(stamps[1] - stamps[0]).toBe(300)
    expect(stamps[2] - stamps[1]).toBe(600)
    expect(stamps[3] - stamps[2]).toBe(1200)
  })

  it('自定义 retries 与 baseDelay 生效', async () => {
    vi.useFakeTimers()
    const stamps: number[] = []
    let calls = 0
    const loader = vi.fn(async () => {
      stamps.push(Date.now())
      calls++
      if (calls < 2) throw new Error('flaky')
      return 'ok'
    })
    const p = loadWithRetry(loader, 1, 50)
    await vi.advanceTimersByTimeAsync(100)
    await expect(p).resolves.toBe('ok')
    expect(loader).toHaveBeenCalledTimes(2)
    expect(stamps[1] - stamps[0]).toBe(50)
  })

  it('重试次数用尽后（自定义 retries=1）抛错且不再调用', async () => {
    vi.useFakeTimers()
    const loader = vi.fn(async () => {
      throw new Error('always')
    })
    const p = loadWithRetry(loader, 1)
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(300)
    await expect(p).rejects.toThrow('always')
    expect(loader).toHaveBeenCalledTimes(2)
  })
})

describe('getPluginEntryLoader 插件入口发现', () => {
  it('未注册的插件 id 返回 null（视图降级为「插件视图未找到」）', () => {
    expect(getPluginEntryLoader('no-such-plugin')).toBeNull()
  })

  it('内置插件 id 返回懒加载 thunk（不在此处触发加载）', () => {
    const loader = getPluginEntryLoader('calc')
    expect(typeof loader).toBe('function')
  })
})
