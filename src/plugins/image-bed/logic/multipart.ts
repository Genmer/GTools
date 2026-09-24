// multipart/form-data 自行拼装（宿主 net.fetch 只收字符串或 {base64}，见 DESIGN 附录 A.3）。
import { base64ToBytes, bytesToBase64 } from './base64'

export interface MultipartField {
  name: string
  value: string
}

export interface MultipartFile {
  name: string
  filename: string
  contentType: string
  base64: string
}

export interface MultipartBody {
  bodyBase64: string
  contentType: string
}

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let p = 0
  for (const c of chunks) {
    out.set(c, p)
    p += c.length
  }
  return out
}

/** 头部只允许 ASCII 安全字符：中文等非 ASCII 文件名降级为 -，引号/反斜杠/换行剔除 */
export function sanitizeMultipartFilename(filename: string): string {
  const safe = filename.replace(/[\\/"\r\n]/g, '').replace(/[^\x20-\x7e]/g, '-')
  return safe.trim() !== '' ? safe : 'image'
}

function escapeToken(s: string): string {
  return s.replace(/["\\\r\n]/g, '')
}

export function makeBoundary(): string {
  const rand = Math.random().toString(16).slice(2, 10)
  return `----GToolsImageBed${rand}`
}

export function buildMultipart(fields: MultipartField[], file: MultipartFile, boundary: string): MultipartBody {
  const chunks: Uint8Array[] = []
  const push = (s: string): void => {
    chunks.push(asciiBytes(s))
  }
  for (const f of fields) {
    push(`--${boundary}\r\n`)
    push(`Content-Disposition: form-data; name="${escapeToken(f.name)}"\r\n\r\n`)
    push(`${f.value}\r\n`)
  }
  push(`--${boundary}\r\n`)
  push(`Content-Disposition: form-data; name="${escapeToken(file.name)}"; filename="${sanitizeMultipartFilename(file.filename)}"\r\n`)
  push(`Content-Type: ${file.contentType}\r\n\r\n`)
  chunks.push(base64ToBytes(file.base64))
  push(`\r\n--${boundary}--\r\n`)
  return {
    bodyBase64: bytesToBase64(concat(chunks)),
    contentType: `multipart/form-data; boundary=${boundary}`
  }
}
