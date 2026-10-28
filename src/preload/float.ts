import { contextBridge, ipcRenderer } from 'electron'

// 浮窗专用最小桥：只允许关自己 / 向创建方插件回传事件；受限几何 op（只改自己窗口 bounds，主进程夹取收口）是唯一窄例外
contextBridge.exposeInMainWorld('gtoolsFloat', {
  close: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('gtools:float', { op: 'close' }),
  emit: (event: unknown, payload: unknown): Promise<{ ok: boolean }> => {
    if (typeof event !== 'string' || event === '') return Promise.resolve({ ok: false })
    return ipcRenderer.invoke('gtools:float', { op: 'event', event, payload })
  },
  info: (): Promise<{ ok: boolean; data?: { id: string; pluginId: string } }> =>
    ipcRenderer.invoke('gtools:float', { op: 'info' }),
  setBounds: (b: unknown): Promise<{ ok: boolean }> => {
    if (typeof b !== 'object' || b === null) return Promise.resolve({ ok: false })
    const src = b as Record<string, unknown>
    const out: { x?: number; y?: number; width?: number; height?: number } = {}
    for (const k of ['x', 'y', 'width', 'height'] as const) {
      const v = src[k]
      if (v === undefined) continue
      if (typeof v !== 'number' || !Number.isFinite(v)) return Promise.resolve({ ok: false })
      out[k] = v
    }
    if (Object.keys(out).length === 0) return Promise.resolve({ ok: false })
    return ipcRenderer.invoke('gtools:float', { op: 'geometry', ...out })
  }
})
