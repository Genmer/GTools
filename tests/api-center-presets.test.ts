// preset 元数据与 sanitize 兼容单测：八值枚举、旧 apiKey 读时转换、未声明键过滤、
// preset 类型模板字段清空、表驱动下拉数据源完整性。
import { describe, expect, it } from 'vitest'
import { PROVIDER_PRESETS, getPreset } from '../src/main/services/api-center/presets'
import { sanitizeApiServices } from '../src/main/services/api-center/types'

describe('PROVIDER_PRESETS 表驱动数据源', () => {
  it('八条与八值 type 一一对应；mymemory/http-template 无控制台链接', () => {
    expect(PROVIDER_PRESETS).toHaveLength(8)
    const types = PROVIDER_PRESETS.map((p) => p.type)
    expect(new Set(types).size).toBe(8)
    expect(types).toEqual(['mymemory', 'http-template', 'deepl', 'baidu', 'youdao', 'iflytek', 'hunyuan', 'volcano'])
    expect(getPreset('mymemory')?.consoleUrl).toBeNull()
    expect(getPreset('http-template')?.consoleUrl).toBeNull()
  })

  it('六家厂商：凭证键集合与 consoleUrl 符合定案', () => {
    expect(getPreset('deepl')?.credentials.map((c) => c.key)).toEqual(['authKey'])
    expect(getPreset('baidu')?.credentials.map((c) => c.key)).toEqual(['appId', 'secretKey'])
    expect(getPreset('youdao')?.credentials.map((c) => c.key)).toEqual(['appKey', 'appSecret'])
    expect(getPreset('iflytek')?.credentials.map((c) => c.key)).toEqual(['appId', 'apiKey', 'apiSecret'])
    expect(getPreset('hunyuan')?.credentials.map((c) => c.key)).toEqual(['apiKey'])
    expect(getPreset('volcano')?.credentials.map((c) => c.key)).toEqual(['accessKeyId', 'secretAccessKey'])
    for (const type of ['deepl', 'baidu', 'youdao', 'iflytek', 'hunyuan', 'volcano'] as const) {
      expect(getPreset(type)?.consoleUrl).toMatch(/^https:\/\//)
    }
  })

  it('quotaNote 免费额度短句：六家必带非空，mymemory/http-template 不带', () => {
    for (const type of ['deepl', 'baidu', 'youdao', 'iflytek', 'hunyuan', 'volcano'] as const) {
      expect(getPreset(type)?.quotaNote ?? '').not.toBe('')
    }
    expect(getPreset('mymemory')?.quotaNote).toBeUndefined()
    expect(getPreset('http-template')?.quotaNote).toBeUndefined()
  })

  it('凭证字段元数据完整（label/placeholder 非空，用于设置页渲染）', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.label).not.toBe('')
      expect(preset.description).not.toBe('')
      for (const c of preset.credentials) {
        expect(c.key).not.toBe('')
        expect(c.label).not.toBe('')
        expect(c.placeholder).not.toBe('')
      }
    }
  })

  it('getPreset 未知 type 返回 undefined', () => {
    expect(getPreset('nope' as never)).toBeUndefined()
  })
})

describe('sanitizeApiServices 兼容与过滤', () => {
  it('读时兼容：旧结构顶层 apiKey 非空且无 secrets.apiKey → 转 secrets（0.1.0 迁移产物/备份 v2 同通道）', () => {
    const out = sanitizeApiServices({
      services: { translate: { activeProviderId: 'u-1', providers: [{ id: 'u-1', type: 'http-template', name: '旧', enabled: true, endpoint: 'https://x/?q={text}&key={key}', apiKey: 'sk-old' }] } }
    })
    expect(out.services.translate.providers[0].secrets).toEqual({ apiKey: 'sk-old' })
  })

  it('读时兼容：secrets.apiKey 已有值时顶层 apiKey 不覆盖（secrets 优先）', () => {
    const out = sanitizeApiServices({
      services: { translate: { providers: [{ id: 'u-1', type: 'http-template', name: 'n', endpoint: 'https://x/', apiKey: 'old', secrets: { apiKey: 'new' } }] } }
    })
    expect(out.services.translate.providers[0].secrets).toEqual({ apiKey: 'new' })
  })

  it('旧结构 apiKey 只认 preset 声明该键的类型（http-template），其余类型忽略', () => {
    const out = sanitizeApiServices({
      services: { translate: { providers: [{ id: 'd', type: 'deepl', name: 'DeepL', apiKey: 'leak' }] } }
    })
    expect(out.services.translate.providers[0].secrets).toBeUndefined()
  })

  it('未知 type 整条丢弃；八值枚举内全部保留', () => {
    const out = sanitizeApiServices({
      services: {
        translate: {
          providers: [
            { id: 'x', type: 'deepl', name: 'DeepL' },
            { id: 'y', type: 'hunyuan', name: '混元' },
            { id: 'z', type: 'openai', name: '山寨' },
            { id: 'w', type: 42, name: '坏值' }
          ]
        }
      }
    })
    expect(out.services.translate.providers.map((p) => p.id)).toEqual(['x', 'y'])
  })

  it('secrets 只保留 preset 声明的键且值非空（空串/未声明键剔除后不落空对象）', () => {
    const out = sanitizeApiServices({
      services: {
        translate: {
          providers: [
            { id: 'b', type: 'baidu', name: '百度', secrets: { appId: 'a1', secretKey: '', appKey: 'x', __extra: 'y' } },
            { id: 'm', type: 'mymemory', name: 'M', secrets: { anything: '1' } }
          ]
        }
      }
    })
    expect(out.services.translate.providers[0].secrets).toEqual({ appId: 'a1' })
    expect(out.services.translate.providers[1].secrets).toBeUndefined()
  })

  it('preset 类型的 endpoint/method/bodyTemplate/resultPath 强制清空；http-template 原样保留', () => {
    const out = sanitizeApiServices({
      services: {
        translate: {
          providers: [
            { id: 'd', type: 'deepl', name: 'DeepL', endpoint: 'https://evil/', method: 'POST', bodyTemplate: 'b', resultPath: 'r' },
            { id: 't', type: 'http-template', name: 'tpl', endpoint: 'https://api.example.com/x', method: 'POST', bodyTemplate: '{"q":"{text}"}', resultPath: 'a.0.b' }
          ]
        }
      }
    })
    const deepl = out.services.translate.providers[0]
    expect(deepl.endpoint).toBe('')
    expect(deepl.method).toBe('GET')
    expect(deepl.bodyTemplate).toBe('')
    expect(deepl.resultPath).toBe('')
    const tpl = out.services.translate.providers[1]
    expect(tpl.endpoint).toBe('https://api.example.com/x')
    expect(tpl.method).toBe('POST')
    expect(tpl.bodyTemplate).toBe('{"q":"{text}"}')
    expect(tpl.resultPath).toBe('a.0.b')
  })
})
