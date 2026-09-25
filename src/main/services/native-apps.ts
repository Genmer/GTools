import { basename, join } from 'node:path'

/**
 * 宿主「本机应用」服务：枚举 /Applications、~/Applications、/System/Applications 下的 .app，
 * 供 shell 空态应用栏（ui-style-guide §1.5）使用。electron/fs 全部构造注入（AGENTS 规范），
 * 图标解码依赖 nativeImage，由装配方注入 loadIcon，本模块只做纯逻辑。
 */

export interface NativeAppEntry {
  /** 置顶与去重的稳定键：bundleId，缺失回退 .app 路径 */
  id: string
  name: string
  /** .app 目录绝对路径（打开目标，shell.openPath 直接接受） */
  path: string
  bundleId?: string
  /** 解析出的 icns 绝对路径；不进落盘缓存，图标按会话内存缓存解码 */
  iconPath?: string
}

export interface NativeAppView extends NativeAppEntry {
  /** 64px dataURL；解码失败/无图标为 undefined，渲染层用字母块兜底 */
  icon?: string
}

export interface NativeAppsSnapshot {
  apps: NativeAppView[]
  scannedAt: number
  /** true = 未重扫（内存或磁盘缓存命中） */
  fromCache: boolean
  /** 全量置顶序：渲染层据此画角标与本地重排（apps 顺序与其一致） */
  pinned: string[]
}

export interface NativeAppsFs {
  readdir(dir: string, opts: { withFileTypes: true }): Promise<Array<{ name: string; isDirectory(): boolean }>>
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, data: string, opts: { encoding: 'utf-8' }): Promise<void>
  rename(from: string, to: string): Promise<void>
  mkdir(path: string, opts: { recursive: true }): Promise<unknown>
}

export interface NativeAppsDeps {
  platform: string
  homeDir: string
  userDataDir: string
  fs: NativeAppsFs
  /** electron shell.openPath：成功 resolve ''，否则错误串（UI 反馈依据） */
  openPath(p: string): Promise<string>
  /** 生产注入（nativeImage 解码 icns→PNG）；缺省时全部走字母块兜底 */
  loadIcon?(iconPath: string): Promise<string | undefined>
  now?(): number
  memoryTtlMs?: number
  diskTtlMs?: number
}

const DEFAULT_MEMORY_TTL_MS = 10 * 60 * 1000
const DEFAULT_DISK_TTL_MS = 24 * 60 * 60 * 1000

const PLIST_KEYS = ['CFBundleDisplayName', 'CFBundleName', 'CFBundleIconFile', 'CFBundleIdentifier'] as const

export interface PlistMeta {
  name?: string
  bundleId?: string
  iconFile?: string
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, g: string) => {
    if (g.startsWith('#x') || g.startsWith('#X')) return String.fromCodePoint(Number.parseInt(g.slice(2), 16))
    if (g.startsWith('#')) return String.fromCodePoint(Number.parseInt(g.slice(1), 10))
    return XML_ENTITIES[g] ?? m
  })
}

/** 从 XML plist 文本提取目标 key 的字符串值（DOCTYPE 头同样适用，正则不依赖声明） */
export function parseXmlPlistStrings(text: string, wanted: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of wanted) {
    const m = text.match(new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([\\s\\S]*?)</string>`))
    if (!m) continue
    const v = decodeXmlEntities(m[1]).trim()
    if (v !== '') out[key] = v
  }
  return out
}

/**
 * 二进制 plist（bplist00）顶层 dict 的字符串提取。只解析顶层 dict 的键值，
 * 数组/data 等值类型一律跳过——Info.plist 想要的四个 key 都是字符串，够用且无依赖。
 * 任何结构异常返回 null，由调用方回退目录名。
 */
export function parseBinaryPlistStrings(buf: Buffer, wanted: readonly string[]): Record<string, string> | null {
  try {
    if (buf.length < 40 || buf.toString('latin1', 0, 6) !== 'bplist') return null
    const tr = buf.subarray(buf.length - 32)
    const offsetSize = tr[6]
    const refSize = tr[7]
    const numObjects = Number(tr.readBigUInt64BE(8))
    const topIndex = Number(tr.readBigUInt64BE(16))
    const tableOff = Number(tr.readBigUInt64BE(24))
    if (offsetSize < 1 || offsetSize > 8 || refSize < 1 || refSize > 8 || numObjects < 1 || topIndex >= numObjects) {
      return null
    }

    const readUInt = (off: number, size: number): number => {
      if (size === 1) return buf.readUInt8(off)
      if (size === 2) return buf.readUInt16BE(off)
      if (size === 4) return buf.readUInt32BE(off)
      return Number(buf.readBigUInt64BE(off))
    }
    const readIntAt = (off: number): number => {
      const b = buf[off]
      if ((b & 0xf0) !== 0x10) throw new Error('期望 int 对象')
      return readUInt(off + 1, 1 << (b & 0x0f))
    }
    const readString = (ref: number): string | null => {
      const off = readUInt(tableOff + ref * offsetSize, offsetSize)
      const b = buf[off]
      const marker = b & 0xf0
      if (marker !== 0x50 && marker !== 0x60) return null
      let len = b & 0x0f
      let dataOff = off + 1
      if (len === 0x0f) {
        len = readIntAt(off + 1)
        dataOff = off + 2 + (1 << (buf[off + 1] & 0x0f))
      }
      if (marker === 0x50) return buf.toString('latin1', dataOff, dataOff + len)
      // 0x60：UTF-16BE，len 是码元数；Node 只认 LE，手工换字节序
      const be = buf.subarray(dataOff, dataOff + len * 2)
      const le = Buffer.from(be)
      for (let k = 0; k + 1 < le.length; k += 2) {
        const t = le[k]
        le[k] = le[k + 1]
        le[k + 1] = t
      }
      return le.toString('utf16le')
    }

    const topOff = readUInt(tableOff + topIndex * offsetSize, offsetSize)
    const tb = buf[topOff]
    if ((tb & 0xf0) !== 0xd0) return null // 顶层须为 dict（0xA0=数组 0xC0=set 0xD0=dict）
    let count = tb & 0x0f
    let refsOff = topOff + 1
    if (count === 0x0f) {
      count = readIntAt(topOff + 1)
      refsOff = topOff + 2 + (1 << (buf[topOff + 1] & 0x0f))
    }
    const wantedSet = new Set(wanted)
    const out: Record<string, string> = {}
    for (let k = 0; k < count; k++) {
      const key = readString(readUInt(refsOff + k * refSize, refSize))
      if (key === null || !wantedSet.has(key)) continue
      const val = readString(readUInt(refsOff + (count + k) * refSize, refSize))
      if (val !== null && val.trim() !== '') out[key] = val.trim()
    }
    return out
  } catch {
    return null
  }
}

export function parsePlistMeta(buf: Buffer): PlistMeta {
  const strings =
    buf.length >= 6 && buf.toString('latin1', 0, 6) === 'bplist'
      ? parseBinaryPlistStrings(buf, PLIST_KEYS)
      : parseXmlPlistStrings(buf.toString('utf8'), PLIST_KEYS)
  const s = strings ?? {}
  const name = s.CFBundleDisplayName || s.CFBundleName || ''
  return {
    name: name !== '' ? name : undefined,
    bundleId: s.CFBundleIdentifier || undefined,
    iconFile: s.CFBundleIconFile || undefined
  }
}

/** CFBundleIconFile 常不带扩展名（如 AppIcon），此时补 .icns；带扩展名按原样 */
export function resolveIconPath(appPath: string, iconFile: string): string {
  const hasExt = /\.[A-Za-z0-9]+$/.test(iconFile)
  return join(appPath, 'Contents', 'Resources', hasExt ? iconFile : `${iconFile}.icns`)
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47])

/**
 * 从 icns 容器抽出最合适的 PNG 条目：nativeImage 实测不认 icns 文件（createFromPath 恒 isEmpty），
 * 但 ic07..ic14/icp4..6 条目负载就是完整 PNG，可直接喂 createFromBuffer。
 * 选取规则：实际宽度（IHDR 第 16 偏移）≥ target 的最小者，没有则取最大者；老式 ARGB 条目不支持的返回 null。
 */
export function extractIcnsPngForSize(buf: Buffer, target: number): Buffer | null {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'icns') return null
  let best: { w: number; data: Buffer } | null = null
  let largest: { w: number; data: Buffer } | null = null
  let off = 8
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off + 4)
    if (len < 8 || off + len > buf.length) break
    const data = buf.subarray(off + 8, off + len)
    if (data.length >= 24 && data.subarray(0, 4).equals(PNG_SIG)) {
      const w = data.readUInt32BE(16)
      if (w > 0) {
        const entry = { w, data: Buffer.from(data) }
        if (largest === null || w > largest.w) largest = entry
        if (w >= target && (best === null || w < best.w)) best = entry
      }
    }
    off += len
  }
  return (best ?? largest)?.data ?? null
}

/** 输出排序：置顶按置顶顺序排最前，其余按名称（中文locale）再路径；未知置顶 id 忽略 */
export function orderApps<T extends NativeAppEntry>(apps: T[], pinnedIds: readonly string[]): T[] {
  const rank = new Map(pinnedIds.map((id, i) => [id, i]))
  return [...apps].sort((a, b) => {
    const pa = rank.get(a.id)
    const pb = rank.get(b.id)
    if (pa !== undefined && pb === undefined) return -1
    if (pa === undefined && pb !== undefined) return 1
    if (pa !== undefined && pb !== undefined) return pa - pb
    return a.name.localeCompare(b.name, 'zh-Hans-CN') || a.path.localeCompare(b.path)
  })
}

/** 置顶列表落盘形状校验：只留非空字符串并去重（文件可能被手改坏） */
export function sanitizePinnedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const x of raw) {
    if (typeof x === 'string' && x !== '' && !seen.has(x)) seen.add(x)
  }
  return [...seen]
}

export interface NativeAppsCacheFile {
  version: 1
  scannedAt: number
  apps: NativeAppEntry[]
}

/** 磁盘缓存读回校验，坏形状返回 null（触发重扫） */
export function parseNativeAppsCache(raw: unknown): NativeAppsCacheFile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const c = raw as { version?: unknown; scannedAt?: unknown; apps?: unknown }
  if (c.version !== 1 || typeof c.scannedAt !== 'number' || !Number.isFinite(c.scannedAt) || !Array.isArray(c.apps)) {
    return null
  }
  const apps: NativeAppEntry[] = []
  for (const a of c.apps) {
    if (typeof a !== 'object' || a === null) continue
    const e = a as Record<string, unknown>
    if (typeof e.id !== 'string' || e.id === '') continue
    if (typeof e.name !== 'string' || e.name === '' || typeof e.path !== 'string' || e.path === '') continue
    apps.push({
      id: e.id,
      name: e.name,
      path: e.path,
      bundleId: typeof e.bundleId === 'string' && e.bundleId !== '' ? e.bundleId : undefined,
      iconPath: typeof e.iconPath === 'string' && e.iconPath !== '' ? e.iconPath : undefined
    })
  }
  return { version: 1, scannedAt: c.scannedAt, apps }
}



export class NativeAppsService {
  private memory: NativeAppsCacheFile | null = null
  /** dataURL 会话缓存；undefined 为负缓存（已试过、无可用图标），防反复重解 */
  private readonly icons = new Map<string, string | undefined>()
  private pinned: string[] | null = null

  constructor(private readonly deps: NativeAppsDeps) {}

  private get now(): number {
    return this.deps.now?.() ?? Date.now()
  }
  private get cacheFile(): string {
    // v2：扫描目录集变更（默认排除系统应用），换名让旧缓存自然作废
    return join(this.deps.userDataDir, 'native-apps-cache.v2.json')
  }

  async list(opts: { refresh?: boolean } = {}): Promise<NativeAppsSnapshot> {
    const now = this.now
    if (!opts.refresh && this.memory && now - this.memory.scannedAt < (this.deps.memoryTtlMs ?? DEFAULT_MEMORY_TTL_MS)) {
      return this.snapshot(this.memory, true)
    }
    if (!opts.refresh) {
      const disk = await this.readDiskCache()
      if (disk && now - disk.scannedAt < (this.deps.diskTtlMs ?? DEFAULT_DISK_TTL_MS)) {
        this.memory = disk
        return this.snapshot(disk, true)
      }
    }
    const apps = await this.scan()
    this.memory = { version: 1, scannedAt: now, apps }
    // 落盘只存元数据（icon dataURL 太大），失败不影响本次结果
    try {
      await this.deps.fs.mkdir(this.deps.userDataDir, { recursive: true })
      await this.deps.fs.writeFile(`${this.cacheFile}.tmp`, JSON.stringify(this.memory), { encoding: 'utf-8' })
      await this.deps.fs.rename(`${this.cacheFile}.tmp`, this.cacheFile)
    } catch {
      // 缓存写失败（只读目录等）：下次再试
    }
    return this.snapshot(this.memory, false)
  }

  /** 打开应用：路径须为 .app；结果回传 UI 反馈 */
  async open(path: string): Promise<{ ok: boolean; error?: string }> {
    if (!path.endsWith('.app')) return { ok: false, error: `仅接受 .app 路径：${path}` }
    const err = await this.deps.openPath(path)
    return err === '' ? { ok: true } : { ok: false, error: err }
  }

  async pinnedIds(): Promise<string[]> {
    await this.ensurePins()
    return [...(this.pinned ?? [])]
  }

  async pin(id: string): Promise<string[]> {
    await this.ensurePins()
    if (!this.pinned!.includes(id)) this.pinned!.push(id)
    await this.persistPins()
    return [...this.pinned!]
  }

  async unpin(id: string): Promise<string[]> {
    await this.ensurePins()
    this.pinned = this.pinned!.filter((x) => x !== id)
    await this.persistPins()
    return [...this.pinned]
  }

  private async ensurePins(): Promise<void> {
    if (this.pinned !== null) return
    let ids: string[] = []
    try {
      const raw = await this.deps.fs.readFile(this.pinsFile)
      ids = sanitizePinnedIds(JSON.parse(raw.toString('utf8')).pinned)
    } catch {
      // 无文件/坏 JSON：空列表起步
    }
    this.pinned = ids
  }

  private get pinsFile(): string {
    return join(this.deps.userDataDir, 'pinned-apps.json')
  }

  private async persistPins(): Promise<void> {
    await this.deps.fs.mkdir(this.deps.userDataDir, { recursive: true })
    await this.deps.fs.writeFile(`${this.pinsFile}.tmp`, JSON.stringify({ version: 1, pinned: this.pinned }), {
      encoding: 'utf-8'
    })
    await this.deps.fs.rename(`${this.pinsFile}.tmp`, this.pinsFile)
  }

  private async readDiskCache(): Promise<NativeAppsCacheFile | null> {
    try {
      return parseNativeAppsCache(JSON.parse((await this.deps.fs.readFile(this.cacheFile)).toString('utf8')))
    } catch {
      return null
    }
  }

  private async snapshot(c: NativeAppsCacheFile, fromCache: boolean): Promise<NativeAppsSnapshot> {
    const pinned = await this.pinnedIds()
    const apps = orderApps(c.apps, pinned)
    const views: NativeAppView[] = []
    for (const a of apps) {
      const icon = await this.iconOf(a)
      views.push(icon === undefined ? { ...a } : { ...a, icon })
    }
    return { apps: views, scannedAt: c.scannedAt, fromCache, pinned }
  }

  private async iconOf(app: NativeAppEntry): Promise<string | undefined> {
    if (this.icons.has(app.id)) return this.icons.get(app.id)
    let url: string | undefined
    if (app.iconPath && this.deps.loadIcon) {
      try {
        url = await this.deps.loadIcon(app.iconPath)
      } catch {
        url = undefined
      }
    }
    this.icons.set(app.id, url)
    return url
  }

  private async scan(): Promise<NativeAppEntry[]> {
    if (this.deps.platform === 'win32') {
      const out = new Map<string, NativeAppEntry>()
      for (const root of this.win32Roots()) {
        await this.collectWin32Lnk(root, out)
      }
      return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') || a.path.localeCompare(b.path))
    }
    if (this.deps.platform !== 'darwin') return []
    const out = new Map<string, NativeAppEntry>()
    // 默认只扫用户自装应用（系统自带应用图标风格杂、稀释常用密度），两处皆空才兜底系统目录
    for (const root of this.darwinRoots()) await this.collect(root, out)
    if (out.size === 0) await this.collect('/System/Applications', out)
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN') || a.path.localeCompare(b.path))
  }

  private win32Roots(): string[] {
    const roots: string[] = []
    if (this.deps.homeDir) {
      roots.push(join(this.deps.homeDir, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
    }
    const programData = process.env.ProgramData || 'C:\\ProgramData'
    roots.push(join(programData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
    return roots
  }

  private async collectWin32Lnk(dir: string, out: Map<string, NativeAppEntry>, depth = 0): Promise<void> {
    if (depth > 4) return
    let entries
    try {
      entries = await this.deps.fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const fullPath = join(dir, ent.name)
      if (ent.isDirectory()) {
        await this.collectWin32Lnk(fullPath, out, depth + 1)
      } else if (ent.name.toLowerCase().endsWith('.lnk')) {
        const baseName = ent.name.slice(0, -'.lnk'.length).trim()
        if (!baseName) continue
        const lower = baseName.toLowerCase()
        if (lower.includes('uninstall') || lower.includes('卸载') || lower.includes('readme') || lower.includes('help')) continue
        const id = `win32:${lower}`
        if (!out.has(id)) {
          out.set(id, {
            id,
            name: baseName,
            path: fullPath,
            iconPath: fullPath
          })
        }
      }
    }
  }

  private darwinRoots(): string[] {
    return ['/Applications', join(this.deps.homeDir, 'Applications')]
  }

  private async collect(root: string, out: Map<string, NativeAppEntry>): Promise<void> {
    let level1
    try {
      level1 = await this.deps.fs.readdir(root, { withFileTypes: true })
    } catch {
      return // 根目录不存在/不可读视为空
    }
    for (const ent of level1) {
      if (!ent.isDirectory()) continue
      if (ent.name.endsWith('.app')) {
        await this.addApp(root, ent.name, out)
        continue
      }
      // 深度 2：/Applications/Utilities/Terminal.app 这类分组目录，再深不扫
      const sub = join(root, ent.name)
      let level2
      try {
        level2 = await this.deps.fs.readdir(sub, { withFileTypes: true })
      } catch {
        continue
      }
      for (const ent2 of level2) {
        if (ent2.isDirectory() && ent2.name.endsWith('.app')) await this.addApp(sub, ent2.name, out)
      }
    }
  }

  private async addApp(dir: string, appDirName: string, out: Map<string, NativeAppEntry>): Promise<void> {
    const appPath = join(dir, appDirName)
    let meta: PlistMeta = {}
    try {
      meta = parsePlistMeta(await this.deps.fs.readFile(join(appPath, 'Contents', 'Info.plist')))
    } catch {
      // 无 Info.plist 或读取失败 → 目录名兜底
    }
    const name = meta.name ?? basename(appPath).replace(/\.app$/i, '')
    if (name === '') return
    const id = meta.bundleId ?? appPath
    // 同 bundleId 出现在多个根目录（如 /Applications 与 ~/Applications）时留先扫到的
    if (out.has(id)) return
    out.set(id, {
      id,
      name,
      path: appPath,
      bundleId: meta.bundleId,
      iconPath: meta.iconFile ? resolveIconPath(appPath, meta.iconFile) : undefined
    })
  }
}
