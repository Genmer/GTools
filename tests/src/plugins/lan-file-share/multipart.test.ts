import { describe, expect, it } from 'vitest'
import { boundaryFromContentType, parseMultipart } from '../../../../src/plugins/lan-file-share/backend/multipart'

function body(parts: string[], boundary: string): Buffer {
  const b = `--${boundary}`
  const chunks = [b]
  for (const p of parts) chunks.push(p, b)
  chunks.push('--', '')
  return Buffer.from(chunks.join('\r\n'))
}

describe('boundaryFromContentType', () => {
  it('普通与带引号边界', () => {
    expect(boundaryFromContentType('multipart/form-data; boundary=----abc123')).toBe('----abc123')
    expect(boundaryFromContentType('multipart/form-data; boundary="quoted boundary"')).toBe('quoted boundary')
  })
  it('非 multipart 或缺失返回 null', () => {
    expect(boundaryFromContentType('application/json')).toBeNull()
    expect(boundaryFromContentType('multipart/form-data')).toBeNull()
    expect(boundaryFromContentType(undefined)).toBeNull()
  })
})

describe('parseMultipart', () => {
  it('解析文件字段与普通字段，二进制内容含 CRLF 不误切', () => {
    const fileData = Buffer.from([0, 255, 13, 10, 45, 45, 120, 13, 10, 1, 2]) // 内含 "\r\n--x" 样式字节
    const buf = Buffer.concat([
      Buffer.from(
        '--BND\r\nContent-Disposition: form-data; name="file"; filename="a.bin"\r\nContent-Type: application/octet-stream\r\n\r\n'
      ),
      fileData,
      Buffer.from('\r\n--BND\r\nContent-Disposition: form-data; name="submit"\r\n\r\nok\r\n--BND--\r\n')
    ])
    const parts = parseMultipart(buf, 'BND')
    expect(parts).toHaveLength(2)
    expect(parts[0].filename).toBe('a.bin')
    expect(parts[0].name).toBe('file')
    expect(parts[0].contentType).toBe('application/octet-stream')
    expect(parts[0].data.equals(fileData)).toBe(true)
    expect(parts[1].name).toBe('submit')
    expect(parts[1].filename).toBeUndefined()
    expect(parts[1].data.toString()).toBe('ok')
  })

  it('中文文件名：UTF-8 原样与 RFC 5987 filename* 两种形式', () => {
    const raw = body(
      ['Content-Disposition: form-data; name="file"; filename="手机照片.jpg"\r\n\r\n<binary>'],
      'BND'
    )
    expect(parseMultipart(raw, 'BND')[0].filename).toBe('手机照片.jpg')

    const star = body(
      ["Content-Disposition: form-data; name=\"file\"; filename*=UTF-8''%E6%89%8B%E6%9C%BA%E7%85%A7%E7%89%87.jpg\r\n\r\n<x>"],
      'BND'
    )
    expect(parseMultipart(star, 'BND')[0].filename).toBe('手机照片.jpg')
  })

  it('多文件字段一次解析', () => {
    const raw = body(
      [
        'Content-Disposition: form-data; name="f1"; filename="1.txt"\r\n\r\none',
        'Content-Disposition: form-data; name="f2"; filename="2.txt"\r\n\r\ntwo'
      ],
      'BND'
    )
    const parts = parseMultipart(raw, 'BND')
    expect(parts.map((p) => p.filename)).toEqual(['1.txt', '2.txt'])
    expect(parts.map((p) => p.data.toString())).toEqual(['one', 'two'])
  })

  it('找不到边界返回空数组（body 与 boundary 不匹配）', () => {
    expect(parseMultipart(Buffer.from('hello'), 'BND')).toEqual([])
    expect(parseMultipart(Buffer.alloc(0), 'BND')).toEqual([])
  })
})
