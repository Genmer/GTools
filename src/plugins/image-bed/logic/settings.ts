// 图床设置：类型、默认值、脏数据归一化、provider 参数解析（纯函数，可单测）。

export type ProviderId = 'smms' | 'lsky' | 'custom'
export type AuthScheme = 'none' | 'bearer' | 'basic' | 'raw'
export type LinkFormat = 'url' | 'markdown' | 'html'

export interface CustomProviderConfig {
  apiUrl: string
  token: string
  authScheme: AuthScheme
  fileField: string
  /** 响应 JSON 里取 URL 的点分路径；空串 = 自动探测（常见字段 + 深度扫描） */
  urlPath: string
}

export interface ImageBedSettings {
  providerId: ProviderId
  smmsToken: string
  lskyApiUrl: string
  lskyToken: string
  custom: CustomProviderConfig
  defaultFormat: LinkFormat
  historyLimit: number
}

export const SETTINGS_STORAGE_KEY = 'settings'

export const DEFAULT_IMAGE_BED_SETTINGS: ImageBedSettings = {
  providerId: 'smms',
  smmsToken: '',
  lskyApiUrl: '',
  lskyToken: '',
  custom: { apiUrl: '', token: '', authScheme: 'bearer', fileField: 'file', urlPath: '' },
  defaultFormat: 'url',
  historyLimit: 100
}

export const MIN_HISTORY_LIMIT = 20
export const MAX_HISTORY_LIMIT = 500

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 存储读出的未知结构 → 合法设置；深拷贝避免草稿与存储共享引用；坏数据逐字段兜底 */
export function normalizeImageBedSettings(raw: unknown): ImageBedSettings {
  const s = (raw ?? {}) as Partial<ImageBedSettings>
  const c = (s.custom ?? {}) as Partial<CustomProviderConfig>
  const scheme: AuthScheme =
    c.authScheme === 'none' || c.authScheme === 'bearer' || c.authScheme === 'basic' || c.authScheme === 'raw'
      ? c.authScheme
      : DEFAULT_IMAGE_BED_SETTINGS.custom.authScheme
  return {
    providerId:
      s.providerId === 'smms' || s.providerId === 'lsky' || s.providerId === 'custom'
        ? s.providerId
        : DEFAULT_IMAGE_BED_SETTINGS.providerId,
    smmsToken: str(s.smmsToken).trim(),
    lskyApiUrl: str(s.lskyApiUrl).trim(),
    lskyToken: str(s.lskyToken).trim(),
    custom: {
      apiUrl: str(c.apiUrl).trim(),
      token: str(c.token).trim(),
      authScheme: scheme,
      fileField: str(c.fileField).trim() || DEFAULT_IMAGE_BED_SETTINGS.custom.fileField,
      urlPath: str(c.urlPath).trim()
    },
    defaultFormat:
      s.defaultFormat === 'markdown' || s.defaultFormat === 'html' || s.defaultFormat === 'url'
        ? s.defaultFormat
        : DEFAULT_IMAGE_BED_SETTINGS.defaultFormat,
    historyLimit: clampInt(s.historyLimit, MIN_HISTORY_LIMIT, MAX_HISTORY_LIMIT, DEFAULT_IMAGE_BED_SETTINGS.historyLimit)
  }
}

export function isHttpUrl(u: string): boolean {
  if (!/^https?:\/\//i.test(u)) return false
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

/** 解析出请求参数；配置缺失不在这里抛（settings 归一化已保证形态），由 providers 层校验 */
export function authHeaderValue(scheme: AuthScheme, token: string): string | null {
  const t = token.trim()
  if (scheme === 'none' || t === '') return null
  if (scheme === 'bearer') return `Bearer ${t}`
  if (scheme === 'basic') return `Basic ${t}`
  return t
}

export function lskyUploadUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1/upload`
}
