import type { PluginManifest } from '@sdk/manifest'
import type { AppSettings } from '@sdk/settings'
import type { ApiCallError } from '@sdk/api'

export interface HostInitResult {
  settings: AppSettings
  plugins: { manifest: PluginManifest; enabled: boolean }[]
  loadIssues: { pluginId: string; message: string }[]
  externalDetected: { id: string; name: string }[]
}

export interface GtoolsBridge {
  invoke(
    pluginId: string,
    api: string,
    payload: unknown[]
  ): Promise<{ ok: boolean; data?: unknown; error?: ApiCallError; message?: string }>
  host(api: string, payload?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }>
  on(channel: string, listener: (payload: unknown) => void): (() => void) | undefined
  /** 拖拽取路径：drop 事件里对 File 对象调用（Electron 44 无 File.path） */
  pathForFile(file: File): string
}

declare global {
  interface Window {
    gtools: GtoolsBridge
  }
}

export {}
