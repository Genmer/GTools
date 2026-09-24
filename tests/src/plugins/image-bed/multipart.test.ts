import { describe, expect, it } from 'vitest'
import { buildMultipart, sanitizeMultipartFilename } from '../../../../src/plugins/image-bed/logic/multipart'
import { base64ToBytes } from '../../../../src/plugins/image-bed/logic/base64'

function latin1(u: Uint8Array): string {
  let s = ''
  for (const b of u) s += String.fromCharCode(b)
  return s
}

describe('image-bed multipart', () => {
  it('拼出符合 RFC 的表单结构（字段 + 文件 + 终结符，CRLF 严格）', () => {
    const { bodyBase64, contentType } = buildMultipart(
      [{ name: 'strategy', value: 'default' }],
      { name: 'smfile', filename: 'a.png', contentType: 'image/png', base64: Buffer.from('PNGDATA').toString('base64') },
      'BOUNDARY123'
    )
    expect(contentType).toBe('multipart/form-data; boundary=BOUNDARY123')
    expect(latin1(base64ToBytes(bodyBase64))).toBe(
      '--BOUNDARY123\r\n' +
        'Content-Disposition: form-data; name="strategy"\r\n\r\n' +
        'default\r\n' +
        '--BOUNDARY123\r\n' +
        'Content-Disposition: form-data; name="smfile"; filename="a.png"\r\n' +
        'Content-Type: image/png\r\n\r\n' +
        'PNGDATA\r\n' +
        '--BOUNDARY123--\r\n'
    )
  })

  it('文件内容二进制安全（0x00–0xff 全量字节往返）', () => {
    const raw = new Uint8Array(256)
    for (let i = 0; i < 256; i++) raw[i] = i
    const { bodyBase64 } = buildMultipart([], { name: 'file', filename: 'all.bin', contentType: 'application/octet-stream', base64: Buffer.from(raw).toString('base64') }, 'B')
    const body = latin1(base64ToBytes(bodyBase64))
    // 文件字节原样出现在两个 \r\n 之间，不被文本转义破坏
    const start = body.indexOf('\r\n\r\n')
    const end = body.lastIndexOf('\r\n--B--')
    expect(end).toBeGreaterThan(start)
    expect(body.slice(start + 4, end)).toBe(Buffer.from(raw).toString('latin1'))
  })

  it('文件名剔除引号/换行，非 ASCII 降级为 -（头部必须 ASCII 安全）', () => {
    expect(sanitizeMultipartFilename('bad"na\\me\r\n.png')).toBe('badname.png')
    expect(sanitizeMultipartFilename('截图 01.png')).toBe('-- 01.png')
    expect(sanitizeMultipartFilename('""')).toBe('image')
    const { bodyBase64 } = buildMultipart([], { name: 'f', filename: '截图.png', contentType: 'image/png', base64: '' }, 'B')
    expect(latin1(base64ToBytes(bodyBase64))).toContain('filename="--.png"')
  })

  it('随机 boundary 可作合法分隔符', () => {
    for (let i = 0; i < 20; i++) {
      const { contentType } = buildMultipart([], { name: 'f', filename: 'a.png', contentType: 'image/png', base64: 'AAAA' }, `----GToolsImageBed${i.toString(16)}`)
      expect(contentType).toMatch(/^multipart\/form-data; boundary=----GToolsImageBed[0-9a-f]+$/)
    }
  })
})
