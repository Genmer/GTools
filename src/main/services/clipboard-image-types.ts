// 剪贴板图片候选类型排序（纯逻辑，供 electron-services 取图用）。
// 微信等应用复制图片时 furl 抢占 W3C 类型，clipboard.read() 里没有任何 image/*，
// 图片数据只剩 electron application/osclipboard;format="..." 原始格式可取（如 NeXT TIFF）。
const WEB_IMAGE_ORDER = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']

const RAW_IMAGE_HINT_RE = /(tiff|png|jpeg|jpg|gif|bmp)/i

export function pickImageCandidateTypes(types: string[]): string[] {
  const web = WEB_IMAGE_ORDER.filter((t) => types.includes(t))
  const others = types.filter((t) => t.startsWith('image/') && !WEB_IMAGE_ORDER.includes(t))
  const raw = types.filter(
    (t) => t.startsWith('electron application/osclipboard;format=') && RAW_IMAGE_HINT_RE.test(t)
  )
  return [...web, ...others, ...raw]
}

// 魔数嗅探，只认 dataUrl 白名单 mime。QQ 复制动图把 GIF 原始字节塞在名叫 TIFF 的
// flavor 里（且 nativeImage 实测解不了 GIF），必须靠字节判定而非 flavor 名
export type SniffedImageMime = 'image/gif' | 'image/png' | 'image/jpeg' | 'image/webp' | 'image/bmp'

export function sniffImageMime(bytes: Uint8Array): SniffedImageMime | null {
  const b = bytes
  const head = (i: number) => String.fromCharCode(b[i] ?? 0)
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b.length >= 6) {
    const h6 = head(0) + head(1) + head(2) + head(3) + head(4) + head(5)
    if (h6 === 'GIF87a' || h6 === 'GIF89a') return 'image/gif'
    if (h6.startsWith('\u0089PNG')) return 'image/png'
    if (h6.startsWith('BM')) return 'image/bmp'
    if (h6.startsWith('RIFF') && b.length >= 12) {
      const t4 = head(8) + head(9) + head(10) + head(11)
      if (t4 === 'WEBP') return 'image/webp'
    }
  }
  return null
}

// GIF 逻辑屏尺寸（头 6..10 两个 LE u16）；nativeImage 解不了 GIF，尺寸只能从头部拿
export function gifScreenSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 10 || sniffImageMime(bytes) !== 'image/gif') return null
  return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
}

// text/uri-list 单一 file:// 条目 → 本地路径；多条或非 file 协议返回 null。
// QQ/Finder 复制图片文件时粘贴板只有 uri 引用，图像数据要去文件里读
export function parseFileUriList(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
  if (lines.length !== 1 || !lines[0].startsWith('file://')) return null
  try {
    return decodeURIComponent(new URL(lines[0]).pathname)
  } catch {
    return null
  }
}
