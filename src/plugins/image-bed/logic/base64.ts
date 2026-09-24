// 纯 JS base64：渲染层（web tsconfig，无 node 类型）与 node 测试环境都要跑，不用 btoa/atob。

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const LOOKUP: Record<string, number> = {}
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]] = i

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  const n = bytes.length
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < n ? bytes[i + 1] : 0
    const b2 = i + 2 < n ? bytes[i + 2] : 0
    out += ALPHABET[b0 >> 2]
    out += ALPHABET[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < n ? ALPHABET[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < n ? ALPHABET[b2 & 63] : '='
  }
  return out
}

export function base64ToBytes(b64: string): Uint8Array {
  // '=' 填充与空白直接剔除；剩余字符数恒为 4 的倍数（合法输入）
  let len = 0
  const codes: number[] = []
  for (let i = 0; i < b64.length; i++) {
    const v = LOOKUP[b64[i]]
    if (v !== undefined) {
      codes.push(v)
      len++
    }
  }
  const total = Math.floor((len * 3) / 4)
  const out = new Uint8Array(total)
  let p = 0
  for (let i = 0; i + 1 < codes.length; i += 4) {
    const c0 = codes[i]
    const c1 = codes[i + 1]
    if (p < total) out[p++] = (c0 << 2) | (c1 >> 4)
    const c2 = codes[i + 2]
    const c3 = codes[i + 3]
    if (c2 !== undefined && p < total) out[p++] = (c1 << 4) | (c2 >> 2)
    if (c2 !== undefined && c3 !== undefined && p < total) out[p++] = (c2 << 6) | c3
  }
  return out
}

/** dataURL → 裸 base64；入参已是裸 base64 时原样返回 */
export function dataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf('base64,')
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 'base64,'.length)
}

export function dataUrlToMime(dataUrl: string): string {
  const m = /^data:([^;,]+)/.exec(dataUrl)
  return m ? m[1] : ''
}
