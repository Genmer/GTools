import { describe, expect, it } from 'vitest'
import { decode, encode, tryDecode } from '../../../../src/plugins/devtools/views/logic/base64'

describe('devtools base64 编解码', () => {
  it('ASCII 往返与已知值', () => {
    expect(encode('hello')).toBe('aGVsbG8=')
    expect(decode('aGVsbG8=')).toBe('hello')
    expect(decode(encode('The quick brown fox'))).toBe('The quick brown fox')
  })

  it('UTF-8 中文与 emoji 双向正确（与 Node Buffer 对照）', () => {
    const s = '你好，GTools 🧰'
    expect(encode(s)).toBe(Buffer.from(s, 'utf8').toString('base64'))
    expect(decode(encode(s))).toBe(s)
    expect(encode('你好')).toBe('5L2g5aW9')
  })

  it('空串与无填充输入', () => {
    expect(encode('')).toBe('')
    expect(decode('')).toBe('')
    expect(decode('aGVsbG8')).toBe('hello')
  })

  it('decode 容忍首尾空白（粘贴场景）', () => {
    expect(decode('  aGVsbG8=\n')).toBe('hello')
  })

  it('超 0x8000 字节走分块路径，结果与 Buffer 一致', () => {
    const s = 'a'.repeat(40000) + '中文尾部'
    expect(encode(s)).toBe(Buffer.from(s, 'utf8').toString('base64'))
    expect(decode(encode(s))).toBe(s)
  })

  it('非法输入 decode 抛异常，tryDecode 转为错误对象', () => {
    expect(() => decode('a')).toThrow()
    expect(() => decode('%%')).toThrow()
    expect(tryDecode('%%')).toEqual({ ok: false, message: '非法 Base64 输入' })
    expect(tryDecode('aGVsbG8=')).toEqual({ ok: true, text: 'hello' })
  })
})
