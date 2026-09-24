import { DEFAULT_SETTINGS, type AppSettings } from '@sdk/settings'
import { validateAccelerator } from '@sdk/shortcut-rules'

// 与宿主备份（src/main/services/backup.ts）同格式的独立实现：插件层不允许 import 宿主代码，
// 两边格式必须保持一致（format/version/token 约定），宿主导出的 *.json 与本插件导出的 *.gtools 可互换导入。
export const BACKUP_FORMAT = 'gtools-backup'
export const BACKUP_VERSION = 2
export const MAX_BACKUP_BYTES = 64 * 1024 * 1024
export const USER_DATA_TOKEN = '${userData}'
export const HOME_TOKEN = '${home}'

/** v2 起的可选顶层段：全局 API 服务配置（含密钥）。插件层不解析其内部结构，原样搬运 */
export interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  createdAt: string
  sourcePlatform: string
  appVersion: string
  settings: AppSettings
  pluginStorage: Record<string, Record<string, unknown>>
  apiServices?: Record<string, unknown>
}

export interface PathTokenRoots {
  userData: string
  home: string
  /** win/mac 文件系统大小写不敏感 */
  caseInsensitive?: boolean
  /** 还原时拼接用的分隔符（导出统一归一为 '/'） */
  sep?: string
}

export function defaultBackupFileName(now = new Date(), ext = '.gtools'): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `gtools-backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}${ext}`
}

function startsWithPath(s: string, root: string, ci: boolean): boolean {
  if (root === '') return false
  const a = ci ? s.toLowerCase() : s
  const b = ci ? root.toLowerCase() : root
  return a === b || a.startsWith(b + '/') || a.startsWith(b + '\\')
}

function tokenizeString(s: string, roots: PathTokenRoots): string {
  const ci = roots.caseInsensitive ?? false
  // userData 通常在 home 之下，必须先匹配更长的 userData
  if (startsWithPath(s, roots.userData, ci)) {
    return USER_DATA_TOKEN + '/' + s.slice(roots.userData.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
  }
  if (startsWithPath(s, roots.home, ci)) {
    return HOME_TOKEN + '/' + s.slice(roots.home.length).replace(/^[\\/]+/, '').replace(/\\/g, '/')
  }
  return s
}

/** 深遍历把 userData/home 前缀的绝对路径替换为 token（导出方向）；其余字符串原样保留 */
export function tokenizePathValues<T>(value: T, roots: PathTokenRoots): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return tokenizeString(v, roots)
    if (Array.isArray(v)) return v.map(walk)
    if (typeof v === 'object' && v !== null) {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v)) out[k] = walk(val)
      return out
    }
    return v
  }
  return walk(value) as T
}

/** 还原方向：token 前缀替换为当前平台路径（分隔符按 sep 转换） */
export function restorePathTokens<T>(value: T, roots: PathTokenRoots): T {
  const sep = roots.sep ?? '/'
  const expand = (s: string): string => {
    if (s.startsWith(USER_DATA_TOKEN + '/')) {
      return joinRoot(roots.userData, s.slice(USER_DATA_TOKEN.length + 1), sep)
    }
    if (s.startsWith(HOME_TOKEN + '/')) {
      return joinRoot(roots.home, s.slice(HOME_TOKEN.length + 1), sep)
    }
    return s
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return expand(v)
    if (Array.isArray(v)) return v.map(walk)
    if (typeof v === 'object' && v !== null) {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v)) out[k] = walk(val)
      return out
    }
    return v
  }
  return walk(value) as T
}

function joinRoot(root: string, rest: string, sep: string): string {
  const normalized = rest.replace(/\//g, sep)
  return root.endsWith(sep) ? root + normalized : root + sep + normalized
}

export interface SerializeBackupInput {
  settings: AppSettings
  pluginStorage: Record<string, Record<string, unknown>>
  platform: string
  appVersion: string
  now?: Date
  apiServices?: Record<string, unknown>
}

export function serializeBackup(input: SerializeBackupInput): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: (input.now ?? new Date()).toISOString(),
    sourcePlatform: input.platform,
    appVersion: input.appVersion,
    settings: structuredClone(input.settings),
    pluginStorage: structuredClone(input.pluginStorage),
    apiServices: structuredClone(input.apiServices)
  }
}

/** 与宿主 SettingsStore 同语义的宽松规整：文件可能来自旧版本或手改，坏值回退默认 */
export function normalizeSettings(raw: unknown): AppSettings {
  const out: AppSettings = structuredClone(DEFAULT_SETTINGS)
  if (typeof raw !== 'object' || raw === null) return out
  const r = raw as Record<string, unknown>
  if (typeof r.hotkey === 'object' && r.hotkey !== null) {
    const h = r.hotkey as Record<string, unknown>
    if (typeof h.darwin === 'string' && validateAccelerator(h.darwin, 'darwin').ok) out.hotkey.darwin = h.darwin
    if (typeof h.win32 === 'string' && validateAccelerator(h.win32, 'win32').ok) out.hotkey.win32 = h.win32
  }
  if (r.theme === 'light' || r.theme === 'dark' || r.theme === 'glass') out.theme = r.theme
  if (Array.isArray(r.disabledPlugins) && r.disabledPlugins.every((x) => typeof x === 'string')) {
    out.disabledPlugins = r.disabledPlugins as string[]
  }
  return out
}

export type ParsedBackup =
  | { ok: true; backup: BackupFile; warnings: string[] }
  | { ok: false; error: string }

/**
 * 与宿主 parseBackup 的差异：插件层拿不到插件注册表，未知插件的数据不丢弃而是原样保留
 * （落盘为休眠数据目录，装上该插件后即可用），仅在 warnings 里提示。
 */
export function parseBackup(raw: string, opts?: { maxBytes?: number }): ParsedBackup {
  const maxBytes = opts?.maxBytes ?? MAX_BACKUP_BYTES
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, error: '备份文件为空' }
  if (raw.length > maxBytes) return { ok: false, error: `备份文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限` }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: '备份文件不是合法 JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: '备份内容不是对象' }
  const b = parsed as Record<string, unknown>

  if (b.format !== BACKUP_FORMAT) return { ok: false, error: `不是 GTools 备份文件（format: ${String(b.format)}）` }
  if (typeof b.version !== 'number' || !Number.isInteger(b.version) || b.version < 1) {
    return { ok: false, error: `备份版本非法：${String(b.version)}` }
  }
  if (b.version > BACKUP_VERSION) {
    return { ok: false, error: `备份来自更高版本（v${b.version}），当前应用仅支持 v${BACKUP_VERSION}，请先升级应用` }
  }
  if (typeof b.settings !== 'object' || b.settings === null) return { ok: false, error: '备份缺少 settings' }
  if (typeof b.pluginStorage !== 'object' || b.pluginStorage === null || Array.isArray(b.pluginStorage)) {
    return { ok: false, error: '备份缺少 pluginStorage' }
  }

  const warnings: string[] = []
  const storage: Record<string, Record<string, unknown>> = {}
  for (const [pid, kv] of Object.entries(b.pluginStorage as Record<string, unknown>)) {
    if (typeof kv !== 'object' || kv === null || Array.isArray(kv)) {
      warnings.push(`插件 ${pid} 的数据结构异常，已跳过`)
      continue
    }
    if (Object.keys(kv).length === 0) continue
    storage[pid] = kv as Record<string, unknown>
  }

  // v2 段：v1 备份无 apiServices（导入时不写该文件，保留本机现状）；结构异常丢弃并告警
  let apiServices: Record<string, unknown> | undefined
  if (b.apiServices !== undefined) {
    if (typeof b.apiServices !== 'object' || b.apiServices === null || Array.isArray(b.apiServices)) {
      warnings.push('API 服务配置结构异常，已跳过')
    } else {
      apiServices = b.apiServices as Record<string, unknown>
    }
  }

  return {
    ok: true,
    backup: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: typeof b.createdAt === 'string' ? b.createdAt : '',
      sourcePlatform: typeof b.sourcePlatform === 'string' ? b.sourcePlatform : 'unknown',
      appVersion: typeof b.appVersion === 'string' ? b.appVersion : 'unknown',
      settings: normalizeSettings(b.settings),
      pluginStorage: storage,
      apiServices
    },
    warnings
  }
}

/** 键序无关的深比较串（判断「覆盖还是无变化」用） */
export function canonicalJson(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (typeof v === 'object' && v !== null) {
      const out: Record<string, unknown> = {}
      for (const k of Object.keys(v).sort()) out[k] = walk((v as Record<string, unknown>)[k])
      return out
    }
    return v
  }
  return JSON.stringify(walk(value))
}
