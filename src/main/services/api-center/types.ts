import type { ApiCallError } from '@sdk/api'
import { getPreset } from './presets'

/** provider 类型全集：前两个为宿主内置形态，后六个为厂商 preset（凭证键集合见 presets.ts） */
export type ProviderType =
  | 'mymemory'
  | 'http-template'
  | 'deepl'
  | 'baidu'
  | 'youdao'
  | 'iflytek'
  | 'hunyuan'
  | 'volcano'

export const PROVIDER_TYPES: readonly ProviderType[] = [
  'mymemory',
  'http-template',
  'deepl',
  'baidu',
  'youdao',
  'iflytek',
  'hunyuan',
  'volcano'
]

/** 通用第三方 API 的 provider 配置（主进程内部结构，不进 sdk；secrets 明文只存本机，永不下发渲染层） */
export interface ApiProviderConfig {
  /** 'builtin:mymemory' 固定；其余用 'u-<8位随机>' */
  id: string
  type: ProviderType
  name: string
  enabled: boolean
  /** 仅 http-template：URL 模板，占位符 {text} {from} {to} {key} */
  endpoint?: string
  method?: 'GET' | 'POST'
  bodyTemplate?: string
  /** 点分结果字段路径，如 translations.0.text */
  resultPath?: string
  /** 凭证字段，键集合由 preset 声明；值非空才保留 */
  secrets?: Record<string, string>
}

export interface ApiServicesConfig {
  services: {
    translate: { activeProviderId: string; providers: ApiProviderConfig[] }
  }
}

export const DEFAULT_API_SERVICES: ApiServicesConfig = {
  services: { translate: { activeProviderId: '', providers: [] } }
}

/** 设置页 upsert 表单：newSecrets 某键留空或缺省 = 保留已存值；键集合须 ⊆ preset.credentials */
export interface ProviderForm {
  id?: string
  type: ProviderType
  name: string
  enabled?: boolean
  endpoint?: string
  method?: 'GET' | 'POST'
  bodyTemplate?: string
  resultPath?: string
  newSecrets?: Record<string, string>
}

/** 脱敏视图（secrets → hasSecrets），设置页与 api-services-changed 广播的唯一形态 */
export interface ApiProviderView {
  id: string
  type: ProviderType
  name: string
  enabled: boolean
  endpoint?: string
  method?: 'GET' | 'POST'
  bodyTemplate?: string
  resultPath?: string
  /** 各凭证字段是否已有值（键集合 = 该 type 的 preset 声明） */
  hasSecrets: Record<string, boolean>
}

export interface ApiServicesView {
  services: {
    translate: { activeProviderId: string; providers: ApiProviderView[] }
  }
}

export type ApiErrorKind = 'timeout' | 'network' | 'http' | 'quota' | 'auth' | 'parse' | 'config'

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

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** secrets 归一：只保留 preset 声明的键且值非空；旧结构顶层 apiKey 非空时并入（0.1.0 迁移产物与备份导入同一通道，零额外迁移代码） */
function sanitizeSecrets(type: ProviderType, raw: Record<string, unknown>): Record<string, string> | undefined {
  const allowed = getPreset(type)?.credentials.map((c) => c.key) ?? []
  const out: Record<string, string> = {}
  const src = (typeof raw.secrets === 'object' && raw.secrets !== null ? raw.secrets : {}) as Record<string, unknown>
  for (const key of allowed) {
    let v = typeof src[key] === 'string' ? (src[key] as string) : ''
    if (key === 'apiKey' && v === '' && allowed.includes('apiKey')) {
      v = str(raw.apiKey)
    }
    if (v !== '') out[key] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
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
      const type = PROVIDER_TYPES.includes(p.type as ProviderType) ? (p.type as ProviderType) : null
      const id = typeof p.id === 'string' && p.id !== '' ? p.id : ''
      const name = typeof p.name === 'string' && p.name.trim() !== '' ? p.name : ''
      if (!type || id === '' || name === '' || seen.has(id)) continue
      seen.add(id)
      // preset 类型无模板字段：强制清空防手改文件残留
      const isTemplate = type === 'http-template'
      const provider: ApiProviderConfig = {
        id,
        type,
        name,
        enabled: p.enabled === undefined ? true : p.enabled === true,
        endpoint: isTemplate ? str(p.endpoint) : '',
        method: isTemplate && p.method === 'POST' ? 'POST' : 'GET',
        bodyTemplate: isTemplate ? str(p.bodyTemplate) : '',
        resultPath: isTemplate ? str(p.resultPath) : ''
      }
      const secrets = sanitizeSecrets(type, p)
      if (secrets !== undefined) provider.secrets = secrets
      out.services.translate.providers.push(provider)
    }
  }

  const activeId = typeof src.activeProviderId === 'string' ? src.activeProviderId : ''
  const active = out.services.translate.providers.find((p) => p.id === activeId)
  out.services.translate.activeProviderId =
    active && (active.enabled || opts?.strictActive !== true) ? activeId : ''
  return out
}
