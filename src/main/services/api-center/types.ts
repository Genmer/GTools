import type { ApiCallError } from '@sdk/api'

/** 通用第三方 API 的 provider 配置（主进程内部结构，不进 sdk；apiKey 永不下发渲染层） */
export interface ApiProviderConfig {
  /** 'builtin:mymemory' 固定；http-template 用 'u-<8位随机>' */
  id: string
  type: 'mymemory' | 'http-template'
  name: string
  enabled: boolean
  /** http-template 的 URL 模板，占位符 {text} {from} {to} {key} */
  endpoint?: string
  apiKey?: string
  method?: 'GET' | 'POST'
  bodyTemplate?: string
  /** 点分结果字段路径，如 translations.0.text */
  resultPath?: string
}

export interface ApiServicesConfig {
  services: {
    translate: { activeProviderId: string; providers: ApiProviderConfig[] }
  }
}

export const DEFAULT_API_SERVICES: ApiServicesConfig = {
  services: { translate: { activeProviderId: '', providers: [] } }
}

/** 设置页 upsert 表单：newApiKey 留空 = 不修改已存密钥 */
export interface ProviderForm {
  id?: string
  type: 'mymemory' | 'http-template'
  name: string
  enabled?: boolean
  endpoint?: string
  method?: 'GET' | 'POST'
  bodyTemplate?: string
  resultPath?: string
  newApiKey?: string
}

/** 脱敏视图（apiKey → hasKey），设置页与 api-services-changed 广播的唯一形态 */
export interface ApiProviderView {
  id: string
  type: 'mymemory' | 'http-template'
  name: string
  enabled: boolean
  endpoint?: string
  method?: 'GET' | 'POST'
  bodyTemplate?: string
  resultPath?: string
  hasKey: boolean
}

export interface ApiServicesView {
  services: {
    translate: { activeProviderId: string; providers: ApiProviderView[] }
  }
}

export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'quota' | 'parse' | 'config'

/** API 中心对插件的失败语义：code 进 IPC 错误码，kind 供 message 前缀分类 */
export class ApiServiceError extends Error {
  readonly code: Extract<ApiCallError, 'SERVICE_UNCONFIGURED' | 'SERVICE_ERROR'>
  readonly kind: ApiErrorKind | null
  constructor(code: Extract<ApiCallError, 'SERVICE_UNCONFIGURED' | 'SERVICE_ERROR'>, kind: ApiErrorKind | null, message: string) {
    super(message)
    this.name = 'ApiServiceError'
    this.code = code
    this.kind = kind
  }
}

/** 文件级 sanitize：坏值丢弃回默认；strictActive=true 时 active 必须指向存在且启用的 provider（加载手改文件场景） */
export function sanitizeApiServices(raw: unknown, opts?: { strictActive?: boolean }): ApiServicesConfig {
  const out = structuredClone(DEFAULT_API_SERVICES)
  const root = raw as { services?: { translate?: unknown } } | null
  const t = typeof root === 'object' && root !== null ? root.services?.translate : null
  if (typeof t !== 'object' || t === null) return out
  const src = t as { activeProviderId?: unknown; providers?: unknown }

  if (Array.isArray(src.providers)) {
    const seen = new Set<string>()
    for (const item of src.providers) {
      if (typeof item !== 'object' || item === null) continue
      const p = item as Record<string, unknown>
      const type = p.type === 'mymemory' || p.type === 'http-template' ? p.type : null
      const id = typeof p.id === 'string' && p.id !== '' ? p.id : ''
      const name = typeof p.name === 'string' && p.name.trim() !== '' ? p.name : ''
      if (!type || id === '' || name === '' || seen.has(id)) continue
      seen.add(id)
      out.services.translate.providers.push({
        id,
        type,
        name,
        enabled: p.enabled === undefined ? true : p.enabled === true,
        endpoint: str(p.endpoint),
        apiKey: str(p.apiKey),
        method: p.method === 'POST' ? 'POST' : 'GET',
        bodyTemplate: str(p.bodyTemplate),
        resultPath: str(p.resultPath)
      })
    }
  }

  const activeId = typeof src.activeProviderId === 'string' ? src.activeProviderId : ''
  const active = out.services.translate.providers.find((p) => p.id === activeId)
  out.services.translate.activeProviderId =
    active && (active.enabled || opts?.strictActive !== true) ? activeId : ''
  return out
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
