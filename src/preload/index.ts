import { contextBridge, ipcRenderer, webUtils } from 'electron'

// 单通道最小面：不暴露枚举能力，只暴露泛化 invoke + 宿主通道 + 受限事件订阅
const allowedEventChannels = (channel: string): boolean =>
  channel === 'settings-changed' ||
  channel === 'plugin-state-changed' ||
  channel === 'api-services-changed' ||
  channel === 'host:open-settings' ||
  channel.startsWith('plugin-event:') ||
  channel.startsWith('detached:')

contextBridge.exposeInMainWorld('gtools', {
  invoke: (pluginId: unknown, api: unknown, payload: unknown[]): Promise<unknown> =>
    ipcRenderer.invoke('gtools:api', { pluginId, api, payload }),
  host: (api: unknown, payload: unknown): Promise<unknown> => ipcRenderer.invoke('gtools:host', { api, payload }),
  on: (channel: unknown, listener: (payload: unknown) => void): (() => void) | undefined => {
    if (typeof channel !== 'string' || !allowedEventChannels(channel)) return undefined
    const wrapped = (_e: unknown, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
  // Electron 44 已移除 File.path，拖拽取路径唯一入口是 webUtils（只做转换，真正的文件访问仍受 fs 授权约束）
  pathForFile: (file: unknown): string => {
    if (!(file instanceof File)) throw new Error('pathForFile 需要 File 对象')
    return webUtils.getPathForFile(file)
  }
})
