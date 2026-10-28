/** 插件内仅存的非 API 类设置：跟随哪个 AI 供应商（供应商/密钥本体在全局 API 中心，见 DESIGN 附录 B） */
export interface ProviderPrefs {
  /** '' = 跟随全局 active 供应商 */
  providerId: string
}

export const PROVIDER_STORAGE_KEY = 'settings'
export const DEFAULT_PREFS: ProviderPrefs = { providerId: '' }

/** 存储读出的未知结构 → 合法偏好，坏数据兜底不抛错（多余字段直接忽略） */
export function normalizeProviderPrefs(raw: unknown): ProviderPrefs {
  const v = (raw ?? {}) as { providerId?: unknown }
  return { providerId: typeof v.providerId === 'string' ? v.providerId : DEFAULT_PREFS.providerId }
}
