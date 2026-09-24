// 图片指纹纯逻辑单测：用 btoa/atob 构造数据，不依赖 node API（web tsconfig 会收走本目录）。
import { describe, expect, it } from 'vitest'
import { dataUrlBytes, fnv1a32, imageFingerprint } from './image-hash'

const dataUrlOf = (bytes: Uint8Array, mime = 'image/png'): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `data:${mime};base64,${btoa(bin)}`
}
const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('fnv1a32 标准测试向量', () => {
  it('空串 / 单字符 / 多字符', () => {
    expect(fnv1a32(new Uint8Array([]))).toBe('811c9dc5')
    expect(fnv1a32(new Uint8Array([0x61]))).toBe('e40c292c')
    expect(fnv1a32(bytesOf('foobar'))).toBe('bf9cf968')
    expect(fnv1a32(bytesOf('a'))).toBe('e40c292c')
  })

  it('相同字节内容结果一致，顺序敏感', () => {
    expect(fnv1a32(bytesOf('ab'))).not.toBe(fnv1a32(bytesOf('ba')))
    expect(fnv1a32(bytesOf('hello'))).toBe(fnv1a32(bytesOf('hello')))
  })
})

describe('dataUrlBytes base64 解码', () => {
  it('剥离 data: 前缀后往返一致', () => {
    const bytes = bytesOf('PNG fake content \u00ff\u0089')
    expect(Array.from(dataUrlBytes(dataUrlOf(bytes)))).toEqual(Array.from(bytes))
  })

  it('无逗号的裸 base64 也能解', () => {
    expect(Array.from(dataUrlBytes('QUJDRA=='))).toEqual([65, 66, 67, 68])
  })

  it('空 base64 解出空字节数组', () => {
    expect(dataUrlBytes('data:image/png;base64,')).toHaveLength(0)
  })
})

describe('imageFingerprint 指纹', () => {
  it('格式为 字节数:宽x高:头4KB哈希', () => {
    const fp = imageFingerprint({ width: 320, height: 240, dataUrl: dataUrlOf(bytesOf('ABCDE')) })
    expect(fp).toEqual({ bytes: 5, hash: `5:320x240:${fnv1a32(bytesOf('ABCDE'))}` })
  })

  it('MIME 前缀不同但字节相同 → 指纹相同（去重判据不受前缀影响）', () => {
    const img = { width: 10, height: 10, dataUrl: dataUrlOf(bytesOf('same-bytes'), 'image/png') }
    const jpg = { width: 10, height: 10, dataUrl: dataUrlOf(bytesOf('same-bytes'), 'image/jpeg') }
    expect(imageFingerprint(img)).toEqual(imageFingerprint(jpg))
  })

  it('宽高或字节内容不同 → 指纹不同', () => {
    const img = { width: 10, height: 10, dataUrl: dataUrlOf(bytesOf('content-a')) }
    expect(imageFingerprint(img).hash).not.toBe(imageFingerprint({ ...img, width: 11 }).hash)
    expect(imageFingerprint(img).hash).not.toBe(imageFingerprint({ ...img, height: 11 }).hash)
    expect(imageFingerprint(img).hash).not.toBe(imageFingerprint({ ...img, dataUrl: dataUrlOf(bytesOf('content-b')) }).hash)
  })

  it('4KB 之后的差异不影响指纹（头部采样设计取舍）', () => {
    const head = new Uint8Array(4096).fill(0x41)
    const tailA = new Uint8Array([...head, 1, 2, 3])
    const tailB = new Uint8Array([...head, 9, 9, 9])
    const imgA = { width: 64, height: 64, dataUrl: dataUrlOf(tailA) }
    const imgB = { width: 64, height: 64, dataUrl: dataUrlOf(tailB) }
    expect(imageFingerprint(imgA).hash).toBe(imageFingerprint(imgB).hash)
    expect(imageFingerprint(imgA).bytes).toBe(4099)
  })
})
