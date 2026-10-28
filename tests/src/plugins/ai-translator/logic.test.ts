import { describe, expect, it } from 'vitest'
import manifest from '../../../../src/plugins/ai-translator/manifest'
import { DEFAULT_PREFS, PROVIDER_STORAGE_KEY, normalizeProviderPrefs } from '../../../../src/plugins/ai-translator/logic'

describe('供应商偏好归一化（插件内仅存的非 API 设置）', () => {
  it('null / 垃圾结构 / 非字符串 providerId 回落空串（跟随全局 active）', () => {
    expect(normalizeProviderPrefs(null)).toEqual(DEFAULT_PREFS)
    expect(normalizeProviderPrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(normalizeProviderPrefs('x')).toEqual(DEFAULT_PREFS)
    expect(normalizeProviderPrefs({})).toEqual(DEFAULT_PREFS)
    expect(normalizeProviderPrefs({ providerId: 42 })).toEqual(DEFAULT_PREFS)
    expect(DEFAULT_PREFS.providerId).toBe('')
  })

  it('合法 providerId 保留（含显式空串语义一致）；多余字段忽略', () => {
    expect(normalizeProviderPrefs({ providerId: 'p1' })).toEqual({ providerId: 'p1' })
    expect(normalizeProviderPrefs({ providerId: '' })).toEqual({ providerId: '' })
    expect(normalizeProviderPrefs({ providerId: 'p1', stale: true })).toEqual({ providerId: 'p1' })
  })

  it("存储键为 settings；''（空串）是「跟随全局 active」的合法持久值", () => {
    expect(PROVIDER_STORAGE_KEY).toBe('settings')
    const saved = { providerId: '' }
    expect(normalizeProviderPrefs(saved)).toEqual(saved)
  })
})

describe('ai-translator 插件面', () => {
  it('keywords 主词 aitr 为精确串关键词（router 要求 keyword+空格形态）', () => {
    expect(manifest.keywords[0]).toBe('aitr')
    for (const k of manifest.keywords) {
      expect(k === '' || k.includes(' ')).toBe(false)
    }
  })
})
