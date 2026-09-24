import { tryDecode } from './base64'

export interface JwtDecoded {
  ok: boolean
  error?: string
  header?: Record<string, unknown>
  payload?: Record<string, unknown>
  iatDate?: string
  expDate?: string
  expired?: boolean
}

function b64urlToJson(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const text = tryDecode(padded)
  if (!text.ok) throw new Error('段不是合法 base64url')
  const parsed = JSON.parse(text.text)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('段不是 JSON 对象')
  return parsed as Record<string, unknown>
}

/** 仅解码不验签（开放点：验签不做）。非法输入返回错误而非抛异常 */
export function decodeJwt(token: string, now = Date.now()): JwtDecoded {
  const parts = token.trim().split('.')
  if (parts.length < 2) return { ok: false, error: 'JWT 至少需要 header.payload 两段' }
  try {
    const header = b64urlToJson(parts[0])
    const payload = b64urlToJson(parts[1])
    const fmt = (v: unknown): string | undefined =>
      typeof v === 'number' ? new Date(v * 1000).toLocaleString() : undefined
    const exp = typeof payload.exp === 'number' ? payload.exp : undefined
    return {
      ok: true,
      header,
      payload,
      iatDate: fmt(payload.iat),
      expDate: fmt(payload.exp),
      expired: exp !== undefined ? exp * 1000 < now : undefined
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
