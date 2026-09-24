// 文件名 / MIME / 可读大小等展示辅助（纯函数）。

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

export const IMAGE_EXTENSIONS = Object.keys(MIME_BY_EXT)

// 同时接受 / 与 \ 分隔（Windows 拖入路径为反斜杠，分支按方案写好、未在 Windows 实测）
export function splitPath(p: string): string[] {
  return p.split(/[\\/]+/).filter((s) => s !== '')
}

export function baseName(p: string): string {
  const parts = splitPath(p)
  return parts.length > 0 ? parts[parts.length - 1] : p
}

export function extOf(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx > 0 ? filename.slice(idx + 1).toLowerCase() : ''
}

export function isImageFilename(filename: string): boolean {
  return extOf(filename) in MIME_BY_EXT
}

export function mimeOf(filename: string): string {
  return MIME_BY_EXT[extOf(filename)] ?? 'application/octet-stream'
}

/** 展示用去扩展名（不含点） */
export function nameWithoutExt(filename: string): string {
  const idx = filename.lastIndexOf('.')
  return idx > 0 ? filename.slice(0, idx) : filename
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/** 粘贴图片生成默认文件名（本地时区） */
export function clipboardImageName(now = new Date()): string {
  const p = (v: number): string => String(v).padStart(2, '0')
  return `pasted-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.png`
}
