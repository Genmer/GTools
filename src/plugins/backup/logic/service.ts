import type { AppSettings } from '@sdk/settings'
import {
  canonicalJson,
  defaultBackupFileName,
  normalizeSettings,
  restorePathTokens,
  serializeBackup,
  tokenizePathValues,
  type BackupFile,
  type PathTokenRoots
} from './format'
import type { BackupEnvInfo } from './datadir'

// 宿主 userData 布局（src/main/settings-store.ts 与 services/）：
// <userData>/settings.json + <userData>/storage/<pluginId>/kv.json + <userData>/api-services.json。内置受信插件按此读取/写回。
export const SETTINGS_FILE = 'settings.json'
export const STORAGE_DIR = 'storage'
export const KV_FILE = 'kv.json'
export const API_SERVICES_FILE = 'api-services.json'
export const SAFETY_DIR = 'backups'
export const SAFETY_PREFIX = 'pre-import-'
export const SAFETY_KEEP = 5

/** 宿主能力的最小注入面（渲染层用 ctx.host 实现，测试用内存 fake） */
export interface BackupPort {
  /** 打开目录选择对话框（选中即授权），取消返回 null */
  pickDirectory(title: string, defaultPath?: string): Promise<string | null>
  pickBackupFile(title: string): Promise<string | null>
  pickSavePath(defaultPath: string): Promise<string | null>
  stat(path: string): Promise<{ exists: boolean; isDirectory: boolean } | null>
  list(dir: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>>
  read(path: string): Promise<string>
  write(path: string, data: string, opts?: { createDir?: boolean }): Promise<void>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
}

export interface CurrentState {
  settings: AppSettings
  pluginStorage: Record<string, Record<string, unknown>>
  /** 全局 API 服务配置（api-services.json 原文解析结果，读不到为 undefined；插件不解析内部结构） */
  apiServices?: Record<string, unknown>
  /** 本地是否一件数据都没有（全新安装），此时导入跳过防覆盖备份 */
  isEmpty: boolean
  warnings: string[]
}

export class NotDataDirError extends Error {
  constructor(public readonly hint: string) {
    super(hint)
  }
}

function joinPath(sep: string, base: string, ...parts: string[]): string {
  let p = base.endsWith(sep) ? base : base + sep
  for (const part of parts) p += part + sep
  return p.slice(0, -sep.length)
}

export function tokenRoots(env: BackupEnvInfo, dataDir: string): PathTokenRoots {
  return { userData: dataDir, home: env.home, caseInsensitive: env.caseInsensitive, sep: env.sep }
}

/**
 * 读取数据目录当前状态。目录里既无 settings.json 又无 storage/ 视为空目录：
 * 导出方向直接报错（没有东西可导）；导入方向（allowEmpty）允许，按全新环境处理
 * （全新安装的机器 userData 内可能还什么都没写）。
 */
export async function collectCurrentState(
  port: BackupPort,
  env: BackupEnvInfo,
  dataDir: string,
  opts: { allowEmpty?: boolean } = {}
): Promise<CurrentState> {
  const sep = env.sep
  const warnings: string[] = []
  const settingsPath = joinPath(sep, dataDir, SETTINGS_FILE)
  const storageDir = joinPath(sep, dataDir, STORAGE_DIR)

  const settingsStat = await port.stat(settingsPath)
  const storageStat = await port.stat(storageDir)
  if ((settingsStat?.exists ?? false) === false && (storageStat?.exists ?? false) === false) {
    if (!opts.allowEmpty) {
      throw new NotDataDirError(
        `所选目录不像 GTools 数据目录（未找到 ${SETTINGS_FILE} 或 ${STORAGE_DIR}${sep} 子目录），请选择本机 GTools 的数据目录`
      )
    }
    warnings.push('目标目录当前没有数据，将按全新环境导入')
  }

  let settings: AppSettings | null = null
  if (settingsStat?.exists) {
    try {
      settings = normalizeSettings(JSON.parse(await port.read(settingsPath)))
    } catch {
      warnings.push('settings.json 解析失败，按默认设置处理')
    }
  }

  const pluginStorage: Record<string, Record<string, unknown>> = {}
  if (storageStat?.exists && storageStat.isDirectory) {
    for (const ent of await port.list(storageDir)) {
      if (!ent.isDirectory) continue
      const kvPath = joinPath(sep, ent.path, KV_FILE)
      const kvStat = await port.stat(kvPath)
      if (kvStat?.exists !== true) continue
      try {
        const kv = JSON.parse(await port.read(kvPath)) as Record<string, unknown>
        if (typeof kv === 'object' && kv !== null && !Array.isArray(kv) && Object.keys(kv).length > 0) {
          pluginStorage[ent.name] = kv
        }
      } catch {
        warnings.push(`插件 ${ent.name} 的 ${KV_FILE} 解析失败，已跳过`)
      }
    }
  }

  let apiServices: Record<string, unknown> | undefined
  const apiStat = await port.stat(joinPath(sep, dataDir, API_SERVICES_FILE))
  if (apiStat?.exists) {
    try {
      const parsed = JSON.parse(await port.read(joinPath(sep, dataDir, API_SERVICES_FILE))) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        apiServices = parsed as Record<string, unknown>
      }
    } catch {
      warnings.push(`${API_SERVICES_FILE} 解析失败，已跳过`)
    }
  }

  const settingsFound = settings !== null
  return {
    settings: settings ?? normalizeSettings(null),
    pluginStorage,
    apiServices,
    isEmpty: !settingsFound && Object.keys(pluginStorage).length === 0,
    warnings
  }
}

export interface ExportResult {
  status: 'done' | 'canceled'
  path?: string
  backup?: BackupFile
  bytes?: number
  warnings: string[]
}

/** 导出：收集 → 打包 → 路径 token 化 → 用户选保存位置 → 写盘 */
export async function exportToFile(
  port: BackupPort,
  env: BackupEnvInfo,
  dataDir: string,
  current: CurrentState,
  appVersion: string,
  now = new Date()
): Promise<ExportResult> {
  const backup = serializeBackup({
    settings: current.settings,
    pluginStorage: current.pluginStorage,
    platform: env.platform,
    appVersion,
    now,
    apiServices: current.apiServices
  })
  const tokenized = tokenizePathValues(backup, tokenRoots(env, dataDir))
  const target = await port.pickSavePath(defaultBackupFileName(now))
  if (target === null) return { status: 'canceled', warnings: [] }
  const content = JSON.stringify(tokenized, null, 2)
  await port.write(target, content, { createDir: true })
  return { status: 'done', path: target, backup, bytes: content.length, warnings: current.warnings }
}

export interface ImportWriteResult {
  safetyBackupPath: string | null
  wroteSettings: boolean
  writtenPlugins: string[]
  restartRecommended: boolean
}

function safetyFileName(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    SAFETY_PREFIX +
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.gtools`
  )
}

/** 只保留最近 SAFETY_KEEP 份导入前快照，防止 backups/ 无限膨胀 */
async function pruneSafetyBackups(port: BackupPort, safetyDir: string): Promise<void> {
  const stat = await port.stat(safetyDir)
  if (stat?.exists !== true) return
  const files = (await port.list(safetyDir))
    .filter((e) => !e.isDirectory && /^pre-import-\d{8}-\d{6}\.gtools$/.test(e.name))
    .sort((a, b) => b.name.localeCompare(a.name))
  for (const old of files.slice(SAFETY_KEEP)) {
    await port.remove(old.path)
  }
}

/**
 * 确认导入后的执行：先把当前数据快照写进 <数据目录>/backups/（防误覆盖），再写回
 * settings.json 与有变化的 kv.json。运行中的宿主不会自动感知文件变化，必须重启。
 */
export async function executeImport(
  port: BackupPort,
  env: BackupEnvInfo,
  dataDir: string,
  backup: BackupFile,
  current: CurrentState,
  opts: { now?: Date; appVersion?: string } = {}
): Promise<ImportWriteResult> {
  const now = opts.now ?? new Date()
  const sep = env.sep
  const restored = restorePathTokens(backup, tokenRoots(env, dataDir))
  const roots = tokenRoots(env, dataDir)

  let safetyBackupPath: string | null = null
  if (!current.isEmpty) {
    const safetyDir = joinPath(sep, dataDir, SAFETY_DIR)
    await port.mkdir(safetyDir)
    safetyBackupPath = joinPath(sep, safetyDir, safetyFileName(now))
    const snapshot = serializeBackup({
      settings: current.settings,
      pluginStorage: current.pluginStorage,
      platform: env.platform,
      appVersion: opts.appVersion ?? 'unknown',
      now,
      apiServices: current.apiServices
    })
    await port.write(safetyBackupPath, JSON.stringify(tokenizePathValues(snapshot, roots), null, 2))
    await pruneSafetyBackups(port, safetyDir)
  }

  let wroteSettings = false
  if (canonicalJson(current.settings) !== canonicalJson(restored.settings)) {
    await port.write(joinPath(sep, dataDir, SETTINGS_FILE), JSON.stringify(restored.settings, null, 2))
    wroteSettings = true
  }

  // v2 段：备份带 apiServices 才写回（v1 备份不动本机现状）；运行中的宿主不感知，须重启生效
  if (restored.apiServices !== undefined) {
    await port.write(joinPath(sep, dataDir, API_SERVICES_FILE), JSON.stringify(restored.apiServices, null, 2))
  }

  const writtenPlugins: string[] = []
  for (const [pid, kv] of Object.entries(restored.pluginStorage)) {
    const local = current.pluginStorage[pid]
    if (local !== undefined && canonicalJson(local) === canonicalJson(kv)) continue
    await port.write(joinPath(sep, dataDir, STORAGE_DIR, pid, KV_FILE), JSON.stringify(kv), { createDir: true })
    writtenPlugins.push(pid)
  }

  return { safetyBackupPath, wroteSettings, writtenPlugins, restartRecommended: true }
}
