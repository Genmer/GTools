import type { TranslateRequest, TranslateResult } from '@sdk/api'
import { fetchChecked, unescapeHtml } from './http'
import { TranslateExecutorError, type ExecutorRuntime } from './types'

const MYMEMORY_ENDPOINT = 'https://api.mymemory.translated.net/get'
const QUOTA_STATUSES = new Set([403, 429, 482])
export const DEFAULT_MYMEMORY_PROVIDER_ID = 'builtin:mymemory'

interface MyMemoryPayload {
  responseData?: { translatedText?: unknown }
  responseStatus?: unknown
  responseDetails?: unknown
}

/** 响应体 → 译文。MyMemory 常以 HTTP 200 + body 内 responseStatus 报错，配额耗尽也在这一层 */
export function parseMyMemoryBody(httpStatus: number, body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new TranslateExecutorError('parse', '翻译服务返回了无法解析的内容')
  }
  const payload = (parsed ?? {}) as MyMemoryPayload
  const bizStatus = Number(payload.responseStatus ?? httpStatus)
  if (bizStatus >= 400) {
    const details =
      typeof payload.responseDetails === 'string' && payload.responseDetails !== ''
        ? payload.responseDetails
        : `服务返回状态 ${bizStatus}`
    if (QUOTA_STATUSES.has(bizStatus)) {
      throw new TranslateExecutorError('quota', `免费翻译额度受限：${details}`)
    }
    throw new TranslateExecutorError('http', `翻译服务错误（${bizStatus}）：${details}`)
  }
  const text = payload.responseData?.translatedText
  if (typeof text !== 'string' || text === '') {
    throw new TranslateExecutorError('parse', '翻译服务响应缺少译文字段')
  }
  return unescapeHtml(text)
}

/** 内置默认：MyMemory 公共接口免 key（匿名每日限额），未配置任何 provider 时的回退路径 */
export async function executeMyMemory(
  input: TranslateRequest,
  rt: ExecutorRuntime
): Promise<TranslateResult> {
  if (input.text.trim() === '') {
    throw new TranslateExecutorError('config', '没有可翻译的内容')
  }
  const qs = new URLSearchParams({ q: input.text, langpair: `${input.from}|${input.to}` })
  const res = await fetchChecked(`${MYMEMORY_ENDPOINT}?${qs.toString()}`, rt)
  return { resultText: parseMyMemoryBody(res.status, res.body), providerId: DEFAULT_MYMEMORY_PROVIDER_ID }
}

