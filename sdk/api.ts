import type { Permission, PluginManifest } from './manifest'

export interface HostFetchInit {
  method?: string
  headers?: Record<string, string>
  /** 字符串直传；二进制上传用 { base64 }（multipart 需自行拼装 body 后整体 base64） */
  body?: string | { base64: string }
  timeoutMs?: number
}

export interface HostFetchResult {
  ok: boolean
  status: number
  body: string
}

export interface LanAddress {
  name: string
  address: string
}

/** 浮窗创建参数；html 为完整 HTML 片段（宿主注入默认样式与 .drag/.no-drag 工具类） */
export interface FloatWindowOptions {
  html: string
  width?: number
  height?: number
  x?: number
  y?: number
  title?: string
  resizable?: boolean
  alwaysOnTop?: boolean
  transparent?: boolean
  /** 0.1–1，小于 1 时窗口半透明 */
  opacity?: number
  /** false 时创建但不显示（之后经 update 显示/聚焦），默认 true */
  show?: boolean
  /** false 时不抢占焦点（showInactive），默认 true */
  focus?: boolean
}

export interface FloatWindowPatch {
  html?: string
  width?: number
  height?: number
  x?: number
  y?: number
  resizable?: boolean
  alwaysOnTop?: boolean
  opacity?: number
  focus?: boolean
}

/** 浮窗页面内点击等事件回传（经 events.on('float-event') 订阅） */
export interface FloatWindowEvent {
  id: string
  event: string
  payload: unknown
}

/** 浮窗 HTML 内可用的全局桥（window.gtoolsFloat），插件组装 html 时自行声明使用 */
export interface FloatPageBridge {
  close(): Promise<{ ok: boolean }>
  emit(event: string, payload: unknown): Promise<{ ok: boolean }>
  info(): Promise<{ ok: boolean; data?: { id: string; pluginId: string } }>
}

export interface DialogFileFilter {
  name: string
  extensions: string[]
}

export interface DialogOpenOptions {
  title?: string
  defaultPath?: string
  filters?: DialogFileFilter[]
  multiple?: boolean
  /** true 选目录（授权整棵子树），默认 false 选文件 */
  directory?: boolean
}

export interface DialogSaveOptions {
  title?: string
  defaultPath?: string
  filters?: DialogFileFilter[]
}

export interface FsReadOptions {
  /** 默认 utf-8 文本；base64 返回二进制内容的 base64 */
  encoding?: 'utf-8' | 'base64'
}

export interface FsWriteOptions {
  encoding?: 'utf-8' | 'base64'
  append?: boolean
  /** true 时自动创建缺失的父目录 */
  createDir?: boolean
}

export interface FsStatResult {
  exists: boolean
  isFile: boolean
  isDirectory: boolean
  size: number
  mtimeMs: number
}

export interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
}

export interface FsListOptions {
  recursive?: boolean
}

/** 全局 API 中心的服务品类（封闭枚举：扩服务 = 协议发版时在此加一行） */
export type ApiServiceId = 'translate'

export interface TranslateRequest {
  text: string
  from: string
  to: string
  /** 指定 provider（聚合翻译切引擎用）；省略或空串 = 走全局 activeProvider */
  providerId?: string
}

export interface TranslateResult {
  resultText: string
  detectedFrom?: string
  providerId: string
}

/** status 附带的 provider 概要（插件引擎 tab 数据源）；密钥等凭证永不出现 */
export interface ApiProviderSummary {
  id: string
  name: string
  enabled: boolean
}

export interface ApiServiceStatus {
  service: ApiServiceId
  /** false = 未配置任何 provider，宿主回退内置默认（翻译 = MyMemory 免 key） */
  configured: boolean
  /** '' = 内置默认 */
  activeProviderId: string
  activeProviderName: string
  /** 全部已配置 provider（含禁用，插件自行过滤 enabled 渲染引擎 tab） */
  providers: ApiProviderSummary[]
}

/** 渲染层可经 ctx.host.events.on 订阅的宿主广播事件（其余事件仍走 plugin-event:<id>） */
export const HOST_BROADCAST_EVENTS = ['api-services-changed'] as const
export type HostBroadcastEvent = (typeof HOST_BROADCAST_EVENTS)[number]

/**
 * 宿主 API v1 全集（渲染层插件经 host-client 走 IPC，backend 经 BackendContext 直调，同一能力面）。
 * 插件伪造他人 pluginId 的防御本期不做（无外部插件），主进程只校验启用状态 + 自身 permissions。
 * fs 能力限定在「用户主动授权路径」内：对话框选择的路径自动授权；拖拽文件先经 fs.grant 注册。
 */
export interface HostApi {
  readonly apiVersion: 1
  clipboard: {
    readText(): Promise<string>
    writeText(t: string): Promise<void>
    readImage(): Promise<{ width: number; height: number; dataUrl: string } | null>
    writeImage(dataUrl: string): Promise<void>
  }
  storage: {
    get<T>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
    remove(key: string): Promise<void>
    keys(): Promise<string[]>
  }
  net: {
    fetch(url: string, init?: HostFetchInit): Promise<HostFetchResult>
    /** 本机局域网 IPv4 地址（网卡名 → 地址），局域网共享类插件用 */
    lanAddresses(): Promise<LanAddress[]>
  }
  notification: { show(title: string, body: string): Promise<void> }
  shell: {
    openApp(target: string): Promise<void>
    openPath(p: string): Promise<void>
    /** 用系统默认浏览器打开 http(s) 链接 */
    openExternal(url: string): Promise<void>
  }
  window: {
    hide(): Promise<void>
    /** 置顶无边框小浮窗；插件禁用/应用退出时由宿主统一关闭，防泄漏 */
    float: {
      create(opts: FloatWindowOptions): Promise<string>
      update(id: string, patch: FloatWindowPatch): Promise<void>
      close(id: string): Promise<void>
      closeAll(): Promise<void>
    }
  }
  dialog: {
    /** 用户选中即自动授予 fs 读写授权；取消返回 [] */
    openFile(opts?: DialogOpenOptions): Promise<string[]>
    /** 返回目标路径（文件未创建），取消返回 null；路径自动授予写授权 */
    saveFile(opts?: DialogSaveOptions): Promise<string | null>
  }
  fs: {
    /** 拖拽注册：把用户拖入的绝对路径加入授权集（文件精确授权，目录授权整棵子树） */
    grant(paths: string[]): Promise<void>
    read(path: string, opts?: FsReadOptions): Promise<string>
    write(path: string, data: string, opts?: FsWriteOptions): Promise<void>
    rename(from: string, to: string): Promise<void>
    remove(path: string): Promise<void>
    stat(path: string): Promise<FsStatResult | null>
    list(dir: string, opts?: FsListOptions): Promise<FsEntry[]>
    mkdir(path: string): Promise<void>
  }
  app: { platform: string; version: string }
  /** 全局 API 中心：主进程代理调用（密钥不下发渲染层），见 DESIGN 附录 B */
  apis: {
    invoke(service: ApiServiceId, payload: TranslateRequest): Promise<TranslateResult>
    status(service: ApiServiceId): Promise<ApiServiceStatus>
  }
  events: { on(event: string, cb: (p: unknown) => void): () => void }
}

/** backend 额外具备向渲染层推送事件的能力（HostApi 之外的唯一扩展） */
export interface BackendContext extends HostApi {
  emit(event: string, payload: unknown): void
}

/** 插件渲染入口组件的固定 props 之一（DESIGN §3.4） */
export interface PluginContext {
  manifest: PluginManifest
  host: HostApi
}

export interface PluginBackend {
  init(ctx: BackendContext): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  dispose?(): Promise<void>
}

/** api 名 → 所需权限；未列出的 api 视为公共信息，无需权限 */
export const API_PERMISSIONS: Readonly<Record<string, Permission | undefined>> = {
  'clipboard.readText': 'clipboard:read',
  'clipboard.readImage': 'clipboard:read',
  'clipboard.writeText': 'clipboard:write',
  'clipboard.writeImage': 'clipboard:write',
  'storage.get': 'storage',
  'storage.set': 'storage',
  'storage.remove': 'storage',
  'storage.keys': 'storage',
  'net.fetch': 'net',
  'net.lanAddresses': 'net',
  'notification.show': 'notification',
  'shell.openApp': 'shell:open',
  'shell.openPath': 'shell:open',
  'shell.openExternal': 'shell:open',
  'window.hide': 'window:hide',
  'window.float.create': 'window:float',
  'window.float.update': 'window:float',
  'window.float.close': 'window:float',
  'window.float.closeAll': 'window:float',
  'dialog.openFile': 'dialog',
  'dialog.saveFile': 'dialog',
  'fs.grant': 'fs',
  'fs.read': 'fs',
  'fs.write': 'fs',
  'fs.rename': 'fs',
  'fs.remove': 'fs',
  'fs.stat': 'fs',
  'fs.list': 'fs',
  'fs.mkdir': 'fs',
  'apis.translate': 'apis:translate',
  'apis.translate.status': 'apis:translate',
  'app.platform': undefined,
  'app.version': undefined
}

export const API_NAMES: readonly string[] = Object.keys(API_PERMISSIONS)

export type ApiCallError =
  | 'PERMISSION_DENIED'
  | 'PLUGIN_NOT_FOUND'
  | 'PLUGIN_DISABLED'
  | 'UNKNOWN_API'
  | 'BAD_REQUEST'
  /** API 中心：无可用 provider（当前 provider 被禁用等） */
  | 'SERVICE_UNCONFIGURED'
  /** API 中心：provider 执行失败（message 前缀分类 timeout/network/http/quota/parse/config） */
  | 'SERVICE_ERROR'

/** host-client / backend ctx 抛出的调用错误：code 保留 IPC 错误码（插件可据此区分 SERVICE_*） */
export class HostApiError extends Error {
  readonly code: ApiCallError
  constructor(code: ApiCallError, message: string) {
    super(message)
    this.name = 'HostApiError'
    this.code = code
  }
}

export interface ApiCallOk<T = unknown> {
  ok: true
  data: T
}

export interface ApiCallErr {
  ok: false
  error: ApiCallError
  message: string
}

export type ApiCallResult<T = unknown> = ApiCallOk<T> | ApiCallErr
