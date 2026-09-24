// TextEncoder/TextDecoder + btoa/atob 组合保证 UTF-8 中文双向正确
export function encode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

export function decode(s: string): string {
  const bin = atob(s.trim())
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

export function tryDecode(s: string): { ok: true; text: string } | { ok: false; message: string } {
  try {
    return { ok: true, text: decode(s) }
  } catch {
    return { ok: false, message: '非法 Base64 输入' }
  }
}
