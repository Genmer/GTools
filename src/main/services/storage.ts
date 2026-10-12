import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 损坏留证文件名后缀：kv.json → kv.json.corrupt-20261006-093000 */
function corruptStamp(now = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/**
 * 插件 KV 存储：userData/storage/<pluginId>/kv.json，物理目录按插件隔离。
 * 内存缓存首读建立（get/keys 免盘读）；per-plugin 写操作经 Promise 链串行（读-改-写互不覆盖）；
 * 写入走 tmp→rename 原子替换，避免进程被杀时半截 JSON。
 */
export class PluginStorageService {
  private readonly cache = new Map<string, Record<string, unknown>>()
  /** 首读 single-flight：并发首读共享同一份缓存对象 */
  private readonly loads = new Map<string, Promise<Record<string, unknown>>>()
  private readonly writeQueues = new Map<string, Promise<void>>()

  constructor(private readonly rootDir: string) {}

  private dirFor(pluginId: string): string {
    return join(this.rootDir, pluginId)
  }
  private fileFor(pluginId: string): string {
    return join(this.dirFor(pluginId), 'kv.json')
  }

  private async readAll(pluginId: string): Promise<Record<string, unknown>> {
    const cached = this.cache.get(pluginId)
    if (cached) return cached
    let p = this.loads.get(pluginId)
    if (!p) {
      p = this.loadFromDisk(pluginId).finally(() => this.loads.delete(pluginId))
      this.loads.set(pluginId, p)
    }
    return p
  }

  private async loadFromDisk(pluginId: string): Promise<Record<string, unknown>> {
    const file = this.fileFor(pluginId)
    let raw: string
    try {
      raw = await readFile(file, { encoding: 'utf-8' })
    } catch {
      const empty: Record<string, unknown> = {}
      this.cache.set(pluginId, empty)
      return empty // 文件不存在按空数据
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined
    }
    // 本服务只写对象形态，解析失败/非对象都视为损坏：留证后再按空数据处理
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      const evidence = `${file}.corrupt-${corruptStamp()}`
      await rename(file, evidence).catch(() => {})
      console.error(`GTools 插件存储损坏（${pluginId}），已留证 ${evidence}`)
      const empty: Record<string, unknown> = {}
      this.cache.set(pluginId, empty)
      return empty
    }
    const data = parsed as Record<string, unknown>
    this.cache.set(pluginId, data)
    return data
  }

  private async writeAll(pluginId: string, data: Record<string, unknown>): Promise<void> {
    const dir = this.dirFor(pluginId)
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, 'kv.json.tmp')
    await writeFile(tmp, JSON.stringify(data), { encoding: 'utf-8' })
    await rename(tmp, this.fileFor(pluginId))
  }

  /** 同插件写操作排队执行，读-改-写不并发互踩 */
  private enqueueWrite(pluginId: string, op: () => Promise<void>): Promise<void> {
    const tail = this.writeQueues.get(pluginId) ?? Promise.resolve()
    const next = tail.then(op, op)
    // 队尾吞错：单次失败不传染后续操作，也不产生 unhandled rejection
    this.writeQueues.set(pluginId, next.then(() => undefined, () => undefined))
    return next
  }

  async get(pluginId: string, key: string): Promise<unknown> {
    return (await this.readAll(pluginId))[key] ?? null
  }

  async set(pluginId: string, key: string, value: unknown): Promise<void> {
    await this.enqueueWrite(pluginId, async () => {
      const all = await this.readAll(pluginId)
      all[key] = value
      await this.writeAll(pluginId, all)
    })
  }

  async remove(pluginId: string, key: string): Promise<void> {
    await this.enqueueWrite(pluginId, async () => {
      const all = await this.readAll(pluginId)
      delete all[key]
      await this.writeAll(pluginId, all)
    })
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
    await this.enqueueWrite(pluginId, async () => {
      this.cache.set(pluginId, kv)
      await this.writeAll(pluginId, kv)
    })
  }
}
