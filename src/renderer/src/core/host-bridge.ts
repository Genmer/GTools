import type { GtoolsBridge } from '../env'
import { deepToPlain } from './deep-to-plain'

// gtools:host 渲染层单点：载荷先 deepToPlain 解代理再过桥（桥面结构化克隆遇 reactive 代理即抛）
export function host(api: string, payload?: unknown): ReturnType<GtoolsBridge['host']> {
  return window.gtools.host(api, deepToPlain(payload))
}
