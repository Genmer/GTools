import type { PluginManifest } from '@sdk/manifest'
import type { PluginBackend } from '@sdk/api'

export interface RegisteredPlugin {
  manifest: PluginManifest
  enabled: boolean
  backend: PluginBackend | null
  backendInited: boolean
  backendStarted: boolean
}

/** 运行时注册表：id → 插件状态。装载/启禁/查询的唯一事实源。 */
export class PluginRegistry {
  private readonly map = new Map<string, RegisteredPlugin>()

  has(id: string): boolean {
    return this.map.has(id)
  }

  get(id: string): RegisteredPlugin | undefined {
    return this.map.get(id)
  }

  register(manifest: PluginManifest, enabled: boolean): RegisteredPlugin {
    const entry: RegisteredPlugin = { manifest, enabled, backend: null, backendInited: false, backendStarted: false }
    this.map.set(manifest.id, entry)
    return entry
  }

  setEnabled(id: string, enabled: boolean): RegisteredPlugin | undefined {
    const entry = this.map.get(id)
    if (entry) entry.enabled = enabled
    return entry
  }

  all(): RegisteredPlugin[] {
    return [...this.map.values()]
  }

  enabledPlugins(): RegisteredPlugin[] {
    return this.all().filter((e) => e.enabled)
  }

  get enabledKeywordOwners(): Map<string, string> {
    const owners = new Map<string, string>()
    for (const e of this.enabledPlugins()) {
      for (const k of e.manifest.keywords) {
        if (!owners.has(k)) owners.set(k, e.manifest.id)
      }
    }
    return owners
  }
}
