import type {
  ApiServiceId,
  ApiServiceStatus,
  ApiCallResult,
  BackendContext,
  DialogOpenOptions,
  DialogSaveOptions,
  FloatWindowOptions,
  FloatWindowPatch,
  FsListOptions,
  FsReadOptions,
  FsStatResult,
  FsWriteOptions,
  FsEntry,
  HostFetchInit,
  HostFetchResult,
  LanAddress,
  TranslateRequest,
  TranslateResult
} from '@sdk/api'
import { API_PERMISSIONS, HostApiError } from '@sdk/api'
import type { PluginRegistry } from '../plugin-registry'
import type { FloatWindowApi } from './float-window'
import { ApiServiceError } from './api-center'

/** 各能力面的最小实现接口（services 单例），主进程装配时注入，测试可 fake */
export interface ServiceBag {
  clipboard: {
    readText(): Promise<string>
    writeText(t: string): Promise<void>
    readImage(): Promise<{ width: number; height: number; dataUrl: string } | null>
    writeImage(dataUrl: string): Promise<void>
  }
  storage: {
    get(pluginId: string, key: string): Promise<unknown>
    set(pluginId: string, key: string, value: unknown): Promise<void>
    remove(pluginId: string, key: string): Promise<void>
    keys(pluginId: string): Promise<string[]>
    dumpAll(): Promise<Record<string, Record<string, unknown>>>
    replaceAll(pluginId: string, kv: Record<string, unknown>): Promise<void>
  }
  net: {
    fetch(url: string, init?: HostFetchInit): Promise<HostFetchResult>
    lanAddresses(): Promise<LanAddress[]>
  }
  notification: { show(title: string, body: string): Promise<void> }
  shell: {
    openApp(target: string): Promise<void>
    openPath(p: string): Promise<void>
    openExternal(url: string): Promise<void>
  }
  window: {
    hide(): Promise<void>
    float: FloatWindowApi
  }
  dialog: {
    openFile(pluginId: string, opts?: DialogOpenOptions): Promise<string[]>
    saveFile(pluginId: string, opts?: DialogSaveOptions): Promise<string | null>
  }
  fs: {
    grant(pluginId: string, paths: string[]): Promise<void>
    read(pluginId: string, path: string, opts?: FsReadOptions): Promise<string>
    write(pluginId: string, path: string, data: string, opts?: FsWriteOptions): Promise<void>
    rename(pluginId: string, from: string, to: string): Promise<void>
    remove(pluginId: string, path: string): Promise<void>
    stat(pluginId: string, path: string): Promise<FsStatResult | null>
    list(pluginId: string, dir: string, opts?: FsListOptions): Promise<FsEntry[]>
    mkdir(pluginId: string, path: string): Promise<void>
  }
  app: { platform: string; version: string }
  apis: {
    translate(req: TranslateRequest): Promise<TranslateResult>
    status(service: ApiServiceId): ApiServiceStatus
  }
  events: { emitToRenderer(pluginId: string, event: string, payload: unknown): void }
}

/**
 * 安全边界：校验插件存在且启用、api 在其 manifest permissions 白名单内，再分发。
 * 渲染 IPC（经 preload）与 backend 直调共用此函数，保证同一套权限语义。
 */
export async function dispatchApi(
  registry: PluginRegistry,
  services: ServiceBag,
  pluginId: string,
  api: string,
  payload: unknown[]
): Promise<ApiCallResult> {
  const entry = registry.get(pluginId)
  if (!entry) return { ok: false, error: 'PLUGIN_NOT_FOUND', message: `插件不存在：${pluginId}` }
  if (!entry.enabled) return { ok: false, error: 'PLUGIN_DISABLED', message: `插件已禁用：${pluginId}` }

  const required = API_PERMISSIONS[api]
  if (required && !entry.manifest.permissions.includes(required)) {
    return { ok: false, error: 'PERMISSION_DENIED', message: `插件 ${pluginId} 未声明权限 ${required}（api: ${api}）` }
  }

  try {
    switch (api) {
      case 'clipboard.readText':
        return { ok: true, data: await services.clipboard.readText() }
      case 'clipboard.writeText':
        return { ok: true, data: await services.clipboard.writeText(str(payload[0])) }
      case 'clipboard.readImage':
        return { ok: true, data: await services.clipboard.readImage() }
      case 'clipboard.writeImage':
        return { ok: true, data: await services.clipboard.writeImage(str(payload[0])) }
      case 'storage.get':
        return { ok: true, data: await services.storage.get(pluginId, str(payload[0])) }
      case 'storage.set':
        return { ok: true, data: await services.storage.set(pluginId, str(payload[0]), payload[1]) }
      case 'storage.remove':
        return { ok: true, data: await services.storage.remove(pluginId, str(payload[0])) }
      case 'storage.keys':
        return { ok: true, data: await services.storage.keys(pluginId) }
      case 'net.fetch':
        return { ok: true, data: await services.net.fetch(str(payload[0]), obj(payload[1])) }
      case 'net.lanAddresses':
        return { ok: true, data: await services.net.lanAddresses() }
      case 'notification.show':
        return { ok: true, data: await services.notification.show(str(payload[0]), str(payload[1])) }
      case 'shell.openApp':
        return { ok: true, data: await services.shell.openApp(str(payload[0])) }
      case 'shell.openPath':
        return { ok: true, data: await services.shell.openPath(str(payload[0])) }
      case 'shell.openExternal':
        return { ok: true, data: await services.shell.openExternal(str(payload[0])) }
      case 'window.hide':
        return { ok: true, data: await services.window.hide() }
      case 'window.float.create':
        return { ok: true, data: services.window.float.create(pluginId, obj(payload[0]) as unknown as FloatWindowOptions) }
      case 'window.float.update':
        return {
          ok: true,
          data: services.window.float.update(pluginId, str(payload[0]), (obj(payload[1]) ?? {}) as FloatWindowPatch)
        }
      case 'window.float.close':
        return { ok: true, data: services.window.float.close(pluginId, str(payload[0])) }
      case 'window.float.closeAll':
        return { ok: true, data: services.window.float.closeAllForPlugin(pluginId) }
      case 'dialog.openFile':
        return { ok: true, data: await services.dialog.openFile(pluginId, obj(payload[0]) as DialogOpenOptions) }
      case 'dialog.saveFile':
        return { ok: true, data: await services.dialog.saveFile(pluginId, obj(payload[0]) as DialogSaveOptions) }
      case 'fs.grant':
        return { ok: true, data: await services.fs.grant(pluginId, strArray(payload[0])) }
      case 'fs.read':
        return { ok: true, data: await services.fs.read(pluginId, str(payload[0]), obj(payload[1]) as FsReadOptions) }
      case 'fs.write':
        return {
          ok: true,
          data: await services.fs.write(pluginId, str(payload[0]), str(payload[1]), obj(payload[2]) as FsWriteOptions)
        }
      case 'fs.rename':
        return { ok: true, data: await services.fs.rename(pluginId, str(payload[0]), str(payload[1])) }
      case 'fs.remove':
        return { ok: true, data: await services.fs.remove(pluginId, str(payload[0])) }
      case 'fs.stat':
        return { ok: true, data: await services.fs.stat(pluginId, str(payload[0])) }
      case 'fs.list':
        return { ok: true, data: await services.fs.list(pluginId, str(payload[0]), obj(payload[1]) as FsListOptions) }
      case 'fs.mkdir':
        return { ok: true, data: await services.fs.mkdir(pluginId, str(payload[0])) }
      case 'app.platform':
        return { ok: true, data: services.app.platform }
      case 'app.version':
        return { ok: true, data: services.app.version }
      case 'apis.translate': {
        const p = obj(payload[0])
        if (
          p === undefined ||
          typeof p.text !== 'string' ||
          typeof p.from !== 'string' ||
          typeof p.to !== 'string' ||
          (p.providerId !== undefined && typeof p.providerId !== 'string')
        ) {
          throw new Error('参数必须是 { text, from, to } 且均为字符串（providerId 可选，须为字符串）')
        }
        // SERVICE_* 错误码要在通用 catch（BAD_REQUEST）之前透出，插件据此区分未配置与执行失败
        try {
          return {
            ok: true,
            data: await services.apis.translate({
              text: p.text,
              from: p.from,
              to: p.to,
              // 空串归一成 undefined，服务层只认有效 id
              providerId: typeof p.providerId === 'string' && p.providerId !== '' ? p.providerId : undefined
            })
          }
        } catch (err) {
          if (err instanceof ApiServiceError) return { ok: false, error: err.code, message: err.message }
          throw err
        }
      }
      case 'apis.translate.status':
        return { ok: true, data: services.apis.status('translate') }
      default:
        return { ok: false, error: 'UNKNOWN_API', message: `未知 api：${api}` }
    }
  } catch (err) {
    return { ok: false, error: 'BAD_REQUEST', message: err instanceof Error ? err.message : String(err) }
  }
}

function str(v: unknown): string {
  if (typeof v !== 'string') throw new Error('参数必须是字符串')
  return v
}

/** undefined 放行为 undefined（可选参数）；否则必须是普通对象 */
function obj(v: unknown): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('参数必须是对象')
  return v as Record<string, unknown>
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new Error('参数必须是字符串数组')
  return v as string[]
}

/** backend 的同构上下文：主进程内直调 dispatch（无 IPC 往返）+ emit 推送渲染层 */
export function createBackendContext(registry: PluginRegistry, services: ServiceBag, pluginId: string): BackendContext {
  const call = <T>(api: string, ...args: unknown[]): Promise<T> =>
    dispatchApi(registry, services, pluginId, api, args).then((r) => {
      if (!r.ok) throw new HostApiError(r.error, r.message)
      return r.data as T
    })
  return {
    apiVersion: 1,
    clipboard: {
      readText: () => call('clipboard.readText'),
      writeText: (t) => call('clipboard.writeText', t),
      readImage: () => call('clipboard.readImage'),
      writeImage: (d) => call('clipboard.writeImage', d)
    },
    storage: {
      get: <T>(key: string) => call<T | null>('storage.get', key),
      set: (key, value) => call('storage.set', key, value),
      remove: (key) => call('storage.remove', key),
      keys: () => call<string[]>('storage.keys')
    },
    net: {
      fetch: (url, init) => call('net.fetch', url, init),
      lanAddresses: () => call('net.lanAddresses')
    },
    notification: { show: (title, body) => call('notification.show', title, body) },
    shell: {
      openApp: (target) => call('shell.openApp', target),
      openPath: (p) => call('shell.openPath', p),
      openExternal: (url) => call('shell.openExternal', url)
    },
    window: {
      hide: () => call('window.hide'),
      float: {
        create: (opts) => call<string>('window.float.create', opts),
        update: (id, patch) => call('window.float.update', id, patch),
        close: (id) => call('window.float.close', id),
        closeAll: () => call('window.float.closeAll')
      }
    },
    dialog: {
      openFile: (opts) => call<string[]>('dialog.openFile', opts),
      saveFile: (opts) => call<string | null>('dialog.saveFile', opts)
    },
    fs: {
      grant: (paths) => call('fs.grant', paths),
      read: (path, opts) => call<string>('fs.read', path, opts),
      write: (path, data, opts) => call('fs.write', path, data, opts),
      rename: (from, to) => call('fs.rename', from, to),
      remove: (path) => call('fs.remove', path),
      stat: (path) => call('fs.stat', path),
      list: (dir, opts) => call('fs.list', dir, opts),
      mkdir: (path) => call('fs.mkdir', path)
    },
    app: { platform: services.app.platform, version: services.app.version },
    apis: {
      invoke: (service, payload) => call(`apis.${service}`, payload),
      status: (service) => call(`apis.${service}.status`)
    },
    events: {
      on: () => () => {} // backend 侧事件订阅点，随首个常驻插件启用时补实现
    },
    emit: (event, payload) => services.events.emitToRenderer(pluginId, event, payload)
  }
}
