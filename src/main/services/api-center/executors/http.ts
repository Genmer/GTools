import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import type { ApiErrorKind } from '../types'
import { httpStatusToKind } from './error-rules'
import { TranslateExecutorError, type ExecutorRuntime } from './types'

/** 与宿主 net.fetch 同构的注入面：装配时传 fetchViaNet，测试传 fake */
export type FetchFn = (url: string, init?: HostFetchInit) => Promise<HostFetchResult>

export interface FetchCheckedOpts {
  /** 该引擎的 HTTP 状态特判表（如 mymemory 403→quota），其余状态走 httpStatusToKind 默认规则 */
  statusKinds?: Record<number, ApiErrorKind>
  /** true 时非 2xx 不抛，返回响应由调用方读 body 错误文案后自行分类（DeepL/混元等需要 body message 的引擎用） */
  passHttpError?: boolean
  /** 错误文案品类前缀（如「AI 服务」），缺省用默认文案 */
  label?: string
}

/** 所有 executor 共用的请求出口：异常按超时/断网分类，HTTP 非 2xx 按 httpStatusToKind 归类 */
export async function fetchChecked(
  url: string,
  rt: ExecutorRuntime,
  init?: HostFetchInit,
  opts?: FetchCheckedOpts
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
  if (!res.ok && !opts?.passHttpError) {
    const kind = httpStatusToKind(res.status, opts?.statusKinds)
    throw new TranslateExecutorError(
      kind,
      opts?.label !== undefined && opts.label !== '' ? `${opts.label}返回 HTTP ${res.status}` : httpStatusMessage(res.status, kind)
    )
  }
  return res
}

function httpStatusMessage(status: number, kind: ApiErrorKind): string {
  if (kind === 'quota') return `翻译服务返回 ${status}：免费额度受限或请求过于频繁`
  if (kind === 'auth') return `翻译服务返回 HTTP ${status}：凭证无效或未授权`
  if (kind === 'config') return `翻译服务返回 HTTP ${status}：请求被服务方拒绝`
  return `翻译服务返回 HTTP ${status}`
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
