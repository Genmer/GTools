import { createHash, randomBytes } from 'node:crypto'
import type { TranslateRequest, TranslateResult } from '@sdk/api'
import { getPreset } from '../presets'
import type { ApiErrorKind, ApiProviderConfig } from '../types'
import { fetchChecked } from './http'
import { TranslateExecutorError, requireSecrets, type ExecutorRuntime } from './types'

const BAIDU_ENDPOINT = 'https://fanyi-api.baidu.com/api/trans/vip/translate'

/** 百度语种码与 BCP 风格不同：cht=繁体、jp/kor/fra/spa/vie 为历史写法 */
export function baiduLang(lang: string): string {
  switch (lang) {
    case 'zh-CN':
      return 'zh'
    case 'zh-TW':
      return 'cht'
    case 'ja':
      return 'jp'
    case 'ko':
      return 'kor'
    case 'fr':
      return 'fra'
    case 'es':
      return 'spa'
    case 'vi':
      return 'vie'
    default:
      return lang
  }
}

/** 签名 = md5hex(appId + 原始 text + salt + secretKey)，text 不做 URL 编码（官方规则） */
export function baiduSign(appId: string, text: string, salt: string, secretKey: string): string {
  return createHash('md5').update(appId + text + salt + secretKey, 'utf8').digest('hex')
}

export function buildBaiduForm(
  input: TranslateRequest,
  secrets: { appId: string; secretKey: string },
  salt: string
): URLSearchParams {
  const form = new URLSearchParams()
  form.set('q', input.text)
  form.set('from', baiduLang(input.from))
  form.set('to', baiduLang(input.to))
  form.set('appid', secrets.appId)
  form.set('salt', salt)
  form.set('sign', baiduSign(secrets.appId, input.text, salt, secrets.secretKey))
  return form
}

/** body 错误码分类表（官方文档语义），未知码按服务端瞬时故障处理 */
const BAIDU_ERROR_KINDS: Record<string, ApiErrorKind> = {
  '52001': 'http',
  '52002': 'http',
  '52003': 'auth',
  '54000': 'config',
  '54001': 'auth',
  '54003': 'quota',
  '54004': 'quota',
  '54005': 'quota',
  '58000': 'config',
  '58001': 'config',
  '58002': 'auth',
  '90107': 'auth'
}

export function parseBaiduBody(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new TranslateExecutorError('parse', '百度翻译返回了无法解析的内容')
  }
  const payload = (parsed ?? {}) as {
    trans_result?: { dst?: unknown }[]
    error_code?: unknown
    error_msg?: unknown
  }
  if (Array.isArray(payload.trans_result) && payload.trans_result.length > 0) {
    // 多行文本里服务端会为空行回空 dst 段：过滤后保留非空段，全空才走错误分支
    const parts = payload.trans_result.map((r) => (typeof r?.dst === 'string' ? r.dst : '')).filter((s) => s !== '')
    if (parts.length > 0) return parts.join('\n')
  }
  const code = String(payload.error_code ?? '')
  const kind = BAIDU_ERROR_KINDS[code] ?? 'http'
  const msg = typeof payload.error_msg === 'string' && payload.error_msg !== '' ? payload.error_msg : '未知错误'
  // 54001 高频成因：密钥复制不完整/带空白、或 APP ID（纯数字）与密钥填反，附排查提示
  const signHint = code === '54001' ? '（签名不匹配：请整段重新复制密钥；APP ID 是纯数字、密钥是字母数字串，两者勿互换）' : ''
  throw new TranslateExecutorError(kind, `百度翻译错误 ${code !== '' ? code : '?'}：${msg}${signHint}`)
}

export async function executeBaidu(input: TranslateRequest, rt: ExecutorRuntime, cfg: ApiProviderConfig): Promise<TranslateResult> {
  if (input.text.trim() === '') {
    throw new TranslateExecutorError('config', '没有可翻译的内容')
  }
  const secrets = requireSecrets(cfg, getPreset('baidu')!) as { appId: string; secretKey: string }
  // salt 与签名必须同值：先定 salt 再一次性构表单
  const salt = randomBytes(8).toString('hex')
  const form = buildBaiduForm(input, secrets, salt)
  const res = await fetchChecked(BAIDU_ENDPOINT, rt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  })
  return { resultText: parseBaiduBody(res.body), providerId: cfg.id }
}
