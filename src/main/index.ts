import { app, BrowserWindow, nativeImage, Notification, screen, shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PluginManifest } from '@sdk/manifest'
import type { PluginBackend } from '@sdk/api'
import { SettingsStore } from './settings-store'
import { PluginLoader } from './plugin-loader'
import { createElectronServices, createNativeAppsIconDecoder, fetchViaNet, PluginStorageService } from './services/electron-services'
import { NativeAppsService, type NativeAppsFs } from './services/native-apps'
import { ApiCenterService, migrateLegacyTranslate } from './services/api-center'
import { ClipboardHistoryService } from './services/clipboard-history'
import { BackgroundService } from './services/background'
import { createBackendContext } from './services/dispatch'
import { setupIpc, broadcast } from './services/ipc'
import {
  applyHideOnBlur,
  bindWindowPositionSink,
  createSearchWindow,
  createDetachedWindow,
  detachedEntryUrl,
  applyThemeToWindow,
  setRememberedWindowPos,
  toggleSearchWindow,
  showSearchWindow,
  hideSearchWindow,
  getSearchWindow
} from './window'
import { closeClipboardFlyout, setClipboardFlyoutPosition } from './clipboard-flyout-window'
import { DetachedWindowManager } from './detached-window-manager'
import { registerHotkey, unregisterAllHotkeys } from './shortcut'
import { createTray } from './tray'
import { applyAppLogoSkin } from './logo-skin'
import { syncLoginItem } from './login-item'
import { AppLog } from './services/app-log'
import { sweepUpdateCache } from './services/update-downloader'

// 日志缓冲建在模块顶层并即刻接管 console：bootstrap 早期输出也要能进设置-日志查看器；
// 原始终端输出保留（先调原方法再入缓冲），进程级兜底异常也入缓冲
const appLog = new AppLog()
appLog.push('info', 'main', `GTools v${app.getVersion()} 启动（${process.platform}）`)

const wrapConsole = (method: 'log' | 'info' | 'warn' | 'error', level: 'info' | 'warn' | 'error'): void => {
  const original = console[method].bind(console)
  console[method] = (...args: unknown[]) => {
    original(...args)
    appLog.push(level, 'main', args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a))).join(' '))
  }
}
wrapConsole('log', 'info')
wrapConsole('info', 'info')
wrapConsole('warn', 'warn')
wrapConsole('error', 'error')

process.on('uncaughtException', (err) => {
  appLog.push('error', 'main', `uncaughtException ${err.name}: ${err.message}\n${err.stack ?? ''}`)
})
process.on('unhandledRejection', (reason) => {
  const text = reason instanceof Error ? `${reason.name}: ${reason.message}\n${reason.stack ?? ''}` : String(reason)
  appLog.push('error', 'main', `unhandledRejection ${text}`)
})

// 构建期展开为实际存在的插件目录：移除 src/plugins/<id>/ 即从产物消失，宿主零改动
const manifestModules = import.meta.glob<{ default: PluginManifest }>('../plugins/*/manifest.ts', { eager: true })
const backendModules = import.meta.glob<{ default: PluginBackend }>('../plugins/*/backend/index.ts')

const builtinManifests: PluginManifest[] = Object.values(manifestModules).map((m) => m.default)

async function loadBackend(id: string): Promise<PluginBackend | null> {
  const loader = backendModules[`../plugins/${id}/backend/index.ts`]
  if (!loader) return null
  const mod = await loader()
  return mod.default
}

let settingsStore: SettingsStore | null = null
let loader: PluginLoader | null = null
let servicesRef: ReturnType<typeof createElectronServices> | null = null
let apiCenterRef: ApiCenterService | null = null
let detachedRef: DetachedWindowManager | null = null

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  const fs = await import('node:fs/promises')
  settingsStore = new SettingsStore(userData, fs)
  try {
    await settingsStore.load()
  } catch (err) {
    // settings.json 被杀软/备份瞬时锁定时拒启不可接受；update/flush 被 loaded 门控不落盘，盘上设置安全，
    // 首个设置变更会重试读取，下次启动亦自动恢复
    console.error('GTools settings.json 读取失败，本会话使用默认设置（不影响已存设置）：', err)
  }

  // api-services-changed 是全窗投递通道（broadcast-channels 注册表）：detached 窗的 host-client 订阅同源可达
  const broadcastApiServices = (): void => {
    broadcast('api-services-changed', apiCenterRef?.sanitized())
  }
  const apiCenter = new ApiCenterService({ dir: userData, fs, fetch: fetchViaNet, notify: broadcastApiServices })
  apiCenterRef = apiCenter
  try {
    await apiCenter.load()
  } catch (err) {
    // api-services.json 被杀软/备份瞬时锁定时拒启不可接受；flush 被 load 门控（未成功加载不落盘），盘上凭证安全，重启自愈
    console.error('GTools api-services.json 读取失败，本会话 API 配置不可见（不影响已存数据）：', err)
  }

  // 0.1.0 插件内翻译配置一次性迁移（旧键原样保留不删；采纳成功落标记封存，清空全局中心后不复活）
  try {
    await migrateLegacyTranslate({
      storage: new PluginStorageService(join(userData, 'storage')),
      isTranslateEmpty: () => apiCenter.isTranslateEmpty(),
      adopt: async (provider) => {
        await apiCenter.adoptMigratedProvider(provider)
        await apiCenter.flush() // 迁移点立即落库，别让标记先于配置持久化
      },
      generateId: () => `u-${randomBytes(4).toString('hex')}`
    })
  } catch (err) {
    // 迁移读旧插件 kv.json 遇瞬时锁等读错时跳过本次即可：标记只在采纳成功后落，下次启动自动重试
    console.error('GTools 旧翻译配置迁移失败（下次启动自动重试）：', err)
  }

  const services = createElectronServices({
    storageRoot: join(userData, 'storage'),
    appVersion: app.getVersion(),
    getWindow: getSearchWindow,
    // F1：主窗显隐唯一出口——插件 window.hide 与截图 hideLauncher 经此收口（连带藏飞窗）
    hideWindow: hideSearchWindow,
    // 插件事件广播面 = 主窗 + 全部独立插件窗（浮窗/遮罩 preload 无订阅面，多发无害）
    listWindows: () => BrowserWindow.getAllWindows(),
    apiCenter
  })
  servicesRef = services

  // 宿主空态应用栏：首次调用 apps:list 才扫描（懒加载，不占启动链）；win32 扫开始菜单 .lnk
  const nativeApps = new NativeAppsService({
    platform: process.platform,
    homeDir: homedir(),
    userDataDir: userData,
    fs: fs as unknown as NativeAppsFs,
    openPath: (p) => shell.openPath(p),
    loadIcon: createNativeAppsIconDecoder()
  })

  // 剪贴板历史采集（面板数据源）：复用 electron clipboard 能力但不扩 ServiceBag 插件面；纯内存，退出即逝
  const clipboardHistory = new ClipboardHistoryService({
    readText: services.clipboard.readText,
    writeText: services.clipboard.writeText,
    readImage: services.clipboard.readImage,
    writeImage: services.clipboard.writeImage,
    // vault 经 writeTextEphemeral 写入的密码/用户名不入面板历史（敏感指纹豁免）
    isExempted: services.clipboard.isTextExempted
  })
  if (settingsStore.settings.clipboardPanel.position !== 'off') clipboardHistory.start()

  // 自定义背景（题5）：固定名重编码产物目录，file 相对名白名单在 settings-store 单点约束
  // fs/promises 重载返回类型与 BackgroundFs 不全一致，显式构造注入对象代替双重断言
  const background = new BackgroundService(
    join(userData, 'backgrounds'),
    {
      readFile: (p) => fs.readFile(p),
      writeFile: (p, data) => fs.writeFile(p, data),
      rm: (p, opts) => fs.rm(p, opts),
      mkdir: (p, opts) => fs.mkdir(p, opts)
    },
    nativeImage
  )

  loader = new PluginLoader({
    builtinManifests,
    loadBackend,
    externalDir: join(userData, 'plugins'),
    createBackendContext: (pluginId) => createBackendContext(loader!.registry, services, pluginId)
  })
  // 装载只做清单注册；resident backend 起动移出启动链（见下方后台任务），窗口/托盘/热键先就绪
  await loader.load(settingsStore.settings.disabledPlugins, { startResidentBackends: false })

  applyHideOnBlur(settingsStore.settings.hideOnBlur)
  // 主窗位置记忆：启动注入上次位置，拖动后经 settings 持久化（防抖内建）
  setRememberedWindowPos(settingsStore.settings.windowPos)
  bindWindowPositionSink((p) => {
    void settingsStore?.update({ windowPos: p }).catch((err) => console.error('GTools windowPos 保存失败（不影响已存设置）：', err))
  })
  // 先镜像主题/透明再建窗（透明标志/材质依赖当前设置），建窗后自身完成材质应用
  applyThemeToWindow(settingsStore.settings.theme, settingsStore.settings.transparency)
  applyAppLogoSkin(settingsStore.settings.appLogoSkin)
  createSearchWindow()
  // 飞窗方位与设置对齐：主窗此刻不可见 → 仅记录，首次 showSearchWindow 惰性显示（F6 语义）
  setClipboardFlyoutPosition(settingsStore.settings.clipboardPanel.position)

  // 插件独立窗口管理器（每插件单实例，禁用插件/退出时统一回收）
  const detached = new DetachedWindowManager({
    createWindow: createDetachedWindow,
    getWorkArea: () => screen.getPrimaryDisplay().workArea,
    entryUrlFor: detachedEntryUrl
  })
  detachedRef = detached

  createTray(
    () => {
      showSearchWindow()
      getSearchWindow()?.webContents.send('host:open-settings')
    },
    settingsStore.settings.appLogoSkin
  )

  const hotkey = settingsStore.settings.hotkey[process.platform === 'darwin' ? 'darwin' : 'win32']
  const r = registerHotkey(hotkey, toggleSearchWindow)
  if (!r.ok) {
    new Notification({ title: 'GTools', body: r.error ?? '快捷键注册失败' }).show()
  }

  setupIpc({
    loader,
    settings: settingsStore,
    services,
    apiCenter,
    nativeApps,
    clipboardHistory,
    background,
    detached,
    appLog,
    onHotkeyToggle: toggleSearchWindow
  })

  // 登录项同步可能同步阻塞（mac osascript 5s 超时面），setImmediate 挪出启动关键路径；
  // 失败不阻断主功能（区别于快捷键失败弹通知），显式入 appLog（不经 console 包装，防同义双条目）
  const wantLaunchAtLogin = settingsStore.settings.launchAtLogin
  setImmediate(() => {
    try {
      syncLoginItem(app, wantLaunchAtLogin)
    } catch (err) {
      appLog.push('error', 'main', `开机启动设置失败 v${app.getVersion()}：${err instanceof Error ? err.message : String(err)}`)
    }
  })

  // resident backend 后台起（init/start 可能耗时），失败只记日志不杀宿主；此时 IPC 已注册，
  // 插件进入路径会经 ensureBackendStarted 的 in-flight 复用搭上同一次启动
  void loader.startResidentBackends().catch((err) => {
    console.error('GTools 常驻 backend 启动失败：', err)
  })

  // 清扫上次更新中断残留的 *.part，失败不阻塞启动
  void sweepUpdateCache(fs, join(userData, 'update-cache')).catch((err) => {
    console.error('GTools 更新缓存清扫失败：', err)
  })

  if (loader.externalDetected.length > 0) {
    const names = loader.externalDetected.map((d) => d.manifest.name).join('、')
    new Notification({ title: 'GTools', body: `检测到外部插件：${names}（动态加载将在后续版本支持）` }).show()
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 无窗期（启动极早期）补建窗口再显，防唤起静默失效
    if (!getSearchWindow()) createSearchWindow()
    showSearchWindow()
  })

  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.hide()
    // 启动链兜底：半途失败不留无托盘无快捷键的僵尸进程，通知后退出
    void bootstrap().catch((err) => {
      console.error('GTools 启动失败：', err)
      const message = err instanceof Error ? err.message : String(err)
      try {
        new Notification({ title: 'GTools 启动失败', body: message }).show()
      } catch {
        // Notification 也不可用时只剩日志
      }
      setTimeout(() => app.exit(1), 3000)
    })
  })

  // 主窗口只隐藏不销毁；注册空监听阻止 all-closed 默认退出（托盘常驻的唯一退出口）
  app.on('window-all-closed', () => {})

  app.on('before-quit', () => {
    unregisterAllHotkeys()
    // 退出放行独立窗的 close 拦截（app.quit 先逐窗 close 再 will-quit，拦下会中止退出）
    detachedRef?.markQuitting()
  })

  app.on('will-quit', (e) => {
    // 阻止默认退出，等防抖中的 settings 落盘与 backend 收尾完成再真正退出；3s 超时兜底防挂起
    e.preventDefault()
    let exited = false
    const exit = (): void => {
      if (exited) return
      exited = true
      app.exit(0)
    }
    const timer = setTimeout(exit, 3000)
    void (async () => {
      try {
        closeClipboardFlyout() // 飞窗随退出回收
        servicesRef?.window.float.closeAll() // 退出前关全部浮窗，防残留
        detachedRef?.closeAll() // 独立插件窗口同样全量回收
        await loader?.disposeAll()
        await settingsStore?.flush()
        await apiCenterRef?.flush()
      } finally {
        clearTimeout(timer)
        exit()
      }
    })()
  })
}
