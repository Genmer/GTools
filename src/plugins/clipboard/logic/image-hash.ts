// 图片指纹：PNG 解码字节数 + 宽高 + 头部 4KB 的 FNV-1a（DESIGN §4.3 的纯 JS 哈希）。
// 用 atob 解 base64 而非 Buffer：本文件被渲染层 tsconfig 覆盖，不能依赖 node API。

export function fnv1a32(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function base64Part(dataUrl: string): string {
  const idx = dataUrl.indexOf(',')
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1)
}

export function dataUrlBytes(dataUrl: string): Uint8Array {
  const bin = atob(base64Part(dataUrl))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export interface ImageFingerprint {
  hash: string
  bytes: number
}

export function imageFingerprint(img: { width: number; height: number; dataUrl: string }): ImageFingerprint {
  const bytes = dataUrlBytes(img.dataUrl)
  return {
    hash: `${bytes.length}:${img.width}x${img.height}:${fnv1a32(bytes.subarray(0, 4096))}`,
    bytes: bytes.length
  }
}
