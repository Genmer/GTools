/** 应用启动器插件内外共享的数据形态与纯函数（不得 import node:*：web tsconfig 程序会收走本目录 .ts 且无 node 类型） */

export interface AppEntry {
  name: string
  path: string
}

export interface AppsCache {
  version: 1
  scannedAt: number
  apps: AppEntry[]
}

export const CACHE_STALE_MS = 24 * 60 * 60 * 1000

export function isCacheStale(cache: AppsCache | null, now: number): boolean {
  if (cache === null) return true
  return now - cache.scannedAt > CACHE_STALE_MS
}

/** 存储读回的未知数据校验为缓存形态，坏形状返回 null（不抛异常） */
export function parseCache(raw: unknown): AppsCache | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as { version?: unknown; scannedAt?: unknown; apps?: unknown }
  if (c.version !== 1 || typeof c.scannedAt !== 'number' || !Number.isFinite(c.scannedAt) || !Array.isArray(c.apps)) {
    return null
  }
  const apps: AppEntry[] = []
  for (const a of c.apps) {
    if (typeof a !== 'object' || a === null) continue
    const { name, path } = a as { name?: unknown; path?: unknown }
    if (typeof name === 'string' && name !== '' && typeof path === 'string' && path !== '') {
      apps.push({ name, path })
    }
  }
  return { version: 1, scannedAt: c.scannedAt, apps }
}

/** 按首段自带分隔符拼接路径（darwin '/'、win32 '\\'），空段与尾斜杠忽略 */
export function joinPath(...parts: string[]): string {
  const norm = parts.map((p) => p.replace(/[\\/]+$/, '')).filter((p) => p !== '')
  if (norm.length === 0) return ''
  const sep = norm[0].includes('\\') && !norm[0].includes('/') ? '\\' : '/'
  return norm.join(sep)
}

export interface DirentLike {
  name: string
  isDirectory(): boolean
}

export interface FsLike {
  readdir(dir: string): Promise<DirentLike[]>
  readFile(path: string): Promise<string>
}

export interface ExecLike {
  execFile(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }>
}

export interface ScanDeps {
  platform: string
  homeDir: string
  env: Record<string, string | undefined>
  fs: FsLike
  exec?: ExecLike
  /** 测试注入：覆盖默认扫描根目录，保证用例不触真实磁盘 */
  darwinRoots?: string[]
  win32Roots?: string[]
}
