// 0.1.0 translate 插件内 provider 设置 → 全局 API 中心的一次性迁移（幂等）单测
import { describe, expect, it } from 'vitest'
import {
  LEGACY_ADOPTED_KEY,
  legacyTranslateToProvider,
  migrateLegacyTranslate,
  type LegacyStorageLike
} from '../src/main/services/api-center/migrate'
import { ApiCenterService } from '../src/main/services/api-center'
import type { FsLike } from '../src/main/settings-store'

const gen = (): string => 'u-deadbeef'

describe('legacyTranslateToProvider（旧插件 storage `settings` 键 → provider 配置）', () => {
  it('manual + 有效模板 + 密钥：完整迁移为 http-template', () => {
    const p = legacyTranslateToProvider(
      {
        providerId: 'manual',
        apiKeys: { manual: 'sk-old' },
        manual: { urlTemplate: ' https://x.example.com/?q={text}&key={key} ', method: 'POST', bodyTemplate: '{"q":"{text}"}', resultPath: 'data.0.t' }
      },
      gen
    )
    expect(p).toEqual({
      id: 'u-deadbeef',
      type: 'http-template',
      name: '自定义 HTTP 接口（旧配置迁移）',
      enabled: true,
      endpoint: 'https://x.example.com/?q={text}&key={key}', // 首尾空白被 trim
      apiKey: 'sk-old',
      method: 'POST',
      bodyTemplate: '{"q":"{text}"}',
      resultPath: 'data.0.t'
    })
  })

  it('旧 providerId 是 mymemory：不迁移（旧行为=新默认，迁移反而变更行为）', () => {
    const p = legacyTranslateToProvider(
      { providerId: 'mymemory', apiKeys: {}, manual: { urlTemplate: 'https://x.example.com/', method: 'GET', bodyTemplate: '', resultPath: '' } },
      gen
    )
    expect(p).toBeNull()
  })

  it('manual 但模板缺失/非 http(s)：不迁移', () => {
    expect(legacyTranslateToProvider({ providerId: 'manual', manual: { urlTemplate: '', method: 'GET', bodyTemplate: '', resultPath: '' } }, gen)).toBeNull()
    expect(legacyTranslateToProvider({ providerId: 'manual', manual: { urlTemplate: 'ftp://x', method: 'GET', bodyTemplate: '', resultPath: '' } }, gen)).toBeNull()
  })

  it('null / 垃圾结构 / 新版偏好结构（无 manual 字段）：不迁移不抛错', () => {
    expect(legacyTranslateToProvider(null, gen)).toBeNull()
    expect(legacyTranslateToProvider('garbage', gen)).toBeNull()
    expect(legacyTranslateToProvider({ direction: 'zh2en' }, gen)).toBeNull()
  })
})

const noopFs = { readFile: async () => { throw new Error('ENOENT') }, writeFile: async () => {}, rename: async () => {}, mkdir: async () => {} } as FsLike

describe('adoptMigratedProvider（启动接线行为）', () => {
  it('空配置时采纳：追加 provider 并设为 active（是否执行由 migrateLegacyTranslate 的一次性标记保证）', async () => {
    const svc = new ApiCenterService({ dir: '/data', fs: noopFs, fetch: async () => ({ ok: true, status: 200, body: '' }), generateId: gen })
    await svc.load()
    expect(svc.isTranslateEmpty()).toBe(true)
    const provider = legacyTranslateToProvider(
      { providerId: 'manual', apiKeys: { manual: 'sk-old' }, manual: { urlTemplate: 'https://x.example.com/?q={text}&key={key}', method: 'GET', bodyTemplate: '', resultPath: '' } },
      gen
    )
    expect(provider).not.toBeNull()
    await svc.adoptMigratedProvider(provider as NonNullable<typeof provider>)
    expect(svc.status('translate')).toMatchObject({ configured: true, activeProviderId: 'u-deadbeef' })
    expect(svc.config.services.translate.providers[0].apiKey).toBe('sk-old')
  })
})

const manualLegacy = {
  providerId: 'manual',
  apiKeys: { manual: 'sk-old' },
  manual: { urlTemplate: 'https://x.example.com/?q={text}&key={key}', method: 'GET', bodyTemplate: '', resultPath: '' }
}

/** 内存版插件 storage 桩（kv 同文件持久化语义） */
function makeStorage(initial: Record<string, unknown>): LegacyStorageLike & { read: (key: string) => unknown } {
  const kv = new Map<string, unknown>(Object.entries(initial))
  return {
    get: async (pluginId, key) => (pluginId === 'translate' ? (kv.get(key) ?? null) : null),
    set: async (pluginId, key, value) => {
      if (pluginId === 'translate') kv.set(key, value)
    },
    read: (key) => kv.get(key) ?? null
  }
}

describe('migrateLegacyTranslate（一次性标记，DESIGN B.5「此后不再读取」）', () => {
  function makeService(): ApiCenterService {
    return new ApiCenterService({ dir: '/data', fs: noopFs, fetch: async () => ({ ok: true, status: 200, body: '' }), generateId: gen })
  }
  const runOnce = (svc: ApiCenterService, storage: LegacyStorageLike): Promise<void> =>
    migrateLegacyTranslate({
      storage,
      isTranslateEmpty: () => svc.isTranslateEmpty(),
      adopt: (p) => svc.adoptMigratedProvider(p),
      generateId: gen
    })

  it('空中心 + 旧键有效：采纳一次并落 legacy-adopted 标记', async () => {
    const svc = makeService()
    await svc.load()
    const storage = makeStorage({ settings: manualLegacy })
    await runOnce(svc, storage)
    expect(svc.config.services.translate.providers).toHaveLength(1)
    expect(storage.read(LEGACY_ADOPTED_KEY)).toBe(true)
  })

  it('用户清空全部 provider 后重启：旧键不复活（历史回归：曾按「中心为空」重读旧键）', async () => {
    const svc = makeService()
    await svc.load()
    const storage = makeStorage({ settings: manualLegacy })
    await runOnce(svc, storage)
    await svc.removeProvider('u-deadbeef')
    expect(svc.isTranslateEmpty()).toBe(true)
    // 模拟重启后再次执行启动迁移
    await runOnce(svc, storage)
    expect(svc.config.services.translate.providers).toHaveLength(0)
  })

  it('中心非空：不读旧键、不落标记', async () => {
    const svc = makeService()
    await svc.load()
    await svc.upsertProvider({ type: 'mymemory', name: 'MyMemory' })
    const storage = makeStorage({ settings: manualLegacy })
    await runOnce(svc, storage)
    expect(svc.config.services.translate.providers).toHaveLength(1)
    expect(storage.read(LEGACY_ADOPTED_KEY)).toBeNull()
  })

  it('旧键无可迁移内容：不采纳也不落标记（保留回退旧版再升级时的迁移机会）', async () => {
    const svc = makeService()
    await svc.load()
    const storage = makeStorage({ settings: { providerId: 'mymemory' } })
    await runOnce(svc, storage)
    expect(svc.config.services.translate.providers).toHaveLength(0)
    expect(storage.read(LEGACY_ADOPTED_KEY)).toBeNull()
  })
})
