import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import { TranslateExecutorError, type ExecutorRuntime } from './types'

/** fetchViaNet 不会对 HTTP 非 2xx 抛错（返回 ok:false），服务层异常（如超时）是普通 Error */
const QUOTA_STATUSES = new Set([403, 429, 482])

/** 所有 executor 共用的请求出口：异常按超时/断网分类，HTTP 非 2xx 按 403/429/482 归配额 */
export async function fetchChecked(
  url: string,
  rt: ExecutorRuntime,
  init?: HostFetchInit
): Promise<HostFetchResult> {
  let res: HostFetchResult
  try {
    res = await rt.fetch(url, { timeoutMs: rt.timeoutMs ?? 10_000, ...init })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/time'?out|timed?out|aborted|超时/i.test(msg)) {
      throw new TranslateExecutorError('timeout', '翻译请求超时，请稍后重试')
    }
    throw new TranslateExecutorError('network', `网络请求失败：${msg}`)
  }
  if (!res.ok) {
    if (QUOTA_STATUSES.has(res.status)) {
      throw new TranslateExecutorError('quota', `翻译服务返回 ${res.status}：免费额度受限或请求过于频繁`)
    }
    throw new TranslateExecutorError('http', `翻译服务返回 HTTP ${res.status}`)
  }
  return res
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0'
}

/** MyMemory 等接口会把译文做 HTML 转义（&#39; / &quot;），展示前需还原 */
export function unescapeHtml(s: string): string {
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[body] ?? whole
  })
}
