import type { HostFetchInit, TranslateRequest, TranslateResult } from '@sdk/api'
import { getPreset } from '../presets'
import type { ApiProviderConfig } from '../types'
import { httpStatusToKind } from './error-rules'
import { fetchChecked } from './http'
import { TranslateExecutorError, requireSecrets, type ExecutorRuntime } from './types'

const HUNYUAN_ENDPOINT = 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions'
const HUNYUAN_MODEL = 'hunyuan-turbos-latest'

function langName(lang: string): string {
  switch (lang) {
    case 'zh-CN':
      return '简体中文'
    case 'zh-TW':
      return '繁体中文'
    case 'en':
      return 'English'
    case 'ja':
      return '日语'
    case 'ko':
      return '韩语'
    case 'fr':
      return '法语'
    case 'es':
      return '西班牙语'
    case 'de':
      return '德语'
    case 'ru':
      return '俄语'
    default:
      return lang
  }
}

export function hunyuanSystemPrompt(from: string, to: string): string {
  return `你是翻译引擎。把用户消息原文从${langName(from)}翻译为${langName(to)}，只输出译文本身，不要解释、不要加引号。`
}

export function buildHunyuanRequest(input: TranslateRequest, apiKey: string): { url: string; init: HostFetchInit } {
  return {
    url: HUNYUAN_ENDPOINT,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: HUNYUAN_MODEL,
        temperature: 0,
        messages: [
          { role: 'system', content: hunyuanSystemPrompt(input.from, input.to) },
          { role: 'user', content: input.text }
        ]
      })
    }
  }
}

/** 大模型偶尔给译文包一层引号或代码围栏，剥一层成对包裹 */
export function stripHunyuanChatter(s: string): string {
  let out = s.trim()
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(out)
  if (fence !== null) out = fence[1].trim()
  for (const [open, close] of [
    ['"', '"'],
    ["'", "'"],
    ['“', '”']
  ] as const) {
    if (out.length >= 2 && out.startsWith(open) && out.endsWith(close)) {
      out = out.slice(1, -1).trim()
      break
    }
  }
  return out
}

export function parseHunyuanBody(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new TranslateExecutorError('parse', '混元翻译返回了无法解析的内容')
  }
  const content = (parsed as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new TranslateExecutorError('parse', '混元翻译响应缺少译文字段')
  }
  const text = stripHunyuanChatter(content)
  if (text === '') {
    throw new TranslateExecutorError('parse', '混元翻译返回了空译文')
  }
  return text
}

/** HTTP 错误分类：401→auth、429→quota、400→config、5xx→http（均为默认规则）；body error.message 附加 */
export function hunyuanHttpError(status: number, body: string): TranslateExecutorError {
  const kind = httpStatusToKind(status)
  let detail = ''
  try {
    const message = (JSON.parse(body) as { error?: { message?: unknown } })?.error?.message
    if (typeof message === 'string' && message !== '') detail = `：${message}`
  } catch {
    // body 非 JSON 时只有状态码可报
  }
  return new TranslateExecutorError(kind, `混元翻译返回 HTTP ${status}${detail}`)
}

export async function executeHunyuan(input: TranslateRequest, rt: ExecutorRuntime, cfg: ApiProviderConfig): Promise<TranslateResult> {
  if (input.text.trim() === '') {
    throw new TranslateExecutorError('config', '没有可翻译的内容')
  }
  const secrets = requireSecrets(cfg, getPreset('hunyuan')!)
  const { url, init } = buildHunyuanRequest(input, secrets.apiKey)
  // 大模型生成慢于规则引擎：默认超时放宽到 15s（显式注入的 timeoutMs 优先）
  const longRt: ExecutorRuntime = { ...rt, timeoutMs: rt.timeoutMs ?? 15_000 }
  const res = await fetchChecked(url, longRt, init, { passHttpError: true })
  if (!res.ok) throw hunyuanHttpError(res.status, res.body)
  return { resultText: parseHunyuanBody(res.body), providerId: cfg.id }
}
