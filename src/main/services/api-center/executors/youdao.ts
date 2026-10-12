import { createHash } from 'node:crypto'
import type { TranslateRequest, TranslateResult } from '@sdk/api'
import { getPreset } from '../presets'
import type { ApiErrorKind, ApiProviderConfig } from '../types'
import { fetchChecked } from './http'
import { TranslateExecutorError, requireSecrets, type ExecutorRuntime } from './types'

const YOUDAO_ENDPOINT = 'https://openapi.youdao.com/api'

export function youdaoLang(lang: string): string {
  if (lang === 'zh-CN') return 'zh-CHS'
  if (lang === 'zh-TW') return 'zh-CHT'
  return lang.toLowerCase()
}

/** v3 签名 input 规则（官方）：q ≤ 20 字符取原文，否则前 10 + 长度 + 后 10（JS 字符数） */
export function youdaoSignInput(q: string): string {
  return q.length <= 20 ? q : q.slice(0, 10) + String(q.length) + q.slice(-10)
}

export function youdaoSign(appKey: string, q: string, salt: string, curtime: string, appSecret: string): string {
  return createHash('sha256').update(appKey + youdaoSignInput(q) + salt + curtime + appSecret, 'utf8').digest('hex')
}

export function buildYoudaoForm(
  input: TranslateRequest,
  secrets: { appKey: string; appSecret: string },
  salt: string,
  curtime: string
): URLSearchParams {
  const form = new URLSearchParams()
  form.set('q', input.text)
  form.set('from', youdaoLang(input.from))
  form.set('to', youdaoLang(input.to))
  form.set('appKey', secrets.appKey)
  form.set('salt', salt)
  form.set('curtime', curtime)
  form.set('signType', 'v3')
  form.set('sign', youdaoSign(secrets.appKey, input.text, salt, curtime, secrets.appSecret))
  return form
}

const YOUDAO_ERROR_KINDS: Record<string, ApiErrorKind> = {
  '101': 'config',
  '102': 'config',
  '103': 'config',
  '104': 'config',
  '105': 'config',
  '107': 'config',
  '108': 'config',
  '109': 'config',
  '110': 'auth',
  '111': 'auth',
  '202': 'auth',
  '203': 'auth',
  '205': 'auth',
  '206': 'auth',
  '207': 'auth',
  '401': 'quota',
  '411': 'quota',
  '412': 'quota',
  '301': 'http',
  '302': 'http',
  '303': 'http',
  '310': 'http',
  '311': 'http'
}

/** auth 类码带官方含义（欠费/签名失败/IP 白名单等），其余用通用文案 */
const YOUDAO_AUTH_HINTS: Record<string, string> = {
  '110': '无可用服务次数（账户欠费或套餐不含该服务）',
  '111': '签名服务未开通（账户欠费）',
  '202': '签名检验失败',
  '203': '访问 IP 不在白名单',
  '205': '接口与应用的平台类型不一致',
  '206': '接口未授权调用',
  '207': '重试请求失败'
}

export function parseYoudaoBody(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new TranslateExecutorError('parse', '有道翻译返回了无法解析的内容')
  }
  const payload = (parsed ?? {}) as { errorCode?: unknown; translation?: unknown[] }
  if (payload.errorCode === '0' || payload.errorCode === 0) {
    if (Array.isArray(payload.translation) && payload.translation.length > 0) {
      // 多行文本的空行段过滤：只拼非空段，全空才走缺少译文字段报错
      const parts = payload.translation.filter((t): t is string => typeof t === 'string' && t !== '')
      if (parts.length > 0) return parts.join('\n')
    }
    throw new TranslateExecutorError('parse', '有道翻译响应缺少译文字段')
  }
  const code = String(payload.errorCode ?? '')
  const kind = YOUDAO_ERROR_KINDS[code] ?? 'http'
  const hint = YOUDAO_AUTH_HINTS[code]
  const detail = hint !== undefined ? `：${hint}` : ''
  throw new TranslateExecutorError(kind, `有道翻译错误 ${code !== '' ? code : '?'}${detail}`)
}

export async function executeYoudao(input: TranslateRequest, rt: ExecutorRuntime, cfg: ApiProviderConfig): Promise<TranslateResult> {
  if (input.text.trim() === '') {
    throw new TranslateExecutorError('config', '没有可翻译的内容')
  }
  const secrets = requireSecrets(cfg, getPreset('youdao')!) as { appKey: string; appSecret: string }
  const salt = String(Date.now() + Math.floor(Math.random() * 1000))
  const curtime = String(Math.floor(Date.now() / 1000))
  const form = buildYoudaoForm(input, secrets, salt, curtime)
  const res = await fetchChecked(YOUDAO_ENDPOINT, rt, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  })
  return { resultText: parseYoudaoBody(res.body), providerId: cfg.id }
}
