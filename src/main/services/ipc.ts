import { ipcMain, dialog as electronDialog, app } from 'electron'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import * as nodeFs from 'node:fs/promises'
import { dirname, join, sep as pathSep } from 'node:path'
import type { ApiCallResult, ApiServiceId } from '@sdk/api'
import type { PluginManifest } from '@sdk/manifest'
import { peekJsonCandidate } from '@sdk/json-detect'
import type { PluginLoader } from '../plugin-loader'
import type { SettingsStore, AppSettings, ThemeName, CommandHotkey, OutlineColor, AppLogSkin, AppLogoSkin } from '../settings-store'
import type { ServiceBag } from './dispatch'
import { dispatchApi } from './dispatch'
import { isAppLogLevel, type AppLog } from './app-log'
import { PROVIDER_PRESETS, getPreset } from './api-center'
import type { ApiCenterService, ProviderForm, ProviderType } from './api-center'
import type { NativeAppsService } from './native-apps'
import type { ClipboardHistoryService } from './clipboard-history'
import type { BackgroundService } from './background'
import { assertHttpUrl } from './net-guard'
import type { DetachedWindowManager } from '../detached-window-manager'
import {
  allLiveWindows,
  applyHideOnBlur,
  applyThemeToWindow,
  getSearchWindow,
  hideSearchWindow,
  isTransparentWindow,
  restoreSearchWindowSize,
  resizeSearchWindowBy,
  setSearchWindowHeight,
  setSearchWindowResizable,
  showSearchWindow,
  suspendBlurHide
} from '../window'
import { isAllWindowsBroadcast } from './broadcast-channels'
import {
  applyThemeToClipboardFlyout,
  getClipboardFlyoutWindow,
  isClipboardFlyoutSender,
  reanchorClipboardFlyout,
  setClipboardFlyoutPosition
} from '../clipboard-flyout-window'
import { rebindHotkey, suspendHotkeys, resumeHotkeys, armHotkeyProbe, disarmHotkeyProbe, syncCommandHotkeys, type CommandHotkeySyncResult } from '../shortcut'
import { applyAppLogoSkin } from '../logo-skin'
import { applyTraySkin } from '../tray'
import { createHotkeyCapture, type HotkeyCaptureHandler } from '../hotkey-capture'
import { syncLoginItem } from '../login-item'
import {
  defaultBackupFileName,
  parseBackup,
  restorePathTokens,
  serializeBackup,
  stringifyBackupChunked,
  tokenizePathValues
} from './backup'
import { createUpdater, RELEASE_PREFIX } from './updater'
import { createUpdateDownloader, type UpdateDownloaderFs } from './update-downloader'
import { createPluginServer, scanUtoolsPlugins, type UtoolsPluginServer } from './utools-compat'

export interface HostInitResult {
  version: string
  platform: string
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

/** 导入前快照按文件名时间降序留最近 SAFETY_KEEP 份（≥1 永不删尽）；单份删除失败不阻塞导入（多留一份无害） */
async function prunePreImportFiles(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await nodeFs.readdir(dir)
  } catch {
    return
  }
  const stale = names.filter((n) => PRE_IMPORT_RE.test(n)).sort((a, b) => b.localeCompare(a)).slice(SAFETY_KEEP)
  for (const n of stale) await nodeFs.rm(join(dir, n), { force: true }).catch(() => {})
}

// warnings 只在非空时附带：旧消费方按字段存在性判断，空数组也会被误判为「有警告」
type HostResult<T = unknown> = { ok: true; data: T; warnings?: string[] } | { ok: false; error: string }

// 剪贴板单次读取上限：渲染层逐键全量正则扫描，极端大文本会卡 UI；64K 兼顾大 JSON 匹配
const CLIPBOARD_PEEK_MAX_CHARS = 65_536

function pluginsSnapshot(loader: PluginLoader): { manifest: PluginManifest; enabled: boolean }[] {
  return loader.registry.all().map((e) => ({ manifest: e.manifest, enabled: e.enabled }))
}

/** 宿主事件广播：登记进 broadcast-channels 的通道投递所有存活窗口，其余（含新通道）fail-closed 只发主窗 */
export function broadcast(channel: string, payload: unknown): void {
  if (isAllWindowsBroadcast(channel)) {
    for (const w of allLiveWindows()) w.webContents.send(channel, payload)
    return
  }
  getSearchWindow()?.webContents.send(channel, payload)
}

/** 热键设置按平台各存一份，注册只认当前系统那一份 */
function hotkeyPlatform(): 'darwin' | 'win32' {
  return process.platform === 'darwin' ? 'darwin' : 'win32'
}

/** sync 结果拼用户可读提示；skipped/failed 的 reason 自带语义（让位/禁用/占用），全绿返回 null */
function describeCommandHotkeySync(r: CommandHotkeySyncResult): string | null {
  const parts = [
    ...r.failed.map((f) => `${f.accel}（${f.pluginId}/${f.commandId}）${f.reason}`),
    ...r.skipped.map((s) => `${s.accel}（${s.pluginId}/${s.commandId}）${s.reason}`)
  ]
  return parts.length > 0 ? `部分指令热键未生效：${parts.join('；')}` : null
}

/** 仅主搜索窗口可调用的宿主通道守卫（防其它子窗口/插件页反向操控主窗）；主窗不存在时一律拒绝 */
function isSearchWindowSender(e: { sender: { id: number } }): boolean {
  return getSearchWindow()?.webContents.id === e.sender.id
}

/** 剪贴板四通道复合守卫：主窗或剪贴板飞窗（data-wintx 同源、无键盘能力）放行，陌生 id 仍拒 */
function isClipboardPanelSender(e: { sender: { id: number } }): boolean {
  return isSearchWindowSender(e) || isClipboardFlyoutSender(e)
}

/** api-services 通道的品类载荷：缺省/坏值回 'translate'（既有渲染层零改动兼容） */
function serviceOf(v: unknown): ApiServiceId {
  return v === 'ai' ? 'ai' : 'translate'
}

// 录入期按键捕获：Alt+Space 的 keyDown 被 Windows 系统键通道吞掉，主进程 before-input-event 据带修饰标志的 keyUp 重建后转发录入框
let hotkeyCaptureHandler: HotkeyCaptureHandler | null = null

function attachHotkeyCapture(): void {
  const wc = getSearchWindow()?.webContents
  if (!wc || wc.isDestroyed() || hotkeyCaptureHandler) return
  hotkeyCaptureHandler = createHotkeyCapture((accel) => {
    if (!wc.isDestroyed()) wc.send('hotkey-captured', accel)
  })
  wc.on('before-input-event', hotkeyCaptureHandler)
}

function detachHotkeyCapture(): void {
  const wc = getSearchWindow()?.webContents
  if (wc && !wc.isDestroyed() && hotkeyCaptureHandler) wc.removeListener('before-input-event', hotkeyCaptureHandler)
  hotkeyCaptureHandler = null
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
  /** 可选：真实装配（index.ts）恒传入；旧 harness 不带时四个 clipboard-history api 拒绝服务 */
  clipboardHistory?: ClipboardHistoryService
  /** 可选：真实装配（index.ts）恒传入；旧 harness 不带时 background:* 拒绝服务 */
  background?: BackgroundService
  detached: DetachedWindowManager
  appLog: AppLog
  onHotkeyToggle: () => void
}): void {
  const { loader, settings, services, apiCenter } = deps

  // 剪贴板历史任何变更（轮询新采集/copy/remove/clear）双投：主窗广播 + 飞窗直发（R5），面板据此刷新
  deps.clipboardHistory?.onChanged(() => {
    broadcast('clipboard-history-changed', null)
    getClipboardFlyoutWindow()?.webContents.send('clipboard-history-changed', null)
  })

  // 更新检测：fetch/openExternal/version/platform 全走 ServiceBag 注入面（测试可 fake）；闭包缓存随 setupIpc 生命周期
  const updater = createUpdater({
    fetch: services.net.fetch,
    version: services.app.version,
    platform: services.app.platform,
    arch: services.app.arch
  })

  // 应用内更新下载：进度经 update-download-progress 广播主窗；downloadUrl 只认 update:check 缓存值（含 null，失败不清）
  const updateCacheDir = join(app.getPath('userData'), 'update-cache')
  let lastCheckDownloadUrl: string | null = null
  // update:install 单飞标记：spawn 等待+清理链窗口内二次调用直接拒绝，防双拉安装器
  let installInFlight = false
  const downloaderFs: UpdateDownloaderFs = {
    // nodeFs.mkdir recursive 返回首个创建路径，接口约定 void，包一层丢弃
    mkdir: async (dir, opts) => {
      await nodeFs.mkdir(dir, opts)
    },
    readdir: (dir) => nodeFs.readdir(dir),
    rm: (path, opts) => nodeFs.rm(path, opts),
    rename: (from, to) => nodeFs.rename(from, to),
    stat: (path) => nodeFs.stat(path).then((s) => ({ mtimeMs: s.mtimeMs })),
    // nodeFs.open 的 sink：显式 position 追踪累计字节，写与关各自原子
    createSink: async (path) => {
      const fh = await nodeFs.open(path, 'w')
      let position = 0
      return {
        write: async (chunk) => {
          await fh.write(chunk, 0, chunk.byteLength, position)
          position += chunk.byteLength
        },
        close: () => fh.close()
      }
    }
  }
  const downloader = createUpdateDownloader({
    fetchStream: services.net.fetchStream,
    fs: downloaderFs,
    dir: updateCacheDir,
    platform: services.app.platform,
    onProgress: (snap) => broadcast('update-download-progress', snap)
  })

  // 指令热键触发：弹主窗 → 通知渲染层进命令态 → 启 backend（对齐 plugin:enter 语义，backend 结果不阻塞触发）
  const fireCommandHotkey = (pluginId: string, commandId: string): void => {
    showSearchWindow()
    broadcast('command-hotkey', { pluginId, commandId })
    void loader.ensureBackendStarted(pluginId)
  }

  const currentBindings = (): { accel: string; pluginId: string; commandId: string }[] =>
    settings.settings.commandHotkeys.map((h: CommandHotkey) => ({ accel: h[hotkeyPlatform()], pluginId: h.pluginId, commandId: h.commandId }))

  /** 指令热键只注册启用插件：禁用项进 skipped（settings:set 以 warnings 提示），其旧注册态由差集注销兜底 */
  const hotkeySyncOpts = (): { disabledPluginIds: Set<string> } => ({ disabledPluginIds: new Set(settings.settings.disabledPlugins) })

  // 启动注册（setupIpc 晚于 index.ts 的主热键注册调用，同键项在此让位主唤起）
  syncCommandHotkeys(currentBindings(), settings.settings.hotkey[hotkeyPlatform()], fireCommandHotkey, undefined, hotkeySyncOpts())

  // uTools 移植 POC：独立目录 userData/utools-plugins/（不触碰 userData/plugins/ 安全边界），本地静态服务退出容器即停
  const utoolsPluginsDir = (): string => join(app.getPath('userData'), 'utools-plugins')
  // 缓存创建 promise：并发 serve 复用同一实例（check-then-await 会各自 listen 泄漏先者）；失败清空允许重试
  let utoolsServerPromise: Promise<UtoolsPluginServer> | null = null
  // 承载容器视图的 webContents：destroyed（窗口被关/crash 重载）时兜底停服，不等渲染层自觉
  interface UtoolsOwnerRef {
    readonly id: number
    once(ev: string, cb: () => void): unknown
    removeListener(ev: string, cb: () => void): unknown
  }
  let utoolsOwner: UtoolsOwnerRef | null = null
  const utoolsOwnerDestroyed = (): void => {
    void stopUtoolsServer()
    utoolsOwner = null
  }
  const watchUtoolsOwner = (sender: UtoolsOwnerRef): void => {
    if (utoolsOwner === sender) return
    utoolsOwner?.removeListener('destroyed', utoolsOwnerDestroyed)
    utoolsOwner = sender
    sender.once('destroyed', utoolsOwnerDestroyed)
  }
  const stopUtoolsServer = async (): Promise<void> => {
    const p = utoolsServerPromise
    utoolsServerPromise = null
    if (!p) return
    try {
      await (await p).close()
    } catch {
      // 创建半途失败：无资源可清理
    }
  }

  // 插件能力通道：权限与启用校验在 dispatchApi 内；pluginId 另须绑定 sender（主窗或登记独立窗），防跨插件冒用
  ipcMain.handle('gtools:api', (e, req: { pluginId: string; api: string; payload: unknown[] }): Promise<ApiCallResult> => {
    if (!req || typeof req.pluginId !== 'string' || typeof req.api !== 'string' || !Array.isArray(req.payload)) {
      return Promise.resolve({ ok: false, error: 'BAD_REQUEST', message: '非法调用格式' })
    }
    // 主窗内跨插件冒用是已知残留：主进程拿不到渲染层路由真值，用 plugin:enter 跟踪会误杀卸载中的异步落盘，故不跟踪
    if (isSearchWindowSender(e)) return dispatchApi(loader.registry, services, req.pluginId, req.api, req.payload)
    const boundPluginId = deps.detached.pluginIdForWebContents(e.sender.id)
    if (boundPluginId === null) return Promise.resolve({ ok: false, error: 'FORBIDDEN_SENDER', message: '非插件宿主窗口' })
    if (boundPluginId !== req.pluginId) return Promise.resolve({ ok: false, error: 'PLUGIN_MISMATCH', message: '窗口与插件不一致' })
    return dispatchApi(loader.registry, services, req.pluginId, req.api, req.payload)
  })

  // 浮窗页面专用通道：只认 float preload 的 sender，按 webContents 定位；geometry 是唯一能力窄例外（只够得着自己窗口 bounds）
  ipcMain.handle(
    'gtools:float',
    (
      e,
      req: {
        op: 'close' | 'event' | 'info' | 'geometry'
        event?: string
        payload?: unknown
        x?: number
        y?: number
        width?: number
        height?: number
      }
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
        case 'geometry':
          return { ok: float.setGeometryByWebContents?.(e.sender.id, req) ?? false }
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

  /** 退出前清理链（app:relaunch 与 update:install 共用）：浮窗/独立窗回收、backend 停止、防抖中的 settings 与 apiCenter 落盘，3s 超时兜底防挂死 */
  async function runQuitCleanup(): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000)
      void (async () => {
        try {
          services.window.float.closeAll()
          deps.detached.closeAll()
          await loader.disposeAll()
          await settings.flush()
          await apiCenter.flush()
        } catch (err) {
          console.error('GTools 重启前清理失败：', err)
        } finally {
          clearTimeout(timer)
          resolve()
        }
      })()
    })
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
          filters: [{ name: 'GTools 备份', extensions: ['gtools', 'json'] }]
        })
      : await electronDialog.showSaveDialog({
          title: '导出 GTools 备份',
          defaultPath: defaultBackupFileName(),
          filters: [{ name: 'GTools 备份', extensions: ['gtools', 'json'] }]
        })
    if (r.canceled || !r.filePath) return { ok: true, data: { path: null } }
    await nodeFs.mkdir(dirname(r.filePath), { recursive: true })
    // 分块序列化：大备份不再同步 stringify 独占主进程
    await nodeFs.writeFile(r.filePath, await stringifyBackupChunked(tokenized), { encoding: 'utf-8' })
    return { ok: true, data: { path: r.filePath } }
  }

  async function importBackup(): Promise<HostResult<BackupImportResult>> {
    const parent = getSearchWindow()
    const openOpts = { title: '导入 GTools 备份', filters: [{ name: 'GTools 备份', extensions: ['gtools', 'json'] }], properties: ['openFile' as const] }
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
      await nodeFs.writeFile(safetyBackupPath, await stringifyBackupChunked(tokenizePathValues(snapshot, backupRoots())), {
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
    let commandSkipped: string | null = null
    const nextSettings = await settings.update({
      theme: backup.settings.theme,
      transparency: backup.settings.transparency,
      outlineEnabled: backup.settings.outlineEnabled,
      outlineWidth: backup.settings.outlineWidth,
      outlineColor: backup.settings.outlineColor,
      outlineCustomColor: backup.settings.outlineCustomColor,
      outlineFlowSpeed: backup.settings.outlineFlowSpeed,
      appLogSkin: backup.settings.appLogSkin,
      appLogoSkin: backup.settings.appLogoSkin,
      hotkey: backup.settings.hotkey,
      disabledPlugins: nextDisabled
    })
    if (nextSettings.hotkey[platform] !== prevHotkey) {
      // 导入换主键：先以新主键让位撞键指令热键（注销被占键），否则换键 rebind 注册必失败早退、让位分支不可达
      commandSkipped = describeCommandHotkeySync(
        syncCommandHotkeys(currentBindings(), nextSettings.hotkey[platform], fireCommandHotkey, undefined, hotkeySyncOpts())
      )
      const rr = rebindHotkey(nextSettings.hotkey[platform], deps.onHotkeyToggle)
      if (!rr.ok) {
        // 换键失败回滚：让位被注销的指令热键在旧主键下恢复注册
        syncCommandHotkeys(currentBindings(), prevHotkey, fireCommandHotkey, undefined, hotkeySyncOpts())
        return { ok: false, error: rr.error ?? '导入的快捷键注册失败，其余数据已恢复' }
      }
    }
    for (const id of known) {
      const shouldEnable = !nextDisabled.includes(id)
      const wasEnabled = !prevDisabled.has(id)
      if (shouldEnable && !wasEnabled) await loader.setEnabled(id, true)
      else if (!shouldEnable && wasEnabled) await disablePlugin(id)
    }

    const warnings = [...parsed.warnings]
    if (commandSkipped) warnings.push(commandSkipped)

    // 常驻 backend 重载信令：备份携带其数据且运行中的 backend 先 stop（stop 会把内存旧态 flush 落盘，
    // 必须让随后的 replaceAll 覆盖之），replaceAll 后再重新 init+start（init 才读 kv，导入数据即生效，无需重启）
    const reloadIds: string[] = []
    for (const e of loader.registry.all()) {
      if (!e.backendStarted || e.backend === null || backup.pluginStorage[e.manifest.id] === undefined) continue
      if (await loader.suspendBackend(e.manifest.id)) reloadIds.push(e.manifest.id)
    }
    // replaceAll 中途抛错（杀软锁文件/盘满）也必须复活被 stop 的 backend，否则常驻插件静默死亡
    try {
      for (const [pid, kv] of Object.entries(backup.pluginStorage)) {
        await services.storage.replaceAll(pid, kv)
      }
    } finally {
      for (const id of reloadIds) await loader.ensureBackendStarted(id).catch(() => {})
    }

    // v1 备份无 apiServices 段：保留本机现状不动；有则 sanitize 后整体替换，完成即广播（内存态即时生效）
    if (backup.apiServices !== undefined) {
      await apiCenter.replaceAll(backup.apiServices)
    }

    applyThemeToWindow(nextSettings.theme, nextSettings.transparency)
    deps.detached.applyThemeToAll(nextSettings.theme, nextSettings.transparency, {
      enabled: nextSettings.outlineEnabled,
      width: nextSettings.outlineWidth,
      color: nextSettings.outlineColor,
      customColor: nextSettings.outlineCustomColor,
      flowSpeed: nextSettings.outlineFlowSpeed
    })
    applyThemeToClipboardFlyout(nextSettings.theme, nextSettings.transparency)
    broadcast('settings-changed', nextSettings)
    broadcast('plugin-state-changed', { plugins: pluginsSnapshot(loader) })
    // 常驻 backend 已随重载信令读到导入数据；restartRecommended 保守保留（备份未携带数据的插件不受影响）
    return { ok: true, data: { restored: true, warnings, restartRecommended: true, safetyBackupPath } }
  }

  // 宿主自身通道（设置页等宿主 UI 用，非插件能力面）
  ipcMain.handle('gtools:host', async (e, req: { api: string; payload: unknown }): Promise<HostResult> => {
    try {
      switch (req?.api) {
        case 'screenshot:overlay-event': {
          // 遮罩页（data:URL+主 preload）回传选区动作；sender 必须是当前活跃遮罩窗
          if (e.sender.id !== services.screenshot.overlayWebContentsId()) return { ok: false, error: '非活跃截图遮罩窗' }
          services.screenshot.handleOverlayEvent(req.payload)
          return { ok: true, data: null }
        }
        case 'app:init': {
          const data: HostInitResult = {
            version: app.getVersion(),
            // 与 updater/downloader 同走 services.app 注入面（ipc.ts 内同族取值保持一致）
            platform: services.app.platform,
            settings: settings.settings,
            plugins: pluginsSnapshot(loader),
            loadIssues: loader.issues.map((i) => ({ pluginId: i.pluginId, message: `${i.field}: ${i.message}` })),
            externalDetected: loader.externalDetected.map((d) => ({ id: d.manifest.id, name: d.manifest.name }))
          }
          return { ok: true, data }
        }
        case 'settings:set': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const p = (req.payload ?? {}) as {
            theme?: ThemeName
            transparency?: Partial<AppSettings['transparency']>
            hotkey?: Partial<AppSettings['hotkey']>
            outlineEnabled?: boolean
            outlineWidth?: number
            outlineColor?: OutlineColor
            outlineCustomColor?: string
            outlineFlowSpeed?: number
            appLogSkin?: AppLogSkin
            appLogoSkin?: AppLogoSkin
            launchAtLogin?: boolean
            clipboardPanel?: Partial<AppSettings['clipboardPanel']>
            background?: Partial<AppSettings['background']>
            hideOnBlur?: boolean
            commandHotkeys?: CommandHotkey[]
          }
          // 本次调用已换绑主键时记旧键：后续登录项写 OS 失败需回滚，保证「不落盘 ⇒ OS 态=内存态」
          let reboundFrom: string | null = null
          if (p.hotkey) {
            const platform = hotkeyPlatform()
            const newAccel = p.hotkey[platform]
            if (newAccel) {
              const accelChanged = newAccel !== settings.settings.hotkey[platform]
              // 主键撞指令热键时 rebind 的 register 必失败早退，让位分支不可达：先以新主键重检指令热键（注销撞键项）
              if (accelChanged) syncCommandHotkeys(currentBindings(), newAccel, fireCommandHotkey, undefined, hotkeySyncOpts())
              const r = rebindHotkey(newAccel, deps.onHotkeyToggle)
              if (!r.ok) {
                // 换键失败回滚：让位被注销的指令热键在旧主键下恢复注册
                if (accelChanged) syncCommandHotkeys(currentBindings(), settings.settings.hotkey[platform], fireCommandHotkey, undefined, hotkeySyncOpts())
                return { ok: false, error: r.error ?? '快捷键注册失败' }
              }
              if (accelChanged) reboundFrom = settings.settings.hotkey[platform]
            }
          }
          // 只在显式携带且为严格 boolean 时同步 OS 登录项（与 sanitizePatch 同闸，防渲染层传脏值）；写失败即不落盘，保证 OS 态=内存态=文件态一致
          if (typeof p.launchAtLogin === 'boolean') {
            try {
              syncLoginItem(app, p.launchAtLogin)
            } catch (err) {
              // login-item 头注释契约：OS 写入异常上抛由调用方呈现；此处接住转 ok:false 且不落盘（settings.update 在后）
              deps.appLog.push('error', 'main', `开机启动设置失败 v${app.getVersion()}：${err instanceof Error ? err.message : String(err)}`)
              if (reboundFrom !== null) {
                rebindHotkey(reboundFrom, deps.onHotkeyToggle)
                syncCommandHotkeys(currentBindings(), reboundFrom, fireCommandHotkey, undefined, hotkeySyncOpts())
              }
              return { ok: false, error: `开机自启设置失败：${err instanceof Error ? err.message : String(err)}` }
            }
          }
          const next = await settings.update(p)
          // outlineEnabled/outlineCustomColor 必须用 !== undefined：false 是合法 falsy 变化，真值判断会漏同步
          if (p.theme || p.transparency || p.outlineEnabled !== undefined || p.outlineWidth !== undefined || p.outlineColor !== undefined || p.outlineCustomColor !== undefined || p.outlineFlowSpeed !== undefined) {
            applyThemeToWindow(next.theme, next.transparency)
            deps.detached.applyThemeToAll(next.theme, next.transparency, {
              enabled: next.outlineEnabled,
              width: next.outlineWidth,
              color: next.outlineColor,
              customColor: next.outlineCustomColor,
              flowSpeed: next.outlineFlowSpeed
            })
            applyThemeToClipboardFlyout(next.theme, next.transparency)
          }
          if (p.appLogoSkin) {
            applyAppLogoSkin(next.appLogoSkin)
            applyTraySkin(next.appLogoSkin)
          }
          if (typeof p.hideOnBlur === 'boolean') {
            applyHideOnBlur(next.hideOnBlur)
          }
          if (p.clipboardPanel) {
            deps.clipboardHistory?.setEnabled(next.clipboardPanel.position !== 'off')
            // 飞窗语义换挡（F6）：非 off 且主窗可见 → 惰性显示；off → 关窗；可见时再锚定一次吃方位切换
            setClipboardFlyoutPosition(next.clipboardPanel.position)
            if (next.clipboardPanel.position !== 'off' && getSearchWindow()?.isVisible()) reanchorClipboardFlyout()
          }
          // 指令热键持久化后重注册（sanitize 在 store 内）；已落盘即 ok:true，部分未生效以 warnings 附带
          let hotkeyNotice: string | null = null
          if (Array.isArray(p.commandHotkeys)) {
            const platform = hotkeyPlatform()
            hotkeyNotice = describeCommandHotkeySync(
              syncCommandHotkeys(
                next.commandHotkeys.map((h) => ({ accel: h[platform], pluginId: h.pluginId, commandId: h.commandId })),
                next.hotkey[platform],
                fireCommandHotkey,
                undefined,
                hotkeySyncOpts()
              )
            )
          }
          broadcast('settings-changed', next)
          return hotkeyNotice ? { ok: true, data: next, warnings: [hotkeyNotice] } : { ok: true, data: next }
        }
        case 'window:hide':
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          hideSearchWindow()
          return { ok: true, data: null }
        case 'window:show':
          // 应用打开失败后由渲染层带回窗口当面报错（打开走先藏后开，失败不能无声）
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          showSearchWindow()
          return { ok: true, data: null }
        case 'hotkey:suspend': {
          // 热键录入期挂起：全局热键先于窗口 keydown，不挂起录不到 Alt+Space 这类组合；
          // win32 另武装 Alt+Space 系统级探针（RegisterHotKey 先于系统菜单通道），捕获走 hotkey-captured 既有白名单通道
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          attachHotkeyCapture()
          const suspended = suspendHotkeys()
          const probe =
            hotkeyPlatform() === 'win32'
              ? armHotkeyProbe('Alt+Space', () => {
                  const wc = getSearchWindow()?.webContents
                  if (wc && !wc.isDestroyed()) wc.send('hotkey-captured', 'Alt+Space')
                })
              : true
          return { ok: true, data: { suspended, probe } }
        }
        case 'hotkey:resume': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          detachHotkeyCapture()
          // 探针必须先于 resume 放开：resume 重注册主键（Alt+Space）时若仍被探针占用会静默失败
          disarmHotkeyProbe()
          return { ok: true, data: resumeHotkeys() }
        }
        case 'window:set-resizable': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          // 插件态放开主窗拉伸；false = 收回并复原固定尺寸
          const p = (req.payload ?? {}) as { resizable?: unknown; minWidth?: unknown; minHeight?: unknown }
          if (typeof p.resizable !== 'boolean') return { ok: false, error: 'resizable 必须是布尔值' }
          const mw = typeof p.minWidth === 'number' ? p.minWidth : undefined
          const mh = typeof p.minHeight === 'number' ? p.minHeight : undefined
          // win32 透明窗放开 OS 拖缘拉伸会使透明失效（Electron 约束，macOS 无此限制）：拒开且不动拉伸态，
          // 大画布走自绘手柄（window:resize-by）或 Detach 独立窗；关拉伸恒放行
          const mainWin = getSearchWindow()
          if (p.resizable && mainWin && process.platform === 'win32' && isTransparentWindow(mainWin)) {
            return { ok: false, error: 'win32 透明窗不支持系统拉伸，请使用窗口内自绘手柄' }
          }
          setSearchWindowResizable(p.resizable, mw, mh)
          if (!p.resizable) restoreSearchWindowSize()
          return { ok: true, data: null }
        }
        case 'window:resize-by': {
          // 插件态自绘手柄的增量拉伸；单次增量夹 ±100 防坏值跳窗
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const p = (req.payload ?? {}) as { dw?: unknown; dh?: unknown }
          const dw = Number(p.dw)
          const dh = Number(p.dh)
          if (!Number.isFinite(dw) || !Number.isFinite(dh)) return { ok: false, error: 'dw/dh 必须是数字' }
          resizeSearchWindowBy(Math.max(-100, Math.min(100, dw)), Math.max(-100, Math.min(100, dh)))
          return { ok: true, data: null }
        }
        case 'app-log:list': {
          // 日志查看器拉取：seq 增量语义见 AppLog.entries；主窗外的独立插件窗只读不许清/推
          const sinceRaw = (req.payload as { since?: unknown } | null)?.since
          const since = typeof sinceRaw === 'number' && Number.isFinite(sinceRaw) && sinceRaw >= 0 ? Math.floor(sinceRaw) : 0
          return { ok: true, data: deps.appLog.entries(since) }
        }
        case 'app-log:clear': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          deps.appLog.clear()
          return { ok: true, data: null }
        }
        case 'app-log:push': {
          // 渲染层 error/unhandledrejection 尽力上报（渲染进程自身不保证存活，主进程兜底可丢）
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const p = (req.payload ?? {}) as { level?: unknown; text?: unknown }
          const level = isAppLogLevel(p.level) ? p.level : 'info'
          const text = typeof p.text === 'string' ? p.text : ''
          if (text !== '') deps.appLog.push(level, 'renderer', text)
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
          // 空态高度联动（§1.5）：主进程夹紧范围防越界，锚定左上角；下限 120 仅防退化报高
          // （0/NaN 级异常），窗口贴内容收口——折叠空态自然高度随渲染段数可低至 ~170，垫高会在底部留空带
          const h = (req.payload as { height?: unknown } | null)?.height
          if (typeof h !== 'number' || !Number.isFinite(h)) return { ok: false, error: 'height 必须是数字' }
          setSearchWindowHeight(Math.min(720, Math.max(120, Math.round(h))))
          return { ok: true, data: null }
        }
        case 'plugin:enter': {
          // detached 窗只许自报本窗插件（深链进入/插件视图自报均满足），防跨窗拉起他人 backend；主窗放行
          const id = (req.payload as { id: string })?.id
          if (!isSearchWindowSender(e)) {
            const owner = deps.detached.pluginIdForWebContents(e.sender.id)
            if (owner === null || id !== owner) return { ok: false, error: '仅插件宿主窗口可调用' }
          }
          if (typeof id === 'string') await loader.ensureBackendStarted(id)
          return { ok: true, data: null }
        }
        case 'plugins:set-enabled': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const { id, enabled } = req.payload as { id: string; enabled: boolean }
          if (enabled) {
            const r = await loader.setEnabled(id, true)
            if (!r.ok) return { ok: false, error: r.error ?? '操作失败' }
          } else {
            await disablePlugin(id)
          }
          const disabled = loader.registry.all().filter((e) => !e.enabled).map((e) => e.manifest.id)
          await settings.update({ disabledPlugins: disabled })
          // 启禁切换后重算指令热键：禁用即注销其绑定（否则热键残留、按下只弹空窗），启用即恢复注册
          syncCommandHotkeys(currentBindings(), settings.settings.hotkey[hotkeyPlatform()], fireCommandHotkey, undefined, hotkeySyncOpts())
          broadcast('plugin-state-changed', { id, enabled, plugins: pluginsSnapshot(loader) })
          return { ok: true, data: null }
        }
        case 'backup:export':
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          return await suspendBlurHide(() => exportBackup())
        case 'backup:import':
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          return await suspendBlurHide(() => importBackup())
        case 'api-services:get':
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          // presets 供设置页表驱动下拉与凭证框渲染；广播 api-services-changed 仍是裸视图形状
          return { ok: true, data: { services: apiCenter.sanitized(), presets: PROVIDER_PRESETS } }
        case 'api-services:open-console': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          // 渲染层只传 type 意图，URL 由主进程 preset 表决定后交 openExternal（assertHttpUrl 双保险）
          const type = (req.payload as { type?: unknown } | null)?.type
          const preset = typeof type === 'string' ? getPreset(type as ProviderType) : undefined
          if (!preset || preset.consoleUrl === null) {
            return { ok: false, error: '该服务商类型没有控制台链接' }
          }
          assertHttpUrl(preset.consoleUrl)
          await services.shell.openExternal(preset.consoleUrl)
          return { ok: true, data: null }
        }
        case 'api-services:upsert-provider': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const p = (req.payload ?? {}) as ProviderForm & { service?: unknown }
          return { ok: true, data: await apiCenter.upsertProvider(p, serviceOf(p.service)) }
        }
        case 'api-services:remove-provider': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const p = (req.payload ?? {}) as { id?: unknown; service?: unknown }
          if (typeof p.id !== 'string' || p.id === '') return { ok: false, error: '缺少服务商 id' }
          return { ok: true, data: await apiCenter.removeProvider(p.id, serviceOf(p.service)) }
        }
        case 'api-services:set-active': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const p = (req.payload ?? {}) as { id?: unknown; service?: unknown }
          if (typeof p.id !== 'string') return { ok: false, error: 'id 必须是字符串（空串 = 回退默认）' }
          return { ok: true, data: await apiCenter.setActive(p.id, serviceOf(p.service)) }
        }
        case 'api-services:test': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const p = (req.payload ?? {}) as { id?: unknown; draft?: ProviderForm; service?: unknown }
          return {
            ok: true,
            data: await apiCenter.testProvider(
              typeof p.id === 'string' && p.id !== '' ? p.id : undefined,
              p.draft,
              serviceOf(p.service)
            )
          }
        }
        // 宿主空态应用栏（ui-style-guide §1.5）：枚举/打开/置顶，与插件能力面无关
        case 'apps:list': {
          const p = (req.payload ?? {}) as { refresh?: unknown }
          return { ok: true, data: await deps.nativeApps.list({ refresh: p.refresh === true }) }
        }
        case 'apps:open': {
          const path = (req.payload as { path?: unknown } | null)?.path
          if (typeof path !== 'string' || path.trim() === '') {
            return { ok: false, error: '缺少应用路径' }
          }
          const isMacApp = path.endsWith('.app')
          const isWinApp = path.toLowerCase().endsWith('.lnk') || path.toLowerCase().endsWith('.exe')
          if (process.platform === 'darwin' && !isMacApp) {
            return { ok: false, error: '缺少 .app 应用路径' }
          }
          if (process.platform === 'win32' && !isWinApp) {
            return { ok: false, error: '缺少 Windows 应用路径 (.lnk / .exe)' }
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
        // 剪贴板文本预检（64K 截断防渲染层逐键全量扫描卡 UI）：设置开=主窗可读
        case 'clipboard:peek': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          if (!settings.settings.clipboardSuggest) return { ok: false, error: '剪贴板推荐已关闭' }
          const text = await services.clipboard.readText()
          return { ok: true, data: text.length > CLIPBOARD_PEEK_MAX_CHARS ? text.slice(0, CLIPBOARD_PEEK_MAX_CHARS) : text }
        }
        // 剪贴板图片探测（主窗呼出即推「悬浮/保存成文件」推荐行）：只回尺寸，dataUrl 不进壳层；设置关=主进程拒读
        case 'clipboard:peek-image': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          if (!settings.settings.clipboardSuggest) return { ok: false, error: '剪贴板推荐已关闭' }
          return { ok: true, data: await services.clipboard.readImageThumb() }
        }
        // 剪贴板 JSON 预检（主窗空态推「JSON 编辑器」行）：非 JSON/敏感文本不出主进程；设置关同上拒读
        case 'clipboard:peek-json': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          if (!settings.settings.clipboardSuggest) return { ok: false, error: '剪贴板推荐已关闭' }
          return { ok: true, data: peekJsonCandidate(await services.clipboard.readText()) }
        }
        // 剪贴板记录面板（宿主 Win+V 式）：只下发 preview 不下发全文；剪贴板敏感故只认主窗 + 剪贴板飞窗（复合守卫）
        case 'clipboard-history:list': {
          if (!isClipboardPanelSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          if (!deps.clipboardHistory) return { ok: false, error: '剪贴板历史服务不可用' }
          return { ok: true, data: deps.clipboardHistory.items() }
        }
        case 'clipboard-history:copy': {
          if (!isClipboardPanelSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          if (!deps.clipboardHistory) return { ok: false, error: '剪贴板历史服务不可用' }
          const id = (req.payload as { id?: unknown } | null)?.id
          if (typeof id !== 'string' || id === '') return { ok: false, error: '缺少条目 id' }
          const hit = await deps.clipboardHistory.copy(id)
          return hit ? { ok: true, data: null } : { ok: false, error: '条目不存在' }
        }
        case 'clipboard-history:remove': {
          if (!isClipboardPanelSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          if (!deps.clipboardHistory) return { ok: false, error: '剪贴板历史服务不可用' }
          const id = (req.payload as { id?: unknown } | null)?.id
          if (typeof id !== 'string' || id === '') return { ok: false, error: '缺少条目 id' }
          deps.clipboardHistory.remove(id)
          return { ok: true, data: null }
        }
        case 'clipboard-history:clear': {
          if (!isClipboardPanelSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          if (!deps.clipboardHistory) return { ok: false, error: '剪贴板历史服务不可用' }
          deps.clipboardHistory.clear()
          return { ok: true, data: null }
        }
        // 自定义背景（题5）：选图走 suspendBlurHide 防对话框触发失焦藏窗；choose/clear 内部 update 后必须
        // 显式广播 settings-changed（F3，广播只在 settings:set 分支自动发生），渲染层不自行补发
        case 'background:choose': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const svc = deps.background
          if (!svc) return { ok: false, error: '背景服务不可用' }
          const parent = getSearchWindow()
          const openOpts = {
            title: '选择背景图片',
            filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg'] }],
            properties: ['openFile' as const]
          }
          return await suspendBlurHide(async () => {
            const r = parent ? await electronDialog.showOpenDialog(parent, openOpts) : await electronDialog.showOpenDialog(openOpts)
            if (r.canceled || r.filePaths.length === 0) return { ok: true, data: null }
            const file = await svc.chooseAndStore(r.filePaths[0])
            const next = await settings.update({ background: { file, enabled: true } })
            broadcast('settings-changed', next)
            return { ok: true, data: { file } }
          })
        }
        case 'background:clear': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const svc = deps.background
          if (!svc) return { ok: false, error: '背景服务不可用' }
          await svc.clear()
          const next = await settings.update({ background: { enabled: false, file: '' } })
          broadcast('settings-changed', next)
          return { ok: true, data: null }
        }
        case 'background:get': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const svc = deps.background
          if (!svc) return { ok: false, error: '背景服务不可用' }
          const b = settings.settings.background
          const dataUrl = b.enabled && b.file !== '' ? await svc.resolveDataUrl(b.file) : null
          return { ok: true, data: { dataUrl, file: b.file, dim: b.dim } }
        }
        // 手动检查更新：不自动外联，只在用户点击时请求 GitHub releases/latest
        case 'update:check': {
          const r = await updater.check()
          if (r.ok) lastCheckDownloadUrl = r.data.downloadUrl // 成功才缓存（含 null 值），失败不清旧值
          return r
        }
        case 'update:download': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          // 渲染层只传意图不传 URL：下载地址只认本进程 update:check 缓存 + 仓库白名单
          if (lastCheckDownloadUrl === null) return { ok: false, error: '请先检查更新' }
          if (!lastCheckDownloadUrl.startsWith(RELEASE_PREFIX)) return { ok: false, error: '更新链接不在本仓库白名单内' }
          return await downloader.start(lastCheckDownloadUrl)
        }
        case 'update:cancel': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          return { ok: true, data: downloader.cancel() }
        }
        case 'update:download-status':
          // 只读快照（对齐 app-log:list 先例），无主窗守卫
          return { ok: true, data: downloader.status() }
        case 'update:install': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          // spawn 等待 + 清理链最长 3s 期间 downloaded 态持续成立，无单飞标记双击会拉起两个安装器
          if (installInFlight) return { ok: false, error: '安装正在进行' }
          const snap = downloader.status()
          if (snap.state !== 'downloaded' || snap.installerPath === null) return { ok: false, error: '安装包尚未下载完成' }
          if (services.app.platform === 'win32') {
            installInFlight = true
            try {
              let child: ReturnType<typeof spawn>
              try {
                child = spawn(snap.installerPath, [], { detached: true, stdio: 'ignore', windowsHide: true })
              } catch (err) {
                // 同步拉起失败（如 ENOENT）不清理不退出，用户可重试
                return { ok: false, error: `安装器拉起失败：${err instanceof Error ? err.message : String(err)}` }
              }
              child.unref()
              // 异步拉起失败（杀软锁文件/EACCES）以 error 事件到达：等 spawn/error 二选一，失败不清理不退出（UI 停在 downloaded 可重试）；
              // error 监听常驻也防迟到的 error 冒泡 uncaughtException
              const spawned = await new Promise<boolean>((res) => {
                child.once('spawn', () => res(true))
                child.once('error', () => res(false))
              })
              if (!spawned) return { ok: false, error: '安装器拉起失败' }
              await runQuitCleanup()
              app.exit(0) // 不调 app.relaunch()：relaunch 会把旧版再拉起来
              return { ok: true, data: null }
            } finally {
              installInFlight = false
            }
          }
          await services.shell.openPath(snap.installerPath)
          return { ok: true, data: null }
        }
        case 'update:open': {
          // 渲染层只传意图不传 URL，目标地址由主进程闭包缓存 + 白名单后交 openExternal
          const target = (req.payload as { target?: unknown } | null)?.target
          if (target !== 'repo' && target !== 'release' && target !== 'download') {
            return { ok: false, error: 'target 必须是 repo/release/download' }
          }
          const r = updater.open(target)
          if (!r.ok) return { ok: false, error: r.error }
          await services.shell.openExternal(r.url)
          return { ok: true, data: null }
        }
        // 重启应用（换常驻 backend 内存态的唯一入口）：仅主搜索窗口可调，防其它子窗拉杀主进程
        case 'app:relaunch': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          app.relaunch()
          // app.exit 不触发 will-quit：退出前手动执行同款清理（runQuitCleanup）
          await runQuitCleanup()
          app.exit(0)
          return { ok: true, data: null }
        }
        // uTools 移植 POC：scan 结果直接下发；serve/stop 管全局静态服务（须主窗调用）
        case 'utools:list': {
          return { ok: true, data: await scanUtoolsPlugins(utoolsPluginsDir(), nodeFs) }
        }
        case 'utools:serve': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const id = (req.payload as { id?: unknown } | null)?.id
          if (typeof id !== 'string' || id === '') return { ok: false, error: '缺少插件 id' }
          const entries = await scanUtoolsPlugins(utoolsPluginsDir(), nodeFs)
          const found = entries.find((e2) => e2.id === id && e2.manifest !== undefined)
          if (!found?.manifest) return { ok: false, error: 'uTools 插件不存在或清单无效' }
          utoolsServerPromise ??= createPluginServer({ rootDir: utoolsPluginsDir(), fsLike: nodeFs }).catch((err) => {
            utoolsServerPromise = null
            throw err
          })
          const server = await utoolsServerPromise
          // 白名单每次 serve 前按最新扫描刷新，目录变动无需重启服务
          server.setPlugins(Object.fromEntries(entries.filter((e2) => e2.manifest).map((e2) => [e2.id, e2.manifest!.main])))
          watchUtoolsOwner(e.sender)
          return { ok: true, data: { url: server.url(id) } }
        }
        case 'utools:stop': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          await stopUtoolsServer()
          return { ok: true, data: null }
        }
        case 'utools:api': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          const p = (req.payload ?? {}) as { action?: unknown; payload?: unknown }
          const inner = (p.payload ?? {}) as { text?: unknown; body?: unknown }
          switch (p.action) {
            case 'copyText':
              if (typeof inner.text !== 'string') return { ok: false, error: 'text 必须是字符串' }
              await services.clipboard.writeText(inner.text)
              return { ok: true, data: null }
            case 'notify':
              if (typeof inner.body !== 'string') return { ok: false, error: 'body 必须是字符串' }
              await services.notification.show('UTools 插件', inner.body)
              return { ok: true, data: null }
            case 'hideMainWindow':
              hideSearchWindow()
              return { ok: true, data: null }
            default:
              return { ok: false, error: `未知 utools api：${String(p.action)}` }
          }
        }
        default:
          return { ok: false, error: `未知宿主 api：${String(req?.api)}` }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
