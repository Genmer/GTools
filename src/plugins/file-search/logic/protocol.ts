import type { FileHit } from './parse'

// 渲染层 ↔ backend 约定：BackendContext 没有渲染→backend 的直调通道，storage 写请求 + emit 回结果是
// 协议内唯一通路（同 launcher 的 scanRequest）。seq 用 Date.now() 保证插件多次进出全局单调。

export const REQ_KEY = 'searchReq'
export const RESULTS_EVENT = 'search-results'
export const ERROR_EVENT = 'search-error'

export interface SearchRequest {
  q: string
  seq: number
}

export interface SearchResultsPayload {
  seq: number
  q: string
  hits: FileHit[]
  /** Spotlight 实际命中总数（可能多于 hits 截断） */
  total: number
  elapsedMs: number
}

export type SearchErrorCode = 'UNSUPPORTED_PLATFORM' | 'SEARCH_FAILED'

export interface SearchErrorPayload {
  seq: number
  q: string
  code: SearchErrorCode
  message: string
}

export const PLATFORM_HINT = '当前平台暂不支持：Windows 版本地搜索规划中（可先用 macOS 的 Spotlight）'
