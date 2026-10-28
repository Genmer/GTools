import { describe, expect, it } from 'vitest'
import { looksLikeJson, peekJsonCandidate } from '@sdk/json-detect'

describe('json-detect（sdk 共享）', () => {
  it('looksLikeJson：{/[ 开头且可解析且顶层对象/数组', () => {
    expect(looksLikeJson('{"a":1}')).toBe(true)
    expect(looksLikeJson('  [1,2] ')).toBe(true)
    expect(looksLikeJson('{"a":')).toBe(false)
    expect(looksLikeJson('123')).toBe(false)
    expect(looksLikeJson('"str"')).toBe(false)
    expect(looksLikeJson('')).toBe(false)
    expect(looksLikeJson(`{"a":"${'x'.repeat(100_001)}"}`)).toBe(false)
  })

  it('peekJsonCandidate：合法 JSON 原文放行', () => {
    expect(peekJsonCandidate('{"a":1}')).toBe('{"a":1}')
    expect(peekJsonCandidate(' [1] ')).toBe(' [1] ')
  })

  it('peekJsonCandidate：空/非 JSON/超长一律 null（不下发渲染层）', () => {
    expect(peekJsonCandidate('')).toBeNull()
    expect(peekJsonCandidate('hello')).toBeNull()
    expect(peekJsonCandidate('{"a":}')).toBeNull()
    expect(peekJsonCandidate(`{"a":"${'x'.repeat(100_001)}"}`)).toBeNull()
  })

  it('peekJsonCandidate：敏感文本拦截（密码/token 不出主进程）', () => {
    expect(peekJsonCandidate('{"password":"hunter2"}')).toBeNull()
    expect(peekJsonCandidate('{"api_key":"sk-1234567890abcdef"}')).toBeNull()
    expect(peekJsonCandidate('{"token":"ghp_1234567890abcdefgh"}')).toBeNull()
  })
})
