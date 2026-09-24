import { contextBridge, ipcRenderer } from 'electron'

// 浮窗专用最小桥：只允许关自己 / 向创建方插件回传事件，不暴露任何宿主能力面
contextBridge.exposeInMainWorld('gtoolsFloat', {
  close: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('gtools:float', { op: 'close' }),
  emit: (event: unknown, payload: unknown): Promise<{ ok: boolean }> => {
    if (typeof event !== 'string' || event === '') return Promise.resolve({ ok: false })
    return ipcRenderer.invoke('gtools:float', { op: 'event', event, payload })
  },
  info: (): Promise<{ ok: boolean; data?: { id: string; pluginId: string } }> =>
    ipcRenderer.invoke('gtools:float', { op: 'info' })
})
