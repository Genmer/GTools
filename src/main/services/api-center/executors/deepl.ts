import type { HostFetchInit, TranslateRequest, TranslateResult } from '@sdk/api'
import { getPreset } from '../presets'
import type { ApiProviderConfig } from '../types'
import { httpStatusToKind } from './error-rules'
import { fetchChecked } from './http'
import { TranslateExecutorError, requireSecrets, type ExecutorRuntime } from './types'

/** DeepL 官方 API：authKey 以 :fx 结尾走免费端点，否则走 Pro 端点（官方规则） */
const FREE_ENDPOINT = 'https://api-free.deepl.com/v2/translate'
const PRO_ENDPOINT = 'https://api.deepl.com/v2/translate'

export function deeplEndpoint(authKey: string): string {
  return authKey.endsWith(':fx') ? FREE_ENDPOINT : PRO_ENDPOINT
}

/** zh 系细分繁简，其余语种 DeepL 用大写 ISO 码；auto 仅作目标语种时无意义，原样大写 */
export function deeplLang(lang: string): string {
  if (lang === 'zh-CN') return 'ZH'
  if (lang === 'zh-TW') return 'ZH-Hant'
  return lang.toUpperCase()
}

export function buildDeeplRequest(input: TranslateRequest, authKey: string): { url: string; init: HostFetchInit } {
  // text 官方要求 string[]，发字符串报 400 "Value for 'text' not supported"
  const body: Record<string, unknown> = { text: [input.text], target_lang: deeplLang(input.to) }
  // source_lang 不接受 AUTO：auto 时省略让 DeepL 自检
  if (input.from !== '' && input.from !== 'auto') body.source_lang = deeplLang(input.from)
  return {
    url: deeplEndpoint(authKey),
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `DeepL-Auth-Key ${authKey}` },
      body: JSON.stringify(body)
    }
  }
}

export function parseDeeplBody(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new TranslateExecutorError('parse', 'DeepL 返回了无法解析的内容')
  }
  const text = (parsed as { translations?: { text?: unknown }[] })?.translations?.[0]?.text
  if (typeof text !== 'string' || text === '') {
    throw new TranslateExecutorError('parse', 'DeepL 响应缺少译文字段')
  }
  return text
}

/** HTTP 错误分类：401/403→auth、429/456→quota、5xx→http、其余 4xx→config；body 的 {message} 附进文案 */
export function deeplHttpError(status: number, body: string): TranslateExecutorError {
  const kind = httpStatusToKind(status, { 403: 'auth' })
  let detail = ''
  try {
    const message = (JSON.parse(body) as { message?: unknown })?.message
    if (typeof message === 'string' && message !== '') detail = `：${message}`
  } catch {
    // body 非 JSON 时只有状态码可报
  }
  return new TranslateExecutorError(kind, `DeepL 返回 HTTP ${status}${detail}`)
}

export async function executeDeepl(input: TranslateRequest, rt: ExecutorRuntime, cfg: ApiProviderConfig): Promise<TranslateResult> {
  if (input.text.trim() === '') {
    throw new TranslateExecutorError('config', '没有可翻译的内容')
  }
  const secrets = requireSecrets(cfg, getPreset('deepl')!)
  const { url, init } = buildDeeplRequest(input, secrets.authKey)
  const res = await fetchChecked(url, rt, init, { passHttpError: true })
  if (!res.ok) throw deeplHttpError(res.status, res.body)
  return { resultText: parseDeeplBody(res.body), providerId: cfg.id }
}
