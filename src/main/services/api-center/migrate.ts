import type { ApiProviderConfig } from './types'

export const LEGACY_PLUGIN_ID = 'translate'
export const LEGACY_SETTINGS_KEY = 'settings'
/** 采纳成功后落在旧插件 storage 的一次性标记：防用户清空全局中心后重启时旧键复活 */
export const LEGACY_ADOPTED_KEY = 'legacy-adopted'

/** 0.1.0 translate 插件 storage 的 `settings` 键（providers/types.ts 旧结构）→ 全局中心 http-template provider。
 *  仅当旧生效 provider 是 manual 且模板可用时迁移（providerId=mymemory 的旧行为 = 新默认，迁移反而变更行为）；
 *  返回 null 表示无可迁移内容。旧键由调用方原样保留（回退安全）。 */
export function legacyTranslateToProvider(raw: unknown, generateId: () => string): ApiProviderConfig | null {
  const s = (raw ?? {}) as { providerId?: unknown; apiKeys?: unknown; manual?: unknown }
  if (s.providerId !== 'manual') return null
  const manual = (typeof s.manual === 'object' && s.manual !== null ? s.manual : {}) as Record<string, unknown>
  const urlTemplate = typeof manual.urlTemplate === 'string' ? manual.urlTemplate.trim() : ''
  if (urlTemplate === '' || !/^https?:\/\//.test(urlTemplate)) return null
  const apiKey =
    typeof s.apiKeys === 'object' && s.apiKeys !== null && typeof (s.apiKeys as Record<string, unknown>).manual === 'string'
      ? ((s.apiKeys as Record<string, unknown>).manual as string)
      : ''
  return {
    id: generateId(),
    type: 'http-template',
    name: '自定义 HTTP 接口（旧配置迁移）',
    enabled: true,
    endpoint: urlTemplate,
    apiKey,
    method: manual.method === 'POST' ? 'POST' : 'GET',
    bodyTemplate: typeof manual.bodyTemplate === 'string' ? manual.bodyTemplate : '',
    resultPath: typeof manual.resultPath === 'string' ? manual.resultPath : ''
  }
}

export interface LegacyStorageLike {
  get(pluginId: string, key: string): Promise<unknown>
  set(pluginId: string, key: string, value: unknown): Promise<void>
}

/** 启动迁移入口（DESIGN B.5「一次性」）：采纳成功即写 legacy-adopted 标记，此后不再读旧键，
 *  用户清空全局中心也不会复活旧 provider；无可迁移内容不落标记，保留回退旧版再升级时的迁移机会。 */
export async function migrateLegacyTranslate(opts: {
  storage: LegacyStorageLike
  isTranslateEmpty: () => boolean
  adopt: (provider: ApiProviderConfig) => Promise<void>
  generateId: () => string
}): Promise<void> {
  if (!opts.isTranslateEmpty()) return
  if ((await opts.storage.get(LEGACY_PLUGIN_ID, LEGACY_ADOPTED_KEY)) === true) return
  const legacy = await opts.storage.get(LEGACY_PLUGIN_ID, LEGACY_SETTINGS_KEY)
  const provider = legacyTranslateToProvider(legacy, opts.generateId)
  if (provider === null) return
  await opts.adopt(provider)
  await opts.storage.set(LEGACY_PLUGIN_ID, LEGACY_ADOPTED_KEY, true)
}
