import { describe, expect, it } from 'vitest'
import { resolveFetchBody } from '../src/main/services/net-guard'

describe('resolveFetchBody（二进制上传支持）', () => {
  it('undefined / 字符串直传', () => {
    expect(resolveFetchBody(undefined)).toEqual({})
    expect(resolveFetchBody('plain')).toEqual({ body: 'plain' })
  })

  it('{ base64 } 解码为 Uint8Array', () => {
    const r = resolveFetchBody({ base64: Buffer.from('hello').toString('base64') })
    expect(r.body).toBeInstanceOf(Uint8Array)
    expect(Buffer.from(r.body as Uint8Array).toString()).toBe('hello')
  })

  it('非法形态拒绝', () => {
    expect(() => resolveFetchBody(42 as never)).toThrow(/body/)
    expect(() => resolveFetchBody({} as never)).toThrow(/body/)
    expect(() => resolveFetchBody({ base64: 1 } as never)).toThrow(/body/)
  })
})
