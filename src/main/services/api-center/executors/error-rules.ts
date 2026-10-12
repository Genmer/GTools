import type { ApiErrorKind } from '../types'

/** 可触发容灾切换的错误类别：凭证/配额/服务端故障换一家引擎可能成功；
 *  timeout/network 与本机环境相关、parse/config 与请求内容或配置相关，换家大概率同因故立即终止 */
export const FALLBACK_ELIGIBLE_KINDS: ReadonlySet<ApiErrorKind> = new Set(['auth', 'quota', 'http'])

/** HTTP 状态码 → 错误类别：overrides 优先（各家特判就近传入），默认 5xx→http、401→auth、429/456/482→quota、其余 4xx→config */
export function httpStatusToKind(status: number, overrides?: Record<number, ApiErrorKind>): ApiErrorKind {
  const kind = overrides?.[status]
  if (kind !== undefined) return kind
  if (status >= 500) return 'http'
  if (status === 401) return 'auth'
  if (status === 429 || status === 456 || status === 482) return 'quota'
  if (status >= 400) return 'config'
  return 'http'
}
