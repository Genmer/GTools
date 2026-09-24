import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateManifest, type ManifestError, type PluginManifest } from '@sdk/manifest'
import type { PluginBackend, BackendContext } from '@sdk/api'
import { PluginRegistry } from './plugin-registry'

export interface LoadIssue extends ManifestError {
  pluginName?: string
}

export interface ExternalDetected {
  dir: string
  manifest: PluginManifest
}

export interface LoaderDeps {
  /** 内置插件清单（生产环境由构建期 glob 展开注入） */
  builtinManifests: PluginManifest[]
  /** 懒加载 backend 模块，插件未声明/未打包返回 null */
  loadBackend(id: string): Promise<PluginBackend | null>
  /** 外部插件目录（userData/plugins），null 表示跳过扫描 */
  externalDir: string | null
  /** backend 上下文工厂（主进程内同构 HostApi），注入以便测试 */
  createBackendContext(pluginId: string): BackendContext
}

/**
 * 插件装配：扫描（内置清单 + 外部目录）→ 校验（不通过跳过并收集原因，不抛崩）→ 注册
 * → backend 懒加载（resident 装配即起；trigger 首次进入时起）。
 */
export class PluginLoader {
  readonly registry = new PluginRegistry()
  readonly issues: LoadIssue[] = []
  readonly externalDetected: ExternalDetected[] = []

  constructor(private readonly deps: LoaderDeps) {}

  async load(disabledIds: string[]): Promise<void> {
    const disabled = new Set(disabledIds)

    for (const manifest of this.deps.builtinManifests) {
      this.registerOne(manifest, disabled)
    }

    if (this.deps.externalDir !== null) {
      // 外部插件本期只做清单解析 + 校验（协议预留），不实例化
      const found = await this.scanExternal(this.deps.externalDir)
      for (const { dir, raw } of found) {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          this.issues.push({ pluginId: dir, field: 'manifest', message: '外部插件 manifest.json 不是合法 JSON' })
          continue
        }
        if (typeof parsed === 'object' && parsed !== null) {
          // 来源由宿主判定（外部作者无须声明 source），注入后再校验
          ;(parsed as PluginManifest).source = 'external'
        }
        const errors = validateManifest(parsed, {
          existingIds: new Set(this.registry.all().map((e) => e.manifest.id)),
          activeKeywords: this.registry.enabledKeywordOwners
        })
        if (errors.length > 0) {
          this.issues.push(...errors.map((e) => ({ ...e, pluginName: dir })))
          continue
        }
        const m = parsed as PluginManifest
        m.source = 'external'
        this.externalDetected.push({ dir, manifest: m })
      }
    }

    // resident 插件：装配完成即 init + start（常驻任务，如剪贴板历史轮询）
    for (const entry of this.registry.enabledPlugins()) {
      if (entry.manifest.activation === 'resident') await this.ensureBackendStarted(entry.manifest.id)
    }
  }

  private registerOne(manifest: PluginManifest, disabled: Set<string>): void {
    const errors = validateManifest(manifest, {
      existingIds: new Set(this.registry.all().map((e) => e.manifest.id)),
      activeKeywords: this.registry.enabledKeywordOwners
    })
    if (errors.length > 0) {
      this.issues.push(...errors.map((e) => ({ ...e, pluginName: manifest.name })))
      return
    }
    this.registry.register(manifest, !disabled.has(manifest.id))
  }

  private async scanExternal(dir: string): Promise<{ dir: string; raw: string }[]> {
    const results: { dir: string; raw: string }[] = []
    try {
      const entries = await readdir(dir, { withFileTypes: true })
      for (const ent of entries) {
        if (!ent.isDirectory()) continue
        try {
          const raw = await readFile(join(dir, ent.name, 'manifest.json'), { encoding: 'utf-8' })
          results.push({ dir: ent.name, raw })
        } catch {
          // 无 manifest.json 的目录直接忽略
        }
      }
    } catch {
      // 目录不存在视为无外部插件
    }
    return results
  }

  /** trigger 型带 backend（如 app-launcher）首次进入插件时由宿主调用；resident 在 load 时已起 */
  async ensureBackendStarted(id: string): Promise<void> {
    const entry = this.registry.get(id)
    if (!entry || !entry.enabled || entry.backendStarted) return
    if (entry.backend === null) {
      try {
        entry.backend = await this.deps.loadBackend(id)
      } catch (err) {
        this.issues.push({
          pluginId: id,
          field: 'backend',
          message: `backend 加载失败：${err instanceof Error ? err.message : String(err)}`
        })
        return
      }
    }
    if (entry.backend === null) return
    try {
      if (!entry.backendInited) {
        const ctx = this.deps.createBackendContext(id)
        await entry.backend.init(ctx)
        entry.backendInited = true
      }
      if (!entry.backendStarted) {
        await entry.backend.start()
        entry.backendStarted = true
      }
    } catch (err) {
      // backend 抛错只记录，不崩宿主（B2）
      this.issues.push({
        pluginId: id,
        field: 'backend',
        message: `backend 初始化/启动失败：${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    const entry = this.registry.get(id)
    if (!entry) return { ok: false, error: `插件不存在：${id}` }
    if (entry.enabled === enabled) return { ok: true }
    if (enabled) {
      // 装载时被禁用而跳过校验的插件，启用前须复检：可能与后启用的插件撞 keyword
      const owners = this.registry.enabledKeywordOwners
      for (const k of entry.manifest.keywords) {
        const owner = owners.get(k)
        if (owner !== undefined && owner !== id) {
          return { ok: false, error: `keyword「${k}」已被插件 ${owner} 占用，无法启用「${entry.manifest.name}」` }
        }
      }
    }
    this.registry.setEnabled(id, enabled)
    if (!enabled && entry.backendStarted && entry.backend) {
      await entry.backend.stop() // 常驻任务立即停
      entry.backendStarted = false
    } else if (enabled && entry.manifest.activation === 'resident') {
      await this.ensureBackendStarted(id)
    }
    return { ok: true }
  }

  getEnabledManifests(): PluginManifest[] {
    return this.registry.enabledPlugins().map((e) => e.manifest)
  }

  async disposeAll(): Promise<void> {
    for (const entry of this.registry.all()) {
      if (entry.backend && entry.backendStarted) {
        try {
          await entry.backend.stop()
        } catch {
          // 退出阶段尽力而为
        }
        entry.backendStarted = false
      }
      if (entry.backend?.dispose) {
        try {
          await entry.backend.dispose()
        } catch {
          // 同上
        }
      }
    }
  }
}
