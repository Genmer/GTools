import { ipcMain, dialog as electronDialog, app } from 'electron'
import { homedir } from 'node:os'
import * as nodeFs from 'node:fs/promises'
import { dirname, join, sep as pathSep } from 'node:path'
import type { PluginManifest } from '@sdk/manifest'
import type { ApiCallResult } from '@sdk/api'
import type { PluginLoader } from '../plugin-loader'
import type { SettingsStore, AppSettings, ThemeName } from '../settings-store'
import type { ServiceBag } from './dispatch'
import { dispatchApi } from './dispatch'
import type { ApiCenterService, ProviderForm } from './api-center'
import type { NativeAppsService } from './native-apps'
import type { DetachedWindowManager } from '../detached-window-manager'
import {
  applyThemeToWindow,
  getSearchWindow,
  hideSearchWindow,
  restoreSearchWindowSize,
  setSearchWindowHeight,
  setSearchWindowResizable
} from '../window'
import { rebindHotkey } from '../shortcut'
import {
  defaultBackupFileName,
  parseBackup,
  restorePathTokens,
  serializeBackup,
  tokenizePathValues
} from './backup'

export interface HostInitResult {
  settings: AppSettings
  plugins: { manifest: PluginManifest; enabled: boolean }[]
  loadIssues: { pluginId: string; message: string }[]
  externalDetected: { id: string; name: string }[]
}

export interface BackupImportResult {
  restored: boolean
  warnings: string[]
  restartRecommended: boolean
  /** 导入前当前数据的安全快照路径（回退依据），取消导入时为 null */
  safetyBackupPath: string | null
}

// 与 backup 插件的导入前快照约定一致（<userData>/backups/pre-import-*.gtools，保留 5 份），两条导入路径共用同一目录互相续期
const SAFETY_DIR = 'backups'
const SAFETY_KEEP = 5
const PRE_IMPORT_RE = /^pre-import-\d{8}-\d{6}\.gtools$/

function preImportFileName(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    `pre-import-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.gtools`
  )
}

async function prunePreImportFiles(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await nodeFs.readdir(dir)
  } catch {
    return
  }
  const stale = names.filter((n) => PRE_IMPORT_RE.test(n)).sort((a, b) => b.localeCompare(a)).slice(SAFETY_KEEP)
  for (const n of stale) await nodeFs.rm(join(dir, n), { force: true })
}

type HostResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string }

function pluginsSnapshot(loader: PluginLoader): { manifest: PluginManifest; enabled: boolean }[] {
  return loader.registry.all().map((e) => ({ manifest: e.manifest, enabled: e.enabled }))
}

function broadcast(channel: string, payload: unknown): void {
  getSearchWindow()?.webContents.send(channel, payload)
}

/** 仅主搜索窗口可调用的宿主通道守卫（防其它子窗口/插件页反向操控主窗）；主窗不存在时一律拒绝 */
function isSearchWindowSender(e: { sender: { id: number } }): boolean {
  return getSearchWindow()?.webContents.id === e.sender.id
}

function backupRoots(): { userData: string; home: string; caseInsensitive: boolean; sep: string } {
  return {
    userData: app.getPath('userData'),
    home: homedir(),
    caseInsensitive: process.platform !== 'linux',
    sep: pathSep
  }
}

export function setupIpc(deps: {
  loader: PluginLoader
  settings: SettingsStore
  services: ServiceBag
  apiCenter: ApiCenterService
  nativeApps: NativeAppsService
  detached: DetachedWindowManager
  onHotkeyToggle: () => void
}): void {
  const { loader, settings, services, apiCenter } = deps

  // 插件能力通道：权限与启用校验在 dispatchApi 内
  ipcMain.handle('gtools:api', (_e, req: { pluginId: string; api: string; payload: unknown[] }): Promise<ApiCallResult> => {
    if (!req || typeof req.pluginId !== 'string' || typeof req.api !== 'string' || !Array.isArray(req.payload)) {
      return Promise.resolve({ ok: false, error: 'BAD_REQUEST', message: '非法调用格式' })
    }
    return dispatchApi(loader.registry, services, req.pluginId, req.api, req.payload)
  })

  // 浮窗页面专用通道：只认 float preload 的 sender，按 webContents 定位，无插件能力面
  ipcMain.handle(
    'gtools:float',
    (
      e,
      req: { op: 'close' | 'event' | 'info'; event?: string; payload?: unknown }
    ): { ok: boolean; data?: unknown } => {
      const float = services.window.float
      switch (req?.op) {
        case 'close':
          return { ok: float.closeByWebContents(e.sender.id) }
        case 'event': {
          if (typeof req.event !== 'string' || req.event === '') return { ok: false }
          return { ok: float.emitFromWebContents(e.sender.id, req.event, req.payload ?? null) }
        }
        case 'info': {
          const info = float.infoByWebContents(e.sender.id)
          return info === null ? { ok: false } : { ok: true, data: info }
        }
        default:
          return { ok: false }
      }
    }
  )

  /** 禁用插件 = 停 backend + 关掉它的全部浮窗与独立窗口（防泄漏），设置持久化由调用方负责 */
  async function disablePlugin(id: string): Promise<void> {
    await loader.setEnabled(id, false)
    services.window.float.closeAllForPlugin(id)
    deps.detached.closeForPlugin(id)
  }

  async function exportBackup(): Promise<HostResult<{ path: string | null }>> {
    const pluginStorage = await services.storage.dumpAll()
    const backup = serializeBackup({
      settings: settings.settings,
      pluginStorage,
      platform: process.platform,
      appVersion: services.app.version,
      apiServices: apiCenter.config
    })
    const tokenized = tokenizePathValues(backup, backupRoots())
    const parent = getSearchWindow()
    const r = parent
      ? await electronDialog.showSaveDialog(parent, {
          title: '导出 GTools 备份',
          defaultPath: defaultBackupFileName(),
          filters: [{ name: 'GTools 备份', extensions: ['json'] }]
        })
      : await electronDialog.showSaveDialog({
          title: '导出 GTools 备份',
          defaultPath: defaultBackupFileName(),
          filters: [{ name: 'GTools 备份', extensions: ['json'] }]
        })
    if (r.canceled || !r.filePath) return { ok: true, data: { path: null } }
    await nodeFs.mkdir(dirname(r.filePath), { recursive: true })
    await nodeFs.writeFile(r.filePath, JSON.stringify(tokenized, null, 2), { encoding: 'utf-8' })
    return { ok: true, data: { path: r.filePath } }
  }

  async function importBackup(): Promise<HostResult<BackupImportResult>> {
    const parent = getSearchWindow()
    const openOpts = { title: '导入 GTools 备份', filters: [{ name: 'GTools 备份', extensions: ['json'] }], properties: ['openFile' as const] }
    const r = parent ? await electronDialog.showOpenDialog(parent, openOpts) : await electronDialog.showOpenDialog(openOpts)
    if (r.canceled || r.filePaths.length === 0) {
      return { ok: true, data: { restored: false, warnings: [], restartRecommended: false, safetyBackupPath: null } }
    }

    const raw = await nodeFs.readFile(r.filePaths[0], { encoding: 'utf-8' })
    const known = new Set(loader.registry.all().map((e) => e.manifest.id))
    const parsed = parseBackup(raw, { knownPluginIds: known })
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const backup = restorePathTokens(parsed.backup, backupRoots())

    // 覆盖前先给用户看清将导入什么；确认后先把当前数据快照到 backups/（回退依据）
    const created = backup.createdAt === '' ? '未知' : backup.createdAt.replace('T', ' ').replace(/(\.\d+)?Z$/, ' UTC')
    const confirmOpts = {
      type: 'warning' as const,
      message: '确认导入备份？将覆盖当前设置和插件数据。',
      detail: [
        `备份创建：${created}`,
        `来源：${backup.sourcePlatform} · v${backup.appVersion}`,
        `将恢复 ${Object.keys(backup.pluginStorage).length} 个插件的数据`,
        `导入前会先把当前数据快照到 ${SAFETY_DIR}/ 目录，可据此回退`
      ].join('\n'),
      buttons: ['导入', '取消'],
      defaultId: 0,
      cancelId: 1
    }
    const confirmed = parent
      ? await electronDialog.showMessageBox(parent, confirmOpts)
      : await electronDialog.showMessageBox(confirmOpts)
    if (confirmed.response !== 0) {
      return { ok: true, data: { restored: false, warnings: [], restartRecommended: false, safetyBackupPath: null } }
    }

    let safetyBackupPath: string
    try {
      const pluginStorage = await services.storage.dumpAll()
      const snapshot = serializeBackup({
        settings: settings.settings,
        pluginStorage,
        platform: process.platform,
        appVersion: services.app.version,
        apiServices: apiCenter.config
      })
      const safetyDir = join(app.getPath('userData'), SAFETY_DIR)
      await nodeFs.mkdir(safetyDir, { recursive: true })
      safetyBackupPath = join(safetyDir, preImportFileName(new Date()))
      await nodeFs.writeFile(safetyBackupPath, JSON.stringify(tokenizePathValues(snapshot, backupRoots()), null, 2), {
        encoding: 'utf-8'
      })
      await prunePreImportFiles(safetyDir)
    } catch (err) {
      return { ok: false, error: `导入前快照失败，已中止导入：${err instanceof Error ? err.message : String(err)}` }
    }

    // 设置恢复：插件启禁先经 loader 生效（停 backend/关浮窗），再统一落 settings
    const prevDisabled = new Set(settings.settings.disabledPlugins)
    const nextDisabled = Array.isArray(backup.settings.disabledPlugins) ? backup.settings.disabledPlugins : []
    const platform = process.platform === 'darwin' ? 'darwin' : 'win32'
    const prevHotkey = settings.settings.hotkey[platform]
    const nextSettings = await settings.update({
      theme: backup.settings.theme,
      hotkey: backup.settings.hotkey,
      disabledPlugins: nextDisabled
    })
    if (nextSettings.hotkey[platform] !== prevHotkey) {
      const rr = rebindHotkey(nextSettings.hotkey[platform], deps.onHotkeyToggle)
      if (!rr.ok) return { ok: false, error: rr.error ?? '导入的快捷键注册失败，其余数据已恢复' }
    }
    for (const id of known) {
      const shouldEnable = !nextDisabled.includes(id)
      const wasEnabled = !prevDisabled.has(id)
      if (shouldEnable && !wasEnabled) await loader.setEnabled(id, true)
      else if (!shouldEnable && wasEnabled) await disablePlugin(id)
    }

    const warnings = [...parsed.warnings]
    for (const [pid, kv] of Object.entries(backup.pluginStorage)) {
      await services.storage.replaceAll(pid, kv)
    }

    // v1 备份无 apiServices 段：保留本机现状不动；有则 sanitize 后整体替换，完成即广播（内存态即时生效）
    if (backup.apiServices !== undefined) {
      await apiCenter.replaceAll(backup.apiServices)
    }

    applyThemeToWindow(nextSettings.theme)
    deps.detached.applyThemeToAll(nextSettings.theme)
    broadcast('settings-changed', nextSettings)
    broadcast('plugin-state-changed', { plugins: pluginsSnapshot(loader) })
    // 常驻 backend 内存态（如剪贴板历史）不会自动重载导入的数据
    return { ok: true, data: { restored: true, warnings, restartRecommended: true, safetyBackupPath } }
  }

  // 宿主自身通道（设置页等宿主 UI 用，非插件能力面）
  ipcMain.handle('gtools:host', async (e, req: { api: string; payload: unknown }): Promise<HostResult> => {
    try {
      switch (req?.api) {
        case 'app:init': {
          const data: HostInitResult = {
            settings: settings.settings,
            plugins: pluginsSnapshot(loader),
            loadIssues: loader.issues.map((i) => ({ pluginId: i.pluginId, message: `${i.field}: ${i.message}` })),
            externalDetected: loader.externalDetected.map((d) => ({ id: d.manifest.id, name: d.manifest.name }))
          }
          return { ok: true, data }
        }
        case 'settings:set': {
          const p = (req.payload ?? {}) as { theme?: ThemeName; hotkey?: Partial<AppSettings['hotkey']> }
          if (p.hotkey) {
            const platform = process.platform === 'darwin' ? 'darwin' : 'win32'
            const newAccel = p.hotkey[platform]
            if (newAccel) {
              const r = rebindHotkey(newAccel, deps.onHotkeyToggle)
              if (!r.ok) return { ok: false, error: r.error ?? '快捷键注册失败' }
            }
          }
          const next = await settings.update(p)
          if (p.theme) {
            applyThemeToWindow(next.theme)
            deps.detached.applyThemeToAll(next.theme)
          }
          broadcast('settings-changed', next)
          return { ok: true, data: next }
        }
        case 'window:hide':
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          hideSearchWindow()
          return { ok: true, data: null }
        case 'window:set-resizable': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          // 插件态放开主窗拉伸；false = 收回并复原固定尺寸
          const p = (req.payload ?? {}) as { resizable?: unknown; minWidth?: unknown; minHeight?: unknown }
          if (typeof p.resizable !== 'boolean') return { ok: false, error: 'resizable 必须是布尔值' }
          const mw = typeof p.minWidth === 'number' ? p.minWidth : undefined
          const mh = typeof p.minHeight === 'number' ? p.minHeight : undefined
          setSearchWindowResizable(p.resizable, mw, mh)
          if (!p.resizable) restoreSearchWindowSize()
          return { ok: true, data: null }
        }
        case 'window:detach-plugin': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const p = (req.payload ?? {}) as { id?: unknown; query?: unknown }
          if (typeof p.id !== 'string' || p.id === '') return { ok: false, error: '缺少插件 id' }
          const entry = loader.registry.get(p.id)
          if (!entry || !entry.enabled) return { ok: false, error: '插件未启用或不存在' }
          deps.detached.open(p.id, typeof p.query === 'string' ? p.query : '')
          return { ok: true, data: null }
        }
        case 'window:close-detached': {
          // 只认发送方自己的独立窗口（按 webContents 定位），主窗调用无效
          const closed = deps.detached.closeByWebContents(e.sender.id)
          return closed ? { ok: true, data: null } : { ok: false, error: '独立窗口不存在' }
        }
        case 'window:set-always-on-top': {
          const v = (req.payload as { value?: unknown } | null)?.value
          if (typeof v !== 'boolean') return { ok: false, error: 'value 必须是布尔值' }
          const done = deps.detached.setAlwaysOnTopFor(e.sender.id, v)
          return done ? { ok: true, data: v } : { ok: false, error: '独立窗口不存在' }
        }
        case 'window:set-height': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          // 空态高度联动（§1.5）：主进程夹紧范围防越界，锚定左上角；下限 220 容下贴底收尾的折叠空态
          const h = (req.payload as { height?: unknown } | null)?.height
          if (typeof h !== 'number' || !Number.isFinite(h)) return { ok: false, error: 'height 必须是数字' }
          setSearchWindowHeight(Math.min(720, Math.max(220, Math.round(h))))
          return { ok: true, data: null }
        }
        case 'plugin:enter': {
          const id = (req.payload as { id: string })?.id
          if (typeof id === 'string') await loader.ensureBackendStarted(id)
          return { ok: true, data: null }
        }
        case 'plugins:set-enabled': {
          const { id, enabled } = req.payload as { id: string; enabled: boolean }
          if (enabled) {
            const r = await loader.setEnabled(id, true)
            if (!r.ok) return { ok: false, error: r.error ?? '操作失败' }
          } else {
            await disablePlugin(id)
          }
          const disabled = loader.registry.all().filter((e) => !e.enabled).map((e) => e.manifest.id)
          await settings.update({ disabledPlugins: disabled })
          broadcast('plugin-state-changed', { id, enabled, plugins: pluginsSnapshot(loader) })
          return { ok: true, data: null }
        }
        case 'backup:export':
          return await exportBackup()
        case 'backup:import':
          return await importBackup()
        case 'api-services:get':
          return { ok: true, data: apiCenter.sanitized() }
        case 'api-services:upsert-provider': {
          const form = (req.payload ?? {}) as ProviderForm
          return { ok: true, data: await apiCenter.upsertProvider(form) }
        }
        case 'api-services:remove-provider': {
          const id = (req.payload as { id?: unknown })?.id
          if (typeof id !== 'string' || id === '') return { ok: false, error: '缺少服务商 id' }
          return { ok: true, data: await apiCenter.removeProvider(id) }
        }
        case 'api-services:set-active': {
          const id = (req.payload as { id?: unknown })?.id
          if (typeof id !== 'string') return { ok: false, error: 'id 必须是字符串（空串 = 回退默认）' }
          return { ok: true, data: await apiCenter.setActive(id) }
        }
        case 'api-services:test': {
          const p = (req.payload ?? {}) as { id?: unknown; draft?: ProviderForm }
          return {
            ok: true,
            data: await apiCenter.testProvider(typeof p.id === 'string' && p.id !== '' ? p.id : undefined, p.draft)
          }
        }
        // 宿主空态应用栏（ui-style-guide §1.5）：枚举/打开/置顶，与插件能力面无关
        case 'apps:list': {
          const p = (req.payload ?? {}) as { refresh?: unknown }
          return { ok: true, data: await deps.nativeApps.list({ refresh: p.refresh === true }) }
        }
        case 'apps:open': {
          const path = (req.payload as { path?: unknown } | null)?.path
          if (typeof path !== 'string' || !path.endsWith('.app')) {
            return { ok: false, error: '缺少 .app 应用路径' }
          }
          const r = await deps.nativeApps.open(path)
          return r.ok ? { ok: true, data: null } : { ok: false, error: r.error ?? '打开失败' }
        }
        case 'apps:pin':
        case 'apps:unpin': {
          const id = (req.payload as { id?: unknown } | null)?.id
          if (typeof id !== 'string' || id === '') return { ok: false, error: '缺少应用 id' }
          // data 直接是置顶全量数组（渲染层 parsePinnedIds 只认裸数组，别再包一层对象）
          const pinned = req.api === 'apps:pin' ? await deps.nativeApps.pin(id) : await deps.nativeApps.unpin(id)
          return { ok: true, data: pinned }
        }
        default:
          return { ok: false, error: `未知宿主 api：${String(req?.api)}` }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
