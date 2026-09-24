import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, dataUrlToBase64, dataUrlToMime } from '../../../../src/plugins/image-bed/logic/base64'

function bytes(...nums: number[]): Uint8Array {
  return new Uint8Array(nums)
}

function latin1(u: Uint8Array): string {
  let s = ''
  for (const b of u) s += String.fromCharCode(b)
  return s
}

describe('image-bed base64', () => {
  it('空与 1/2/3 字节补位', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
    expect(bytesToBase64(bytes(102))).toBe('Zg==')
    expect(bytesToBase64(bytes(102, 111))).toBe('Zm8=')
    expect(bytesToBase64(bytes(102, 111, 111))).toBe('Zm9v')
  })

  it('编码解码往返（含 0x00/0xff 与大缓冲）', () => {
    const big = new Uint8Array(100_000)
    for (let i = 0; i < big.length; i++) big[i] = (i * 7 + 13) & 0xff
    expect(latin1(base64ToBytes(bytesToBase64(big)))).toBe(latin1(big))
  })

  it('裸 base64 解码跳过填充与空白', () => {
    expect(latin1(base64ToBytes('Zg=='))).toBe('f')
    expect(latin1(base64ToBytes('Zm 9v\n'))).toBe('foo')
  })

  it('dataURL 前缀剥离与 mime 提取', () => {
    expect(dataUrlToBase64('data:image/png;base64,Zm9v')).toBe('Zm9v')
    expect(dataUrlToBase64('Zm9v')).toBe('Zm9v')
    expect(dataUrlToMime('data:image/webp;base64,AAAA')).toBe('image/webp')
    expect(dataUrlToMime('not a data url')).toBe('')
  })

  it('与 node Buffer 编码一致（交叉验证手写实现）', () => {
    const data = bytes(0, 1, 2, 250, 251, 252, 253, 254, 255)
    expect(bytesToBase64(data)).toBe(Buffer.from(data).toString('base64'))
  })
})
