import { describe, expect, it } from 'vitest'
import { isSensitiveText } from '../src/renderer/src/core/sensitive'

describe('isSensitiveText', () => {
  it('PEM 私钥命中', () => {
    expect(isSensitiveText('-----BEGIN RSA PRIVATE KEY-----\nMIIE...')).toBe(true)
  })

  it('JWT 命中', () => {
    expect(isSensitiveText('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123')).toBe(true)
  })

  it('AWS Access Key 命中', () => {
    expect(isSensitiveText('AKIAIOSFODNN7EXAMPLE')).toBe(true)
  })

  it('password=xxx 键值对命中', () => {
    expect(isSensitiveText('password=mySecret123')).toBe(true)
  })

  it('JSON "password":"xxx" 命中', () => {
    expect(isSensitiveText('{"password":"mySecret123"}')).toBe(true)
    expect(isSensitiveText('{"api_key": "abc"}')).toBe(true)
    expect(isSensitiveText('{"authorization": "Bearer xxx"}')).toBe(true)
    expect(isSensitiveText('{"session": "abc123"}')).toBe(true)
  })

  it('普通文本不命中', () => {
    expect(isSensitiveText('hello world')).toBe(false)
  })

  it('空字符串不命中', () => {
    expect(isSensitiveText('')).toBe(false)
    expect(isSensitiveText('   ')).toBe(false)
  })

  it('普通 JSON 不命中', () => {
    expect(isSensitiveText('{"name":"test"}')).toBe(false)
    expect(isSensitiveText('{"count": 42, "items": ["a","b"]}')).toBe(false)
  })
})
