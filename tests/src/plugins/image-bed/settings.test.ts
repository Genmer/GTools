import { describe, expect, it } from 'vitest'
import {
  DEFAULT_IMAGE_BED_SETTINGS,
  MAX_HISTORY_LIMIT,
  MIN_HISTORY_LIMIT,
  authHeaderValue,
  isHttpUrl,
  lskyUploadUrl,
  normalizeImageBedSettings
} from '../../../../src/plugins/image-bed/logic/settings'

describe('image-bed settings', () => {
  it('空/坏数据全部回落默认值', () => {
    expect(normalizeImageBedSettings(null)).toEqual(DEFAULT_IMAGE_BED_SETTINGS)
    expect(normalizeImageBedSettings('garbage')).toEqual(DEFAULT_IMAGE_BED_SETTINGS)
    expect(normalizeImageBedSettings({ providerId: 1, historyLimit: 'x', custom: 3 })).toEqual(DEFAULT_IMAGE_BED_SETTINGS)
  })

  it('合法字段保留、token 去空白、historyLimit 夹取', () => {
    const s = normalizeImageBedSettings({
      providerId: 'lsky',
      lskyApiUrl: ' https://a.com/ ',
      lskyToken: ' tok ',
      custom: { apiUrl: 'https://b.com/up', authScheme: 'raw', fileField: '', urlPath: ' data.url ' },
      defaultFormat: 'markdown',
      historyLimit: 99999
    })
    expect(s.providerId).toBe('lsky')
    expect(s.lskyApiUrl).toBe('https://a.com/')
    expect(s.lskyToken).toBe('tok')
    expect(s.custom.authScheme).toBe('raw')
    expect(s.custom.fileField).toBe('file')
    expect(s.custom.urlPath).toBe('data.url')
    expect(s.defaultFormat).toBe('markdown')
    expect(s.historyLimit).toBe(MAX_HISTORY_LIMIT)
    expect(normalizeImageBedSettings({ historyLimit: 1 }).historyLimit).toBe(MIN_HISTORY_LIMIT)
    expect(normalizeImageBedSettings({ historyLimit: 66.4 }).historyLimit).toBe(66)
  })

  it('归一化产生深拷贝（草稿不污染原对象）', () => {
    const src = { custom: { apiUrl: 'https://a.com' } }
    const a = normalizeImageBedSettings(src)
    a.custom.apiUrl = 'changed'
    expect(src.custom?.apiUrl).toBe('https://a.com')
  })

  it('isHttpUrl 只放行 http(s)', () => {
    expect(isHttpUrl('https://a.com')).toBe(true)
    expect(isHttpUrl('http://a.com:8080/x')).toBe(true)
    expect(isHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isHttpUrl('ftp://a.com')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })

  it('鉴权头三态与兰空 URL 拼接', () => {
    expect(authHeaderValue('bearer', 'abc')).toBe('Bearer abc')
    expect(authHeaderValue('basic', 'abc')).toBe('Basic abc')
    expect(authHeaderValue('raw', 'abc')).toBe('abc')
    expect(authHeaderValue('none', 'abc')).toBeNull()
    expect(authHeaderValue('bearer', ' ')).toBeNull()
    expect(lskyUploadUrl('https://a.com/')).toBe('https://a.com/api/v1/upload')
    expect(lskyUploadUrl('https://a.com//')).toBe('https://a.com/api/v1/upload')
  })
})
