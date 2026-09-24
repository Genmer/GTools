import { app, Notification, screen, shell } from 'electron'
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
import { createBackendContext } from './services/dispatch'
import { setupIpc } from './services/ipc'
import {
  createSearchWindow,
  createDetachedWindow,
  detachedEntryUrl,
  applyThemeToWindow,
  toggleSearchWindow,
  showSearchWindow,
  getSearchWindow
} from './window'
import { DetachedWindowManager } from './detached-window-manager'
import { registerHotkey, unregisterAllHotkeys } from './shortcut'
import { createTray } from './tray'

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
  await settingsStore.load()

  const broadcastApiServices = (): void => {
    getSearchWindow()?.webContents.send('api-services-changed', apiCenterRef?.sanitized())
  }
  const apiCenter = new ApiCenterService({ dir: userData, fs, fetch: fetchViaNet, notify: broadcastApiServices })
  apiCenterRef = apiCenter
  await apiCenter.load()

  // 0.1.0 插件内翻译配置一次性迁移（旧键原样保留不删；采纳成功落标记封存，清空全局中心后不复活）
  await migrateLegacyTranslate({
    storage: new PluginStorageService(join(userData, 'storage')),
    isTranslateEmpty: () => apiCenter.isTranslateEmpty(),
    adopt: async (provider) => {
      await apiCenter.adoptMigratedProvider(provider)
      await apiCenter.flush() // 迁移点立即落库，别让标记先于配置持久化
    },
    generateId: () => `u-${randomBytes(4).toString('hex')}`
  })

  const services = createElectronServices({
    storageRoot: join(userData, 'storage'),
    appVersion: app.getVersion(),
    getWindow: getSearchWindow,
    apiCenter
  })
  servicesRef = services

  // 宿主空态应用栏：首次调用 apps:list 才扫描（懒加载，不占启动链）；win32 返回空列表
  const nativeApps = new NativeAppsService({
    platform: process.platform,
    homeDir: homedir(),
    userDataDir: userData,
    fs: fs as unknown as NativeAppsFs,
    openPath: (p) => shell.openPath(p),
    loadIcon: createNativeAppsIconDecoder()
  })

  loader = new PluginLoader({
    builtinManifests,
    loadBackend,
    externalDir: join(userData, 'plugins'),
    createBackendContext: (pluginId) => createBackendContext(loader!.registry, services, pluginId)
  })
  await loader.load(settingsStore.settings.disabledPlugins)

  createSearchWindow()
  applyThemeToWindow(settingsStore.settings.theme)

  // 插件独立窗口管理器（每插件单实例，禁用插件/退出时统一回收）
  const detached = new DetachedWindowManager({
    createWindow: createDetachedWindow,
    getWorkArea: () => screen.getPrimaryDisplay().workArea,
    entryUrlFor: detachedEntryUrl
  })
  detachedRef = detached

  createTray(() => {
    showSearchWindow()
    getSearchWindow()?.webContents.send('host:open-settings')
  })

  const hotkey = settingsStore.settings.hotkey[process.platform === 'darwin' ? 'darwin' : 'win32']
  const r = registerHotkey(hotkey, toggleSearchWindow)
  if (!r.ok) {
    new Notification({ title: 'GTools', body: r.error ?? '快捷键注册失败' }).show()
  }

  setupIpc({ loader, settings: settingsStore, services, apiCenter, nativeApps, detached, onHotkeyToggle: toggleSearchWindow })

  if (loader.externalDetected.length > 0) {
    const names = loader.externalDetected.map((d) => d.manifest.name).join('、')
    new Notification({ title: 'GTools', body: `检测到外部插件：${names}（动态加载将在后续版本支持）` }).show()
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showSearchWindow())

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
