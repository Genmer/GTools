// translate 插件迁移后保留的纯逻辑：方向启发式、偏好归一化、新 manifest 权限面
import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, validateManifest } from '@sdk/manifest'
import manifest from '../../../src/plugins/translate/manifest'
import { DEFAULT_PREFS, isMostlyChinese, normalizePrefs, resolveLangPair } from '../../../src/plugins/translate/logic'

describe('auto 方向启发式（中英自动判断）', () => {
  it('中文占比 > 0.3 判为中文', () => {
    expect(isMostlyChinese('今天天气不错')).toBe(true)
    expect(isMostlyChinese('你好，世界')).toBe(true)
    expect(isMostlyChinese('你好abc')).toBe(true) // 2/5 = 0.4
  })

  it('英文或占比不足判为英文，空串不算中文；恰好 0.3 不算（严格大于）', () => {
    expect(isMostlyChinese('hello world')).toBe(false)
    expect(isMostlyChinese('abcdefgh你')).toBe(false) // 1/9 ≈ 0.11
    expect(isMostlyChinese('你好世abcdefg')).toBe(false) // 3/10 = 0.3
    expect(isMostlyChinese('   ')).toBe(false)
    expect(isMostlyChinese('')).toBe(false)
  })

  it('resolveLangPair：auto 按启发式，手动方向优先于内容', () => {
    expect(resolveLangPair('auto', '今天天气不错')).toEqual({ from: 'zh-CN', to: 'en' })
    expect(resolveLangPair('auto', 'good morning')).toEqual({ from: 'en', to: 'zh-CN' })
    expect(resolveLangPair('auto', '')).toEqual({ from: 'en', to: 'zh-CN' })
    expect(resolveLangPair('zh2en', 'english text')).toEqual({ from: 'zh-CN', to: 'en' })
    expect(resolveLangPair('en2zh', '中文内容')).toEqual({ from: 'en', to: 'zh-CN' })
  })
})

describe('偏好归一化（插件内仅存的非 API 设置）', () => {
  it('null / 垃圾结构回落默认 auto', () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs('x')).toEqual(DEFAULT_PREFS)
    expect(normalizePrefs({ direction: 'weird' })).toEqual(DEFAULT_PREFS)
  })

  it('合法方向保留；旧版 provider 配置结构（多余字段）被忽略取不到方向', () => {
    expect(normalizePrefs({ direction: 'zh2en' })).toEqual({ direction: 'zh2en' })
    expect(normalizePrefs({ providerId: 'manual', apiKeys: {}, manual: {} })).toEqual(DEFAULT_PREFS)
  })
})

describe('translate manifest（迁移后）', () => {
  it('通过协议校验；权限收窄为 apis:translate 代理面（不再自持 net）', () => {
    const errors = validateManifest(manifest, { existingIds: new Set(), activeKeywords: new Map() })
    expect(errors).toEqual([])
    expect(manifest.id).toBe('translate')
    expect(manifest.keywords).toEqual(['fy', '翻译', 'fanyi'])
    expect(manifest.permissions).toEqual(['apis:translate', 'clipboard:read', 'clipboard:write', 'storage'])
    expect(manifest.permissions.every((p) => (ALL_PERMISSIONS as readonly string[]).includes(p))).toBe(true)
  })
})
