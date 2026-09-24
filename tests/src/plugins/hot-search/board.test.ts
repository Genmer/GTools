import { describe, expect, it } from 'vitest'
import type { HostFetchInit, HostFetchResult } from '../../../../sdk/api'
import { fetchBoard, refreshAllBoards, type FetchLike } from '../../../../src/plugins/hot-search/logic/board'
import { HOT_SOURCES } from '../../../../src/plugins/hot-search/logic/sources'
import type { HotSource } from '../../../../src/plugins/hot-search/logic/sources'
import type { BoardData } from '../../../../src/plugins/hot-search/logic/types'

const OK = (body: string): HostFetchResult => ({ ok: true, status: 200, body })

function fakeSource(id: string, name: string): HotSource {
  return { id, name, icon: 'x', url: `https://example.com/${id}`, parse: () => [{ key: 'k', title: 'k', url: 'https://example.com' }] }
}

const weibo = HOT_SOURCES.find((s) => s.id === 'weibo')!
const baidu = HOT_SOURCES.find((s) => s.id === 'baidu')!

const weiboBody = JSON.stringify({ data: { realtime: [{ word: '新词条', num: 100 }, { word: '旧词条', num: 90 }] } })
const baiduBody = JSON.stringify({ data: { cards: [{ component: 'hotList', content: [{ word: '百度词条', hotScore: '5' }] }] } })

describe('fetchBoard 单平台拉取', () => {
  it('成功路径：透传 headers/timeout，返回解析后的条目与时间戳', async () => {
    const calls: Array<{ url: string; init?: HostFetchInit }> = []
    const fetchLike: FetchLike = async (url, init) => {
      calls.push({ url, init })
      return OK(weiboBody)
    }
    const data = await fetchBoard(fetchLike, weibo, 5_000)
    expect(data.items.map((i) => i.title)).toEqual(['新词条', '旧词条'])
    expect(data.fetchedAt).toBeLessThanOrEqual(Date.now())
    expect(calls[0].url).toBe(weibo.url)
    expect(calls[0].init?.timeoutMs).toBe(5_000)
    expect(calls[0].init?.headers?.Referer).toBe('https://weibo.com')
  })

  it('HTTP 非 2xx 与网络异常都变成带平台名的 Error', async () => {
    await expect(fetchBoard(async () => ({ ok: false, status: 502, body: '' }), weibo)).rejects.toThrowError(/微博：HTTP 502/)
    await expect(
      fetchBoard(async () => {
        throw new Error('net::ERR_CONNECTION_RESET')
      }, weibo)
    ).rejects.toThrowError(/微博：net::ERR_CONNECTION_RESET/)
  })

  it('解析失败（接口结构变化）也抛带平台名的错误', async () => {
    await expect(fetchBoard(async () => OK('oops'), weibo)).rejects.toThrowError(/微博：/)
  })
})

describe('refreshAllBoards 全平台刷新', () => {
  it('单平台失败不影响其他平台，成功的按上轮快照标新', async () => {
    const prev: Record<string, BoardData> = {
      weibo: { fetchedAt: 1, items: [{ key: '旧词条', title: '旧词条', url: 'https://example.com' }] },
      baidu: { fetchedAt: 1, items: [{ key: '不存在的旧词', title: 'x', url: 'https://example.com' }] }
    }
    const fetchLike: FetchLike = async (url) => {
      if (url === weibo.url) return OK(weiboBody)
      if (url === baidu.url) return OK(baiduBody)
      throw new Error('断网')
    }
    const outcomes = await refreshAllBoards(fetchLike, [weibo, baidu], prev)
    expect(outcomes).toHaveLength(2)
    const weiboOut = outcomes.find((o) => o.sourceId === 'weibo')!
    const baiduOut = outcomes.find((o) => o.sourceId === 'baidu')!
    expect(weiboOut.ok).toBe(true)
    // 旧词条在上轮快照中 → 不标新；新词条不在 → 标新
    expect(weiboOut.data!.items.find((i) => i.key === '新词条')?.isNew).toBe(true)
    expect(weiboOut.data!.items.find((i) => i.key === '旧词条')?.isNew).toBe(false)
    expect(baiduOut.ok).toBe(true)
    expect(baiduOut.data!.items[0].isNew).toBe(true)
  })

  it('全部失败时每平台带回 ok:false 与错误文案（不清空旧数据）', async () => {
    const outcomes = await refreshAllBoards(
      async () => {
        throw new Error('timeout')
      },
      [fakeSource('a', '甲'), fakeSource('b', '乙')],
      {}
    )
    expect(outcomes.map((o) => o.ok)).toEqual([false, false])
    expect(outcomes[0].error).toContain('甲')
    expect(outcomes[0].data).toBeUndefined()
  })
})
