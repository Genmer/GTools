import { createHmac } from 'node:crypto'
import type { TranslateRequest, TranslateResult } from '@sdk/api'
import { getPreset } from '../presets'
import type { ApiErrorKind, ApiProviderConfig } from '../types'
import { fetchChecked } from './http'
import { TranslateExecutorError, requireSecrets, type ExecutorRuntime } from './types'

const IFLYTEK_HOST = 'itrans.xf-yun.com'
const IFLYTEK_PATH = '/v1/its'
const IFLYTEK_ENDPOINT = `https://${IFLYTEK_HOST}${IFLYTEK_PATH}`
/** 单次请求文本上限（base64 前），超限直接 config 拒绝不 wasting 一次计费调用 */
const IFLYTEK_MAX_CHARS = 5000

/** 讯飞语种码：zh 系统一 cn（无繁体码，简体近似）；auto 不支持须显式 config 拒绝 */
export function iflytekLang(lang: string): string {
  if (lang === 'auto' || lang === '') {
    throw new TranslateExecutorError('config', '讯飞引擎不支持自动检测语种，请在插件里选择具体源语言')
  }
  if (lang === 'zh-CN' || lang === 'zh-TW') return 'cn'
  return lang
}

/** 鉴权串（官方一步签名）：b64(HMAC-SHA256(原串, apiSecret))，原串 = host/date/request-line 三行 \n 连接 */
export function iflytekSignature(apiSecret: string, date: string): string {
  const origin = `host: ${IFLYTEK_HOST}\ndate: ${date}\nPOST ${IFLYTEK_PATH} HTTP/1.1`
  return createHmac('sha256', apiSecret).update(origin, 'utf8').digest('base64')
}

/** authorization = b64(拼好的鉴权原串)，进 URL 前整体 urlencode */
export function iflytekAuthorization(apiKey: string, apiSecret: string, date: string): string {
  const signature = iflytekSignature(apiSecret, date)
  const origin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
  return Buffer.from(origin, 'utf8').toString('base64')
}

export function buildIflytekUrl(apiKey: string, apiSecret: string, date: string): string {
  // date 含空格/逗号：必须百分号编码（URLSearchParams 会把空格编成 +，与官方示例的 urlenc 不一致）
  const qs = `authorization=${encodeURIComponent(iflytekAuthorization(apiKey, apiSecret, date))}&date=${encodeURIComponent(date)}&host=${IFLYTEK_HOST}`
  return `${IFLYTEK_ENDPOINT}?${qs}`
}

export function buildIflytekBody(input: TranslateRequest, appId: string): string {
  const text = Buffer.from(input.text, 'utf8').toString('base64')
  return JSON.stringify({
    header: { app_id: appId, status: 3 },
    parameter: { its: { from: iflytekLang(input.from), to: iflytekLang(input.to), result: {} } },
    payload: { input_data: { encoding: 'utf8', status: 3, text } }
  })
}

const IFLYTEK_ERROR_KINDS: Record<string, ApiErrorKind> = {
  '10005': 'auth',
  '10105': 'auth',
  '11200': 'auth',
  '11201': 'auth',
  '11202': 'auth',
  '10163': 'config'
}

interface IflytekPayload {
  header?: { code?: unknown; sid?: unknown; message?: unknown }
  payload?: { result?: { text?: unknown } }
}

/** code=0 时 payload.result.text 是 base64(JSON)，其 trans_result.dst 为译文 */
export function parseIflytekBody(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new TranslateExecutorError('parse', '讯飞翻译返回了无法解析的内容')
  }
  const payload = (parsed ?? {}) as IflytekPayload
  const code = Number(payload.header?.code ?? -1)
  const sid = typeof payload.header?.sid === 'string' ? payload.header.sid : ''
  const withSid = (msg: string): string => (sid !== '' ? `${msg}（sid: ${sid}）` : msg)
  if (code !== 0) {
    const kind = IFLYTEK_ERROR_KINDS[String(code)] ?? 'http'
    const message = payload.header?.message
    const detail = typeof message === 'string' && message !== '' ? `：${message}` : ''
    throw new TranslateExecutorError(kind, withSid(`讯飞翻译错误 ${code}${detail}`))
  }
  let decoded = ''
  const encoded = payload.payload?.result?.text
  if (typeof encoded === 'string' && encoded !== '') {
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8')
    } catch {
      // fallthrough 到缺字段报错
    }
  }
  if (decoded !== '') {
    try {
      const inner = JSON.parse(decoded) as { trans_result?: { dst?: unknown } }
      const dst = inner.trans_result?.dst
      if (typeof dst === 'string' && dst !== '') return dst
    } catch {
      // fallthrough
    }
  }
  throw new TranslateExecutorError('http', withSid('讯飞翻译响应缺少译文字段'))
}

export async function executeIflytek(input: TranslateRequest, rt: ExecutorRuntime, cfg: ApiProviderConfig): Promise<TranslateResult> {
  if (input.text.trim() === '') {
    throw new TranslateExecutorError('config', '没有可翻译的内容')
  }
  if (input.text.length > IFLYTEK_MAX_CHARS) {
    throw new TranslateExecutorError('config', `讯飞引擎单次最多 ${IFLYTEK_MAX_CHARS} 字符，当前 ${input.text.length}`)
  }
  const secrets = requireSecrets(cfg, getPreset('iflytek')!) as { appId: string; apiKey: string; apiSecret: string }
  // 语种映射失败要发生在发网络之前
  iflytekLang(input.from)
  iflytekLang(input.to)
  const url = buildIflytekUrl(secrets.apiKey, secrets.apiSecret, new Date().toUTCString())
  const res = await fetchChecked(url, rt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildIflytekBody(input, secrets.appId)
  })
  return { resultText: parseIflytekBody(res.body), providerId: cfg.id }
}
