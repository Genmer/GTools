/** 相对路径/文件名纯逻辑：全部无副作用，服务端与单测共用 */

/** URL 查询参数里的 rel 解码；非法编码或含 NUL 返回 null */
export function decodeRel(raw: string): string | null {
  try {
    const s = decodeURIComponent(raw)
    return s.includes('\0') ? null : s
  } catch {
    return null
  }
}

/**
 * 归一化相对路径：'/' 分段，丢弃空段与 '.'，'..' 回退一级，越出根或含 '\' 一律 null
 * （拒绝 '\' 避免 win32 把它当分隔符绕过边界判定）。
 */
export function normalizeRelPath(input: string): string | null {
  if (input === '') return ''
  const segs: string[] = []
  for (const seg of input.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (segs.length === 0) return null
      segs.pop()
      continue
    }
    if (seg.includes('\\') || seg.includes('\0')) return null
    segs.push(seg)
  }
  return segs.join('/')
}

export function joinRel(base: string, name: string): string {
  return base === '' ? name : `${base}/${name}`
}

export function parentRel(rel: string): string | null {
  if (rel === '') return null
  const i = rel.lastIndexOf('/')
  return i === -1 ? '' : rel.slice(0, i)
}

/** 上传文件名清洗：取 basename，去控制字符与 Windows 非法字符，限长，空则兜底 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? ''
  const cleaned = base.replace(/[\0-\x1F:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/g, '')
  if (cleaned === '') return 'file'
  return cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned
}

function splitExt(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf('.')
  if (i <= 0) return { stem: name, ext: '' } // 无扩展名或点开头隐藏文件（.gitignore）
  return { stem: name.slice(0, i), ext: name.slice(i) }
}

/**
 * 落盘重名规避：'a.txt' → 'a (1).txt'。比较统一用小写——win32 目录名大小写不敏感，
 * 大小写不同同名也会覆盖（win32 分支按此实现，未实测）。
 */
export function uniqueFileName(existing: Iterable<string>, desired: string): string {
  const taken = new Set<string>()
  for (const e of existing) taken.add(e.toLowerCase())
  if (!taken.has(desired.toLowerCase())) return desired
  const { stem, ext } = splitExt(desired)
  for (let i = 1; i < 10000; i++) {
    const cand = `${stem} (${i})${ext}`
    if (!taken.has(cand.toLowerCase())) return cand
  }
  return `${stem} (${Date.now()})${ext}`
}

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  xml: 'text/xml; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip'
}

export function contentTypeFor(name: string): string {
  return CONTENT_TYPES[extensionOf(name)] ?? 'application/octet-stream'
}

/** Content-Disposition 的 ASCII 兜底名：非可打印字符全剔；首字符须为字母数字，否则整名退化 download（避免只剩 ".docx" 这类伪名） */
export function asciiFallbackName(name: string): string {
  const s = name.replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '_').trim()
  return /^[A-Za-z0-9]/.test(s) ? s : 'download'
}

export function contentDispositionHeader(name: string, mode: 'inline' | 'attachment'): string {
  const fallback = asciiFallbackName(name)
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text'

const PREVIEWABLE: Record<string, PreviewKind> = {}
for (const e of ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']) PREVIEWABLE[e] = 'image'
for (const e of ['mp4', 'm4v', 'webm', 'mov']) PREVIEWABLE[e] = 'video'
for (const e of ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac']) PREVIEWABLE[e] = 'audio'
PREVIEWABLE['pdf'] = 'pdf'
for (const e of ['txt', 'md', 'json', 'js', 'mjs', 'ts', 'css', 'xml', 'csv', 'log', 'html', 'htm', 'yml', 'yaml', 'ini', 'conf']) {
  PREVIEWABLE[e] = 'text'
}

export function previewKindFor(name: string): PreviewKind | null {
  return PREVIEWABLE[extensionOf(name)] ?? null
}

export function humanSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
