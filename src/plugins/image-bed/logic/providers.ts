// 图床上传执行层：provider 目标解析、multipart 发送、响应解析与错误分类（fetch 注入可测）。
// sm.ms v2：POST /api/v2/upload，字段 smfile，Authorization: Basic <token>，重复图时 code=image_repeated 且 images 即 URL。
// 兰空 lsky：POST {base}/api/v1/upload，字段 file，Authorization: Bearer <token>，URL 在 data.links.url。
import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import { buildMultipart, makeBoundary } from './multipart'
import { authHeaderValue, isHttpUrl, lskyUploadUrl } from './settings'
import type { ImageBedSettings, ProviderId } from './settings'

export type FetchFn = (url: string, init?: HostFetchInit) => Promise<HostFetchResult>

export type ImageBedErrorKind = 'config' | 'timeout' | 'network' | 'http' | 'auth' | 'parse' | 'server'

export class ImageBedError extends Error {
  readonly kind: ImageBedErrorKind
  constructor(kind: ImageBedErrorKind, message: string) {
    super(message)
    this.name = 'ImageBedError'
    this.kind = kind
  }
}

export interface UploadInput {
  filename: string
  contentType: string
  base64: string
}

export interface UploadResult {
  url: string
  deleteUrl?: string
  providerId: string
}

export interface ResolvedProvider {
  providerId: ProviderId
  url: string
  fileField: string
  headers: Record<string, string>
  /** 响应 JSON 取 URL 的点分路径；空 = 自动探测 */
  urlPath: string
}

export const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000

/** 配置 → 请求目标；配置缺失抛 ImageBedError('config') */
export function resolveUploadTarget(settings: ImageBedSettings): ResolvedProvider {
  if (settings.providerId === 'smms') {
    const headers: Record<string, string> = {}
    if (settings.smmsToken !== '') headers.Authorization = `Basic ${settings.smmsToken}`
    return { providerId: 'smms', url: 'https://sm.ms/api/v2/upload', fileField: 'smfile', headers, urlPath: '' }
  }
  if (settings.providerId === 'lsky') {
    if (!isHttpUrl(settings.lskyApiUrl)) {
      throw new ImageBedError('config', '兰空图床未配置有效的 API 地址（须以 http:// 或 https:// 开头）')
    }
    if (settings.lskyToken === '') {
      throw new ImageBedError('config', '兰空图床需要 Token（在兰空后台获取后填入设置）')
    }
    return {
      providerId: 'lsky',
      url: lskyUploadUrl(settings.lskyApiUrl),
      fileField: 'file',
      headers: { Authorization: `Bearer ${settings.lskyToken}` },
      urlPath: 'data.links.url'
    }
  }
  if (!isHttpUrl(settings.custom.apiUrl)) {
    throw new ImageBedError('config', '自定义接口地址无效（须以 http:// 或 https:// 开头）')
  }
  const auth = authHeaderValue(settings.custom.authScheme, settings.custom.token)
  const headers: Record<string, string> = {}
  if (auth !== null) headers.Authorization = auth
  return {
    providerId: 'custom',
    url: settings.custom.apiUrl,
    fileField: settings.custom.fileField,
    headers,
    urlPath: settings.custom.urlPath
  }
}

type Json = Record<string, unknown>

function asJson(body: string): Json {
  try {
    const v = JSON.parse(body) as unknown
    if (typeof v === 'object' && v !== null) return v as Json
    throw new Error('not object')
  } catch {
    throw new ImageBedError('parse', '图床返回了无法解析的内容（可能不是 JSON 接口）')
  }
}

/** 点分路径取值（数组用数字下标），不存在返回 undefined */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.').filter((s) => s !== '')) {
    if (cur === null || cur === undefined) return undefined
    if (Array.isArray(cur)) {
      const i = Number(seg)
      cur = Number.isInteger(i) ? cur[i] : undefined
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg]
    } else {
      return undefined
    }
  }
  return cur
}

const URL_RE = /^https?:\/\/\S+$/i

/** 深度扫描常见响应结构（未知接口兜底）：逐层 BFS 找第一个 http(s) 字符串，同层优先键名 url/link */
export function autoDetectUrl(json: unknown): string | null {
  for (const p of ['data.links.url', 'data.url', 'url', 'data.image.url', 'data.images.url', 'images.url', 'data.origin_url']) {
    const v = getPath(json, p)
    if (typeof v === 'string' && URL_RE.test(v)) return v
  }
  let level: unknown[] = [json]
  for (let depth = 0; depth < 8 && level.length > 0; depth++) {
    const next: unknown[] = []
    const later: unknown[] = []
    for (const cur of level) {
      if (typeof cur === 'string') {
        if (URL_RE.test(cur)) return cur
      } else if (Array.isArray(cur)) {
        next.push(...cur)
      } else if (typeof cur === 'object' && cur !== null) {
        for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
          if (k === 'url' || k === 'link') next.push(v)
          else later.push(v)
        }
      }
    }
    level = [...next, ...later]
  }
  return null
}

export function parseSmms(json: Json): { url: string; deleteUrl?: string } | null {
  if (json.code === 'image_repeated' && typeof json.images === 'string' && URL_RE.test(json.images)) {
    return { url: json.images }
  }
  const success = json.success === true || json.code === 'success'
  const data = json.data
  if (success && typeof data === 'object' && data !== null) {
    const url = (data as Json).url
    if (typeof url === 'string' && URL_RE.test(url)) {
      const del = (data as Json).delete
      return { url, deleteUrl: typeof del === 'string' ? del : undefined }
    }
  }
  return null
}

export function parseLsky(json: Json): { url: string; deleteUrl?: string } | null {
  if (json.status !== true) return null
  const data = json.data
  if (typeof data !== 'object' || data === null) return null
  const links = (data as Json).links
  const fromLinks = typeof links === 'object' && links !== null ? (links as Json).url : undefined
  const direct = (data as Json).url ?? (data as Json).origin_url
  const url = typeof fromLinks === 'string' ? fromLinks : direct
  return typeof url === 'string' && URL_RE.test(url) ? { url } : null
}

function serverMessage(json: Json): string {
  const m = json.message ?? json.code
  if (typeof m === 'string' && m !== '') return m
  return '图床拒绝了本次上传'
}

export async function uploadImage(input: UploadInput, settings: ImageBedSettings, fetch: FetchFn, timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS): Promise<UploadResult> {
  const target = resolveUploadTarget(settings)
  const boundary = makeBoundary()
  const body = buildMultipart([], { name: target.fileField, filename: input.filename, contentType: input.contentType, base64: input.base64 }, boundary)

  let res: HostFetchResult
  try {
    res = await fetch(target.url, {
      method: 'POST',
      headers: { ...target.headers, 'Content-Type': body.contentType },
      body: { base64: body.bodyBase64 },
      timeoutMs
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // 兼容 "timeout" / "timed out" / "time 'out" 等消息形态
    if (/time.{0,3}out|aborted|超时/i.test(msg)) {
      throw new ImageBedError('timeout', '上传超时（图床无响应或图片过大），请重试')
    }
    throw new ImageBedError('network', `网络请求失败：${msg}`)
  }

  if (!res.ok) {
    const json = safeJson(res.body)
    if (res.status === 401 || res.status === 403) {
      throw new ImageBedError('auth', `鉴权失败（HTTP ${res.status}）：请检查设置里的 Token 是否有效${settings.providerId === 'smms' ? '；sm.ms 匿名上传有额度限制，建议登录后台获取 API Token' : ''}`)
    }
    if (res.status === 429) {
      throw new ImageBedError('server', '请求过于频繁或额度不足（HTTP 429），请稍后再试')
    }
    throw new ImageBedError('http', `图床返回 HTTP ${res.status}${json !== null ? `：${serverMessage(json)}` : ''}`)
  }

  const json = asJson(res.body)
  let parsed: { url: string; deleteUrl?: string } | null = null
  if (target.providerId === 'smms') parsed = parseSmms(json)
  else if (target.providerId === 'lsky') parsed = parseLsky(json)
  else if (target.urlPath !== '') {
    const v = getPath(json, target.urlPath)
    parsed = typeof v === 'string' && URL_RE.test(v) ? { url: v } : null
  } else {
    const v = autoDetectUrl(json)
    parsed = v !== null ? { url: v } : null
  }
  if (parsed === null) {
    throw new ImageBedError('server', serverMessage(json))
  }
  return { url: parsed.url, deleteUrl: parsed.deleteUrl, providerId: target.providerId }
}

function safeJson(body: string): Json | null {
  try {
    const v = JSON.parse(body) as unknown
    return typeof v === 'object' && v !== null ? (v as Json) : null
  } catch {
    return null
  }
}

/** 供 UI 展示当前 provider 名称 */
export function providerLabel(settings: ImageBedSettings): string {
  if (settings.providerId === 'smms') return settings.smmsToken === '' ? 'sm.ms（匿名）' : 'sm.ms'
  if (settings.providerId === 'lsky') return '兰空 lsky'
  return '自定义接口'
}
