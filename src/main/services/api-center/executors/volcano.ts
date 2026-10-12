import { createHash, createHmac } from 'node:crypto'
import type { HostFetchInit, TranslateRequest, TranslateResult } from '@sdk/api'
import { getPreset } from '../presets'
import type { ApiErrorKind, ApiProviderConfig } from '../types'
import { fetchChecked } from './http'
import { TranslateExecutorError, requireSecrets, type ExecutorRuntime } from './types'

const VOLCANO_HOST = 'translate.volcengineapi.com'
const VOLCANO_REGION = 'cn-north-1'
const VOLCANO_SERVICE = 'translate'
const VOLCANO_ENDPOINT = `https://${VOLCANO_HOST}/?Action=TranslateText&Version=2020-06-01`

export function volcanoLang(lang: string): string {
  if (lang === 'zh-CN') return 'zh'
  if (lang === 'zh-TW') return 'zh-Hant'
  return lang.toLowerCase()
}

/** UTC 时间戳 yyyyMMddTHHmmssZ（火山 V4 签名要求） */
export function volcanoXDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function sha256hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

function hmac(key: string | Buffer, s: string): Buffer {
  return createHmac('sha256', key).update(s, 'utf8').digest()
}

export function buildVolcanoBody(input: TranslateRequest): string {
  // SourceLanguage 省略 = 服务端自动检测
  return JSON.stringify({ TargetLanguage: volcanoLang(input.to), TextList: [input.text] })
}

export function volcanoCanonicalRequest(xDate: string, contentSha256: string): string {
  return [
    'POST',
    '/',
    'Action=TranslateText&Version=2020-06-01',
    `content-type:application/json`,
    `host:${VOLCANO_HOST}`,
    `x-content-sha256:${contentSha256}`,
    `x-date:${xDate}`,
    '',
    'content-type;host;x-content-sha256;x-date',
    contentSha256
  ].join('\n')
}

/** 密钥链：secretAccessKey → date8 → region → service → request */
export function volcanoSigningKey(secretAccessKey: string, date8: string): Buffer {
  return hmac(hmac(hmac(hmac(secretAccessKey, date8), VOLCANO_REGION), VOLCANO_SERVICE), 'request')
}

export function buildVolcanoRequest(
  input: TranslateRequest,
  secrets: { accessKeyId: string; secretAccessKey: string },
  xDate: string
): { url: string; init: HostFetchInit } {
  const body = buildVolcanoBody(input)
  const contentSha256 = sha256hex(body)
  const date8 = xDate.slice(0, 8)
  const canonicalRequest = volcanoCanonicalRequest(xDate, contentSha256)
  const stringToSign = [
    'HMAC-SHA256',
    xDate,
    `${date8}/${VOLCANO_REGION}/${VOLCANO_SERVICE}/request`,
    sha256hex(canonicalRequest)
  ].join('\n')
  const signature = hmac(volcanoSigningKey(secrets.secretAccessKey, date8), stringToSign).toString('hex')
  return {
    url: VOLCANO_ENDPOINT,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Date': xDate,
        'X-Content-Sha256': contentSha256,
        Authorization: `HMAC-SHA256 Credential=${secrets.accessKeyId}/${date8}/${VOLCANO_REGION}/${VOLCANO_SERVICE}/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=${signature}`
      },
      body
    }
  }
}

interface VolcanoPayload {
  Response?: {
    TranslationList?: { Translation?: unknown }[]
    Error?: { Code?: unknown; Message?: unknown }
  }
}

function volcanoErrorKind(code: string): ApiErrorKind {
  if (/Signature|AccessKey|Unauthorized/i.test(code)) return 'auth'
  if (/Parameter|Missing/i.test(code)) return 'config'
  return 'http'
}

export function parseVolcanoBody(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new TranslateExecutorError('parse', '火山翻译返回了无法解析的内容')
  }
  const response = (parsed as VolcanoPayload)?.Response
  if (response !== null && typeof response === 'object' && response.Error !== null && typeof response.Error === 'object') {
    const code = String(response.Error.Code ?? '')
    const message = typeof response.Error.Message === 'string' ? response.Error.Message : ''
    throw new TranslateExecutorError(
      volcanoErrorKind(code),
      `火山翻译错误 ${code !== '' ? code : '?'}${message !== '' ? `：${message}` : ''}`
    )
  }
  const translation = response?.TranslationList?.[0]?.Translation
  if (typeof translation !== 'string' || translation === '') {
    throw new TranslateExecutorError('parse', '火山翻译响应缺少译文字段')
  }
  return translation
}

export async function executeVolcano(input: TranslateRequest, rt: ExecutorRuntime, cfg: ApiProviderConfig): Promise<TranslateResult> {
  if (input.text.trim() === '') {
    throw new TranslateExecutorError('config', '没有可翻译的内容')
  }
  const secrets = requireSecrets(cfg, getPreset('volcano')!) as { accessKeyId: string; secretAccessKey: string }
  const { url, init } = buildVolcanoRequest(input, secrets, volcanoXDate(new Date()))
  const res = await fetchChecked(url, rt, init)
  return { resultText: parseVolcanoBody(res.body), providerId: cfg.id }
}
