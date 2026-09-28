import { describe, expect, it } from 'vitest'
import { QR_MAX_PAYLOAD_CHARS, isUrlLike, normalizePayload } from '../../../../src/plugins/qr-code/logic/qr'

describe('normalizePayload 归一化', () => {
  it('trim 两端空白；空/纯空白拒', () => {
    expect(normalizePayload('  https://example.com \n')).toBe('https://example.com')
    expect(normalizePayload('')).toBeNull()
    expect(normalizePayload('   ')).toBeNull()
  })

  it('超长拒（上限 QR_MAX_PAYLOAD_CHARS），恰在限内通过', () => {
    expect(normalizePayload('a'.repeat(QR_MAX_PAYLOAD_CHARS + 1))).toBeNull()
    expect(normalizePayload('a'.repeat(QR_MAX_PAYLOAD_CHARS))).toBe('a'.repeat(QR_MAX_PAYLOAD_CHARS))
    expect(QR_MAX_PAYLOAD_CHARS).toBe(2000)
  })
})

describe('isUrlLike 判定', () => {
  it('http(s) 整段 URL 命中（大小写协议、带端口路径查询）', () => {
    expect(isUrlLike('https://example.com')).toBe(true)
    expect(isUrlLike('HTTP://Example.com/Path?q=1')).toBe(true)
    expect(isUrlLike('  http://localhost:5173/a/b?x=1#f  ')).toBe(true)
  })

  it('裸域名 / 带空白 / 纯文本 / 空串不命中', () => {
    expect(isUrlLike('example.com')).toBe(false)
    expect(isUrlLike('https://example.com/a b')).toBe(false)
    expect(isUrlLike('随便一段中文文本')).toBe(false)
    expect(isUrlLike('')).toBe(false)
  })
})
