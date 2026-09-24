import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import type { HotSource } from './sources'
import { markNew } from './snapshot'
import type { BoardData } from './types'

export type FetchLike = (url: string, init?: HostFetchInit) => Promise<HostFetchResult>

export interface BoardOutcome {
  sourceId: string
  ok: boolean
  data?: BoardData
  error?: string
}

export const FETCH_TIMEOUT_MS = 10_000

/** 单平台拉取：网络异常/HTTP 非 2xx/解析失败统一抛带平台名的可读错误 */
export async function fetchBoard(fetchLike: FetchLike, source: HotSource, timeoutMs: number = FETCH_TIMEOUT_MS): Promise<BoardData> {
  let res: HostFetchResult
  try {
    res = await fetchLike(source.url, { headers: { ...source.headers }, timeoutMs })
  } catch (err) {
    throw new Error(`${source.name}：${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) throw new Error(`${source.name}：HTTP ${res.status}`)
  return { fetchedAt: Date.now(), items: source.parse(res.body) }
}

/**
 * 全平台并行刷新，单平台失败不影响其他平台（outcomes 逐平台带 ok/error）；
 * 成功的平台先用上一轮快照 keys 标『新上榜』再返回。
 */
export async function refreshAllBoards(
  fetchLike: FetchLike,
  sources: readonly HotSource[],
  prev: Readonly<Record<string, BoardData>>
): Promise<BoardOutcome[]> {
  return Promise.all(
    sources.map(async (source): Promise<BoardOutcome> => {
      try {
        const data = await fetchBoard(fetchLike, source)
        const prevKeys = (prev[source.id]?.items ?? []).map((i) => i.key)
        return { sourceId: source.id, ok: true, data: { ...data, items: markNew(data.items, prevKeys) } }
      } catch (err) {
        return { sourceId: source.id, ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    })
  )
}
