import { dirname, isAbsolute, resolve, sep as platformSep } from 'node:path'
import type { FsEntry, FsListOptions, FsReadOptions, FsStatResult, FsWriteOptions } from '@sdk/api'

/** node:fs/promises 的可注入子集（主进程注入真实现，测试传 fake） */
export interface FileAccessFs {
  readFile(path: string, opts: { encoding: 'utf-8' }): Promise<string>
  readFile(path: string, opts?: Record<string, never>): Promise<Buffer>
  writeFile(path: string, data: string | Buffer, opts?: { encoding?: string; flag?: string }): Promise<void>
  rename(from: string, to: string): Promise<void>
  rm(path: string, opts?: { recursive?: boolean; force?: boolean }): Promise<void>
  stat(path: string): Promise<{ isFile(): boolean; isDirectory(): boolean; size: number; mtimeMs: number }>
  readdir(path: string, opts: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean }>>
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>
  realpath(path: string): Promise<string>
}

/** 授权判定的纯逻辑：按插件记录授权根，路径必须落在根内才可访问 */
export class PathGuard {
  /** 路径拼接/边界判定所用分隔符（导出供服务层拼接保持一致） */
  readonly sep: string
  private readonly roots = new Map<string, string[]>()

  constructor(
    sep: string = platformSep,
    private readonly caseInsensitive = process.platform !== 'linux'
  ) {
    this.sep = sep
  }

  private norm(p: string): string {
    return this.caseInsensitive ? p.toLowerCase() : p
  }

  private covers(root: string, p: string): boolean {
    const r = this.norm(root)
    const t = this.norm(p)
    return t === r || t.startsWith(r + this.sep)
  }

  grant(pluginId: string, resolvedPaths: string[]): void {
    const list = this.roots.get(pluginId) ?? []
    for (const p of resolvedPaths) {
      if (!list.some((x) => this.norm(x) === this.norm(p))) list.push(p)
    }
    this.roots.set(pluginId, list)
  }

  grantedRoots(pluginId: string): readonly string[] {
    return this.roots.get(pluginId) ?? []
  }

  canAccess(pluginId: string, p: string): boolean {
    return this.grantedRoots(pluginId).some((root) => this.covers(root, p))
  }

  /**
   * rename 规则：from 必须已授权，且 to 与 from 同目录（批量重命名场景）
   * 或 to 本身/其父目录已授权（移动进已授权目录场景）。
   */
  canRename(pluginId: string, from: string, to: string): boolean {
    if (!this.canAccess(pluginId, from)) return false
    if (dirname(from) === dirname(to)) return true
    return this.canAccess(pluginId, to) || this.canAccess(pluginId, dirname(to))
  }

  assert(pluginId: string, p: string): void {
    if (!this.canAccess(pluginId, p)) {
      throw new Error(`路径未授权：${p}（仅可访问对话框选择或拖拽注册的路径）`)
    }
  }

  assertRename(pluginId: string, from: string, to: string): void {
    if (!this.canRename(pluginId, from, to)) {
      throw new Error(`重命名目标未授权：${to}（须与源同目录，或目标目录已授权）`)
    }
  }
}

const MAX_LIST_ENTRIES = 5000

/**
 * 用户授权路径内的文件读写服务。授权来源只有两个：对话框选择（主进程自动授予）、
 * 渲染层拖拽后调 fs.grant 注册。授权即读写（含删除），边界文档见 DESIGN 附录 A。
 */
export class FileAccessService {
  readonly guard: PathGuard

  constructor(
    private readonly fs: FileAccessFs,
    guard?: PathGuard
  ) {
    this.guard = guard ?? new PathGuard()
  }

  async grant(pluginId: string, paths: string[]): Promise<void> {
    const resolved: string[] = []
    for (const p of paths) {
      if (typeof p !== 'string' || !isAbsolute(p)) throw new Error(`须为绝对路径：${String(p)}`)
      let rp: string
      try {
        rp = await this.fs.realpath(p)
      } catch {
        rp = p // 目标可能尚不存在（如 saveFile 的保存路径），按原路径授权
      }
      resolved.push(resolve(rp))
    }
    this.guard.grant(pluginId, resolved)
  }

  async read(pluginId: string, path: string, opts?: FsReadOptions): Promise<string> {
    const p = this.check(path)
    this.guard.assert(pluginId, p)
    if (opts?.encoding === 'base64') {
      const buf = await this.fs.readFile(p)
      return buf.toString('base64')
    }
    return this.fs.readFile(p, { encoding: 'utf-8' })
  }

  async write(pluginId: string, path: string, data: string, opts?: FsWriteOptions): Promise<void> {
    const p = this.check(path)
    this.guard.assert(pluginId, p)
    const buf = opts?.encoding === 'base64' ? Buffer.from(data, 'base64') : data
    if (opts?.createDir) await this.fs.mkdir(dirname(p), { recursive: true })
    await this.fs.writeFile(p, buf, opts?.append ? { flag: 'a' } : undefined)
  }

  async rename(pluginId: string, from: string, to: string): Promise<void> {
    const f = this.check(from)
    const t = this.check(to)
    this.guard.assertRename(pluginId, f, t)
    await this.fs.rename(f, t)
  }

  async remove(pluginId: string, path: string): Promise<void> {
    const p = this.check(path)
    this.guard.assert(pluginId, p)
    await this.fs.rm(p, { recursive: true, force: true })
  }

  async stat(pluginId: string, path: string): Promise<FsStatResult | null> {
    const p = this.check(path)
    this.guard.assert(pluginId, p)
    try {
      const s = await this.fs.stat(p)
      return {
        exists: true,
        isFile: s.isFile(),
        isDirectory: s.isDirectory(),
        size: s.size,
        mtimeMs: s.mtimeMs
      }
    } catch {
      return { exists: false, isFile: false, isDirectory: false, size: 0, mtimeMs: 0 }
    }
  }

  async list(pluginId: string, dir: string, opts?: FsListOptions): Promise<FsEntry[]> {
    const p = this.check(dir)
    this.guard.assert(pluginId, p)
    const out: FsEntry[] = []
    if (opts?.recursive) {
      // 广度优先 + 总量封顶，防止授权目录极大时撑爆渲染层
      let queue = [p]
      while (queue.length > 0 && out.length < MAX_LIST_ENTRIES) {
        const next: string[] = []
        for (const d of queue) {
          for (const e of await this.sortedDir(d)) {
            if (out.length >= MAX_LIST_ENTRIES) break
            const full = joinPath(d, e.name, this.guard.sep)
            const isDir = e.isDirectory()
            out.push({ name: e.name, path: full, isDirectory: isDir, size: isDir ? 0 : await this.sizeOf(full) })
            if (isDir) next.push(full)
          }
        }
        queue = next
      }
      return out
    }
    for (const e of await this.sortedDir(p)) {
      const full = joinPath(p, e.name, this.guard.sep)
      const isDir = e.isDirectory()
      out.push({ name: e.name, path: full, isDirectory: isDir, size: isDir ? 0 : await this.sizeOf(full) })
    }
    return out
  }

  async mkdir(pluginId: string, path: string): Promise<void> {
    const p = this.check(path)
    // 目标父目录须已授权（不允许在任意位置建目录）
    this.guard.assert(pluginId, dirname(p))
    await this.fs.mkdir(p, { recursive: true })
  }

  private async sizeOf(p: string): Promise<number> {
    try {
      return (await this.fs.stat(p)).size
    } catch {
      return 0
    }
  }

  private async sortedDir(d: string): Promise<Array<{ name: string; isDirectory(): boolean }>> {
    const entries = await this.fs.readdir(d, { withFileTypes: true })
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  }

  private check(path: string): string {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`须为绝对路径：${String(path)}`)
    return resolve(path)
  }
}

function joinPath(dir: string, name: string, sep: string): string {
  return dir.endsWith(sep) ? dir + name : dir + sep + name
}
