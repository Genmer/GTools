import type { AiChatRequest, AiChatResult } from '@sdk/api'
import { fetchChecked } from './http'
import { TranslateExecutorError, type ExecutorRuntime } from './types'
import type { ApiProviderConfig } from '../types'

// 提示词冻结（R18/R19）：方向判定在提示词内完成，主进程不做语言检测、不暴露 system 字段
export const AI_TRANSLATE_SYSTEM_PROMPT = '你是翻译引擎，只输出译文。文本含中文则译为英文，否则译为中文。'

interface ChatCompletionPayload {
  choices?: { message?: { content?: unknown } }[]
}

/** OpenAI 兼容 /chat/completions 主进程代理执行：Bearer 由本模块注入，密钥不进渲染层载荷。
 *  大模型首包常超默认 10s，超时预算显式放宽到 60s（F8，spread 顺序保证 init 覆盖 rt 默认） */
export async function executeAiChat(req: AiChatRequest, rt: ExecutorRuntime, provider: ApiProviderConfig): Promise<AiChatResult> {
  if (req.text.trim() === '') {
    throw new TranslateExecutorError('config', '没有可翻译的内容')
  }
  const baseUrl = (provider.baseUrl ?? '').replace(/\/+$/, '')
  const res = await fetchChecked(
    `${baseUrl}/chat/completions`,
    rt,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.secrets?.apiKey ?? ''}` },
      body: JSON.stringify({
        model: provider.model,
        stream: false,
        messages: [
          { role: 'system', content: AI_TRANSLATE_SYSTEM_PROMPT },
          { role: 'user', content: req.text }
        ]
      }),
      timeoutMs: 60_000
    },
    { label: 'AI 服务', statusKinds: { 401: 'http' } }
  )
  let parsed: unknown
  try {
    parsed = JSON.parse(res.body)
  } catch {
    throw new TranslateExecutorError('parse', 'AI 服务返回了无法解析的内容')
  }
  const content = (parsed as ChatCompletionPayload)?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content === '') {
    throw new TranslateExecutorError('parse', 'AI 服务响应缺少译文字段')
  }
  return { resultText: content, providerId: provider.id }
}
