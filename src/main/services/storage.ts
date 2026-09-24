import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * 插件 KV 存储：userData/storage/<pluginId>/kv.json，物理目录按插件隔离。
 * 写入走 tmp→rename 原子替换，避免进程被杀时半截 JSON。
 */
export class PluginStorageService {
  constructor(private readonly rootDir: string) {}

  private dirFor(pluginId: string): string {
    return join(this.rootDir, pluginId)
  }
  private fileFor(pluginId: string): string {
    return join(this.dirFor(pluginId), 'kv.json')
  }

  private async readAll(pluginId: string): Promise<Record<string, unknown>> {
    try {
      const raw = await readFile(this.fileFor(pluginId), { encoding: 'utf-8' })
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  private async writeAll(pluginId: string, data: Record<string, unknown>): Promise<void> {
    const dir = this.dirFor(pluginId)
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, 'kv.json.tmp')
    await writeFile(tmp, JSON.stringify(data), { encoding: 'utf-8' })
    await rename(tmp, this.fileFor(pluginId))
  }

  async get(pluginId: string, key: string): Promise<unknown> {
    return (await this.readAll(pluginId))[key] ?? null
  }

  async set(pluginId: string, key: string, value: unknown): Promise<void> {
    const all = await this.readAll(pluginId)
    all[key] = value
    await this.writeAll(pluginId, all)
  }

  async remove(pluginId: string, key: string): Promise<void> {
    const all = await this.readAll(pluginId)
    delete all[key]
    await this.writeAll(pluginId, all)
  }

  async keys(pluginId: string): Promise<string[]> {
    return Object.keys(await this.readAll(pluginId))
  }

  /** 备份导出用：读取全部插件的 KV 快照（空命名空间跳过） */
  async dumpAll(): Promise<Record<string, Record<string, unknown>>> {
    const out: Record<string, Record<string, unknown>> = {}
    let dirs: Array<{ name: string; isDirectory(): boolean }> = []
    try {
      dirs = await readdir(this.rootDir, { withFileTypes: true })
    } catch {
      return out // 根目录不存在 = 无任何插件数据
    }
    for (const ent of dirs) {
      if (!ent.isDirectory()) continue
      const kv = await this.readAll(ent.name)
      if (Object.keys(kv).length > 0) out[ent.name] = kv
    }
    return out
  }

  /** 备份导入用：整体替换某插件的 KV（传 {} 即清空该插件数据） */
  async replaceAll(pluginId: string, kv: Record<string, unknown>): Promise<void> {
    await this.writeAll(pluginId, kv)
  }
}
