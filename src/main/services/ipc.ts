import { ipcMain, dialog as electronDialog, app } from 'electron'
import { homedir } from 'node:os'
import * as nodeFs from 'node:fs/promises'
import { dirname, join, sep as pathSep } from 'node:path'
import type { PluginManifest } from '@sdk/manifest'
import type { ApiCallResult } from '@sdk/api'
import type { PluginLoader } from '../plugin-loader'
import type { SettingsStore, AppSettings, ThemeName, CommandHotkey } from '../settings-store'
import type { ServiceBag } from './dispatch'
import { dispatchApi } from './dispatch'
import type { ApiCenterService, ProviderForm } from './api-center'
import type { NativeAppsService } from './native-apps'
import type { DetachedWindowManager } from '../detached-window-manager'
import {
  applyHideOnBlur,
  applyThemeToWindow,
  getSearchWindow,
  hideSearchWindow,
  restoreSearchWindowSize,
  setSearchWindowHeight,
  setSearchWindowResizable,
  showSearchWindow,
  suspendBlurHide
} from '../window'
import { rebindHotkey, suspendHotkeys, resumeHotkeys, armHotkeyProbe, disarmHotkeyProbe, syncCommandHotkeys, type CommandHotkeySyncResult } from '../shortcut'
import { createHotkeyCapture, type HotkeyCaptureHandler } from '../hotkey-capture'
import { syncLoginItem } from '../login-item'
import {
  defaultBackupFileName,
  parseBackup,
  restorePathTokens,
  serializeBackup,
  tokenizePathValues
} from './backup'
import { createUpdater } from './updater'

export interface HostInitResult {
  version: string
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

// warnings 只在非空时附带：旧消费方按字段存在性判断，空数组也会被误判为「有警告」
type HostResult<T = unknown> = { ok: true; data: T; warnings?: string[] } | { ok: false; error: string }

function pluginsSnapshot(loader: PluginLoader): { manifest: PluginManifest; enabled: boolean }[] {
  return loader.registry.all().map((e) => ({ manifest: e.manifest, enabled: e.enabled }))
}

function broadcast(channel: string, payload: unknown): void {
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
  detached: DetachedWindowManager
  onHotkeyToggle: () => void
}): void {
  const { loader, settings, services, apiCenter } = deps

  // 更新检测：fetch/openExternal/version/platform 全走 ServiceBag 注入面（测试可 fake）；闭包缓存随 setupIpc 生命周期
  const updater = createUpdater({
    fetch: services.net.fetch,
    version: services.app.version,
    platform: services.app.platform,
    arch: services.app.arch
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
          filters: [{ name: 'GTools 备份', extensions: ['gtools', 'json'] }]
        })
      : await electronDialog.showSaveDialog({
          title: '导出 GTools 备份',
          defaultPath: defaultBackupFileName(),
          filters: [{ name: 'GTools 备份', extensions: ['gtools', 'json'] }]
        })
    if (r.canceled || !r.filePath) return { ok: true, data: { path: null } }
    await nodeFs.mkdir(dirname(r.filePath), { recursive: true })
    await nodeFs.writeFile(r.filePath, JSON.stringify(tokenized, null, 2), { encoding: 'utf-8' })
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
    let commandSkipped: string | null = null
    const nextSettings = await settings.update({
      theme: backup.settings.theme,
      transparency: backup.settings.transparency,
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
    for (const [pid, kv] of Object.entries(backup.pluginStorage)) {
      await services.storage.replaceAll(pid, kv)
    }

    // v1 备份无 apiServices 段：保留本机现状不动；有则 sanitize 后整体替换，完成即广播（内存态即时生效）
    if (backup.apiServices !== undefined) {
      await apiCenter.replaceAll(backup.apiServices)
    }

    applyThemeToWindow(nextSettings.theme, nextSettings.transparency)
    deps.detached.applyThemeToAll(nextSettings.theme, nextSettings.transparency)
    broadcast('settings-changed', nextSettings)
    broadcast('plugin-state-changed', { plugins: pluginsSnapshot(loader) })
    // 常驻 backend 内存态（如剪贴板历史）不会自动重载导入的数据
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
            settings: settings.settings,
            plugins: pluginsSnapshot(loader),
            loadIssues: loader.issues.map((i) => ({ pluginId: i.pluginId, message: `${i.field}: ${i.message}` })),
            externalDetected: loader.externalDetected.map((d) => ({ id: d.manifest.id, name: d.manifest.name }))
          }
          return { ok: true, data }
        }
        case 'settings:set': {
          const p = (req.payload ?? {}) as {
            theme?: ThemeName
            transparency?: Partial<AppSettings['transparency']>
            hotkey?: Partial<AppSettings['hotkey']>
            launchAtLogin?: boolean
            clipboardSuggest?: boolean
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
              if (reboundFrom !== null) {
                rebindHotkey(reboundFrom, deps.onHotkeyToggle)
                syncCommandHotkeys(currentBindings(), reboundFrom, fireCommandHotkey, undefined, hotkeySyncOpts())
              }
              return { ok: false, error: `开机自启设置失败：${err instanceof Error ? err.message : String(err)}` }
            }
          }
          const next = await settings.update(p)
          if (p.theme || p.transparency) {
            applyThemeToWindow(next.theme, next.transparency)
            deps.detached.applyThemeToAll(next.theme, next.transparency)
          }
          if (typeof p.hideOnBlur === 'boolean') {
            applyHideOnBlur(next.hideOnBlur)
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
          // 空态高度联动（§1.5）：主进程夹紧范围防越界，锚定左上角；下限 120 仅防退化报高
          // （0/NaN 级异常），窗口贴内容收口——折叠空态自然高度随渲染段数可低至 ~170，垫高会在底部留空带
          const h = (req.payload as { height?: unknown } | null)?.height
          if (typeof h !== 'number' || !Number.isFinite(h)) return { ok: false, error: 'height 必须是数字' }
          setSearchWindowHeight(Math.min(720, Math.max(120, Math.round(h))))
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
          // 启禁切换后重算指令热键：禁用即注销其绑定（否则热键残留、按下只弹空窗），启用即恢复注册
          syncCommandHotkeys(currentBindings(), settings.settings.hotkey[hotkeyPlatform()], fireCommandHotkey, undefined, hotkeySyncOpts())
          broadcast('plugin-state-changed', { id, enabled, plugins: pluginsSnapshot(loader) })
          return { ok: true, data: null }
        }
        case 'backup:export':
          return await suspendBlurHide(() => exportBackup())
        case 'backup:import':
          return await suspendBlurHide(() => importBackup())
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
        // 剪贴板推荐（宿主 UI 单次读取）：读完即返回，不落盘不缓存；剪贴板敏感故只认主搜索窗口
        case 'clipboard:peek': {
          if (!isSearchWindowSender(e)) return { ok: false, error: '仅主搜索窗口可调用' }
          return { ok: true, data: await services.clipboard.readText() }
        }
        // 手动检查更新：不自动外联，只在用户点击时请求 GitHub releases/latest
        case 'update:check':
          return await updater.check()
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
          app.exit(0)
          return { ok: true, data: null }
        }
        default:
          return { ok: false, error: `未知宿主 api：${String(req?.api)}` }
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
