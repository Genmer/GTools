import type { HostApi } from '@sdk/api'
import { HOST_BROADCAST_EVENTS, HostApiError } from '@sdk/api'

/**
 * HostApi 渲染侧实现：每方法自动携带 pluginId 走 preload 单通道，
 * 返回统一解包（失败抛 HostApiError，code 保留 IPC 错误码，插件可据此区分 SERVICE_*）。
 */
export function createHostClient(pluginId: string): HostApi {
  const call = async <T>(api: string, ...args: unknown[]): Promise<T> => {
    const r = await window.gtools.invoke(pluginId, api, args)
    if (!r.ok) throw new HostApiError(r.error ?? 'BAD_REQUEST', r.message || r.error || `api 调用失败：${api}`)
    return r.data as T
  }
  // app.platform/version 经 IPC 取主进程真实值（navigator.platform 已废弃且 Win32 大小写不符契约），
  // 到达前为空串；IPC 失败时按 UA 猜测兜底
  const appInfo: { platform: string; version: string } = { platform: '', version: '' }
  void Promise.all([call<string>('app.platform'), call<string>('app.version')])
    .then(([platform, version]) => {
      appInfo.platform = platform
      appInfo.version = version
    })
    .catch(() => {
      const ua = navigator.userAgent
      appInfo.platform = ua.includes('Windows') ? 'win32' : ua.includes('Mac') ? 'darwin' : ua.includes('Linux') ? 'linux' : 'unknown'
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
    app: appInfo,
    apis: {
      invoke: (service, payload) => call(`apis.${service}`, payload),
      status: (service) => call(`apis.${service}.status`)
    },
    events: {
      on: (event, cb) => {
        // 宿主级广播事件（api-services-changed）直接订阅；插件私有事件走 plugin-event:<id> 包装
        if ((HOST_BROADCAST_EVENTS as readonly string[]).includes(event)) {
          return window.gtools.on(event, cb) ?? (() => {})
        }
        const off = window.gtools.on(`plugin-event:${pluginId}`, (wrapped) => {
          const w = wrapped as { event: string; payload: unknown }
          if (w && w.event === event) cb(w.payload)
        })
        return off ?? (() => {})
      }
    }
  }
}
