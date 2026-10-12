import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import type { ApiProviderConfig, ApiErrorKind } from '../types'
import type { ProviderPresetMeta } from '../presets'

/** 与宿主 net.fetch 同构的注入面：装配时传 fetchViaNet，测试传 fake */
export type FetchFn = (url: string, init?: HostFetchInit) => Promise<HostFetchResult>

/** executor 内部分类错误（对齐原 translate/providers 的 TranslateError 语义），由服务层包装成 ApiServiceError */
export class TranslateExecutorError extends Error {
  readonly kind: ApiErrorKind
  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.name = 'TranslateExecutorError'
    this.kind = kind
  }
}

export interface ExecutorRuntime {
  fetch: FetchFn
  timeoutMs?: number
}

/** fail-fast 凭证检查：preset 任一凭证键缺失/空白即抛 config（发网络前拦截，指明缺哪个字段） */
export function requireSecrets(cfg: ApiProviderConfig, preset: ProviderPresetMeta): Record<string, string> {
  const secrets = cfg.secrets ?? {}
  for (const field of preset.credentials) {
    const v = secrets[field.key]
    if (typeof v !== 'string' || v.trim() === '') {
      throw new TranslateExecutorError('config', `请在 设置 → API 服务 填写「${preset.label}」的 ${field.label}`)
    }
  }
  return secrets
}
