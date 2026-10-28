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

/** 超时兜底结果：ok=false 时 p 仍在挂起，调用方按自身语义收尾 */
type Timed<T> = { ok: true; value: T } | { ok: false; timedOut: true }

function withTimeout<T>(p: Promise<T>, ms: number): Promise<Timed<T>> {
  return new Promise<Timed<T>>((resolve, reject) => {
    const timer = setTimeout(() => resolve({ ok: false, timedOut: true }), ms)
    p.then(
      (value) => {
        clearTimeout(timer)
        resolve({ ok: true, value })
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * 插件装配：扫描（内置清单 + 外部目录）→ 校验（不通过跳过并收集原因，不抛崩）→ 注册
 * → backend 懒加载（resident 装配即起；trigger 首次进入时起）。
 * backend 的 init/start/stop 若挂起，按注入的超时兜底返回，宿主不陪挂。
 */
export class PluginLoader {
  readonly registry = new PluginRegistry()
  readonly issues: LoadIssue[] = []
  readonly externalDetected: ExternalDetected[] = []
  /** 进行中的 backend 启动：并发调用共享同一次 init/start */
  private readonly startingBackends = new Map<string, Promise<void>>()
  private readonly startTimeoutMs: number
  private readonly stopTimeoutMs: number

  constructor(
    private readonly deps: LoaderDeps,
    timeouts: { startMs?: number; stopMs?: number } = {}
  ) {
    this.startTimeoutMs = timeouts.startMs ?? 15_000
    this.stopTimeoutMs = timeouts.stopMs ?? 5_000
  }

  async load(disabledIds: string[], opts: { startResidentBackends?: boolean } = {}): Promise<void> {
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

    // resident 插件默认装配即起；宿主把窗口链提前时可传 false，另调 startResidentBackends 后台起
    if (opts.startResidentBackends !== false) await this.startResidentBackends()
  }

  /** resident 插件批量启动：init/start 错误进 issues，意外异常记日志，均不阻断其余 */
  async startResidentBackends(): Promise<void> {
    for (const entry of this.registry.enabledPlugins()) {
      if (entry.manifest.activation !== 'resident') continue
      try {
        await this.ensureBackendStarted(entry.manifest.id)
      } catch (err) {
        console.error(`GTools 常驻 backend 启动失败（${entry.manifest.id}）：`, err)
      }
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

  /** trigger 型带 backend（如 app-launcher）首次进入插件时由宿主调用；resident 在 load/startResidentBackends 时已起。
   *  in-flight 复用：指令热键与 plugin:enter 并发时共享同一次加载+init+start，防双 interval；
   *  init/start 挂起按超时放弃等待（记 issues 并置已启动，防后续重复 start 把挂死 backend 搞得更乱） */
  async ensureBackendStarted(id: string): Promise<void> {
    const entry = this.registry.get(id)
    if (!entry || !entry.enabled || entry.backendStarted) return
    const inFlight = this.startingBackends.get(id)
    if (inFlight) return inFlight
    const p = (async () => {
      const r = await withTimeout(this.startBackend(id), this.startTimeoutMs)
      if (!r.ok) {
        const e = this.registry.get(id)
        if (e && e.enabled && !e.backendStarted) {
          e.backendStarted = true
          this.issues.push({ pluginId: id, field: 'backend', message: 'backend 启动超时，已放弃等待' })
        }
      }
    })().finally(() => this.startingBackends.delete(id))
    this.startingBackends.set(id, p)
    return p
  }

  private async startBackend(id: string): Promise<void> {
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

  /** 备份导入的重载信令前半：stop 运行中的 backend 并清 init 标记，返回是否发生了 stop。
   *  backend 的 stop 会把内存态 flush 落盘（clipboard/todo-pomodoro 均如此），调用方必须把本方法
   *  放在 storage.replaceAll 之前让导入数据覆盖之；后半 ensureBackendStarted 在 replaceAll 之后调，
   *  backend 重新 init 才会读到导入后的 kv（模块级单例，重复 loadBackend 拿不到新实例）。 */
  async suspendBackend(id: string): Promise<boolean> {
    const entry = this.registry.get(id)
    if (!entry || !entry.backendStarted || entry.backend === null) return false
    const r = await withTimeout(Promise.resolve(entry.backend.stop()), this.stopTimeoutMs)
    if (!r.ok) console.error(`GTools backend 停止超时（${id}），重载继续`)
    entry.backendStarted = false
    entry.backendInited = false
    return true
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
      // stop 挂起不陪挂：超时后照常视作已停（backend 自行完成后无碍）
      const r = await withTimeout(Promise.resolve(entry.backend.stop()), this.stopTimeoutMs)
      if (!r.ok) console.error(`GTools backend 停止超时（${id}），继续按已停处理`)
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
          const r = await withTimeout(Promise.resolve(entry.backend.stop()), this.stopTimeoutMs)
          if (!r.ok) console.error(`GTools backend 停止超时（${entry.manifest.id}），退出继续`)
        } catch {
          // 退出阶段尽力而为
        }
        entry.backendStarted = false
      }
      if (entry.backend?.dispose) {
        try {
          const r = await withTimeout(Promise.resolve(entry.backend.dispose()), this.stopTimeoutMs)
          if (!r.ok) console.error(`GTools backend dispose 超时（${entry.manifest.id}），退出继续`)
        } catch {
          // 同上
        }
      }
    }
  }
}
