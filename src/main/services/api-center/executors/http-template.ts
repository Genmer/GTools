import type { TranslateRequest, TranslateResult } from '@sdk/api'
import type { ApiProviderConfig } from '../types'
import { fetchChecked } from './http'
import { TranslateExecutorError, type ExecutorRuntime } from './types'

/** 自定义 HTTP 接口（原 translate 插件 manual provider 上移）：URL/请求体模板 + 结果字段路径。
 *  占位符：URL 中 {text}/{key} 按 URL 编码替换；POST 请求体中一律按 JSON 字符串转义替换。 */

function fillUrl(template: string, input: TranslateRequest, apiKey: string): string {
  return template
    .replaceAll('{text}', encodeURIComponent(input.text))
    .replaceAll('{from}', input.from)
    .replaceAll('{to}', input.to)
    .replaceAll('{key}', encodeURIComponent(apiKey))
}

function fillBody(template: string, input: TranslateRequest, apiKey: string): string {
  const esc = (v: string): string => JSON.stringify(v).slice(1, -1)
  return template
    .replaceAll('{text}', esc(input.text))
    .replaceAll('{from}', esc(input.from))
    .replaceAll('{to}', esc(input.to))
    .replaceAll('{key}', esc(apiKey))
}

/** 点分路径取值，数字段视为数组下标（translations.0.text） */
function pickPath(root: unknown, path: string): unknown {
  let cur: unknown = root
  for (const seg of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur)) {
      const i = Number(seg)
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) return undefined
      cur = cur[i]
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg]
    } else {
      return undefined
    }
  }
  return cur
}

/** 响应体 → 译文：非 JSON 当纯文本用；JSON 按结果路径取字符串/数字/布尔 */
export function extractTemplateResult(body: string, resultPath: string): string {
  const trimmed = body.trim()
  if (trimmed === '') {
    throw new TranslateExecutorError('parse', '接口返回内容为空')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return trimmed
  }
  const value = resultPath === '' ? parsed : pickPath(parsed, resultPath)
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw new TranslateExecutorError(
    'parse',
    resultPath !== '' ? `未能从响应中取出字段：${resultPath}` : '请在设置中配置结果字段路径（如 translations.0.text）'
  )
}

export async function executeHttpTemplate(
  input: TranslateRequest,
  rt: ExecutorRuntime,
  cfg?: ApiProviderConfig
): Promise<TranslateResult> {
  if (input.text.trim() === '') {
    throw new TranslateExecutorError('config', '没有可翻译的内容')
  }
  const endpoint = (cfg?.endpoint ?? '').trim()
  const bodyTemplate = cfg?.bodyTemplate ?? ''
  const apiKey = cfg?.apiKey ?? ''
  if (endpoint === '') {
    throw new TranslateExecutorError('config', '请先在 设置 → API 服务 配置接口地址')
  }
  // {key} 检查要在占位符替换前做，替换后空 key 已变成空串无法识别
  if ((endpoint.includes('{key}') || bodyTemplate.includes('{key}')) && apiKey === '') {
    throw new TranslateExecutorError('config', '模板使用了 {key} 占位符，请先填写密钥')
  }
  const url = fillUrl(endpoint, input, apiKey)
  if (!/^https?:\/\//.test(url)) {
    throw new TranslateExecutorError('config', '接口地址必须以 http:// 或 https:// 开头')
  }
  const res =
    cfg?.method === 'POST'
      ? await fetchChecked(url, rt, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: fillBody(bodyTemplate, input, apiKey)
        })
      : await fetchChecked(url, rt)
  return { resultText: extractTemplateResult(res.body, (cfg?.resultPath ?? '').trim()), providerId: cfg?.id ?? 'http-template' }
}
