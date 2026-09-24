import { describe, expect, it } from 'vitest'
import { decodeJwt } from '../../../../src/plugins/devtools/views/logic/jwt'

const b64url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url')
const j = (o: unknown): string => b64url(JSON.stringify(o))

describe('devtools jwt 解码（不验签）', () => {
  it('标准 header.payload 正常解码', () => {
    const token = `${j({ alg: 'HS256', typ: 'JWT' })}.${j({ sub: 'u1', iat: 1000, exp: 2000 })}`
    const r = decodeJwt(token, 1500000)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.header).toEqual({ alg: 'HS256', typ: 'JWT' })
    expect(r.payload).toEqual({ sub: 'u1', iat: 1000, exp: 2000 })
    expect(r.iatDate).toBeTypeOf('string')
    expect(r.expDate).toBeTypeOf('string')
    expect(r.expired).toBe(false)
  })

  it('带签名三段式照常解码', () => {
    const token = `${j({ alg: 'none' })}.${j({ a: 1 })}.sig-not-checked`
    const r = decodeJwt(token)
    expect(r.ok).toBe(true)
  })

  it('过期判定以注入的 now 为准；无 exp 时 expired 为 undefined', () => {
    const token = `${j({ alg: 'none' })}.${j({ exp: 2000 })}`
    // expired = exp*1000 < now（严格小于：恰好到 exp 的那一毫秒仍算有效）
    expect(decodeJwt(token, 1999999).expired).toBe(false)
    expect(decodeJwt(token, 2000000).expired).toBe(false)
    expect(decodeJwt(token, 2000001).expired).toBe(true)
    const noExp = `${j({ alg: 'none' })}.${j({ sub: 'x' })}`
    const r = decodeJwt(noExp)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.expired).toBeUndefined()
      expect(r.expDate).toBeUndefined()
      expect(r.iatDate).toBeUndefined() // iat 非 number 不格式化
    }
  })

  it('少于两段直接拒绝', () => {
    const r = decodeJwt('abc')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('至少')
  })

  it('段不是合法 base64url / 不是 JSON 对象 / 不是 JSON，均返回错误不抛异常', () => {
    const badB64 = `${j({ alg: 'none' })}.not-base64!`
    expect(decodeJwt(badB64).ok).toBe(false)
    const notObj = `${j({ alg: 'none' })}.${b64url('"str"')}`
    const r2 = decodeJwt(notObj)
    expect(r2.ok).toBe(false)
    if (!r2.ok) expect(r2.error).toContain('不是 JSON 对象')
    const badJson = `${j({ alg: 'none' })}.${b64url('{bad')}`
    expect(decodeJwt(badJson).ok).toBe(false)
  })

  it('首尾空白容忍', () => {
    const token = `  ${j({ alg: 'none' })}.${j({ n: 1 })}  \n`
    expect(decodeJwt(token).ok).toBe(true)
  })
})
