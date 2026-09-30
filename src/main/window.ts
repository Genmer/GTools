import { BrowserWindow, nativeTheme, screen } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ThemeName, TransparencySettings } from './settings-store'
import { DEFAULT_TRANSPARENCY } from '@sdk/settings'
import type { DetachedWindowLike, DetachedWindowOptions } from './detached-window-manager'

// 内容口径 800×560 为四期 uTools 视觉规范（docs/design/ui-style-guide.md §1.1）。
// 透明窗的 OS 窗口比内容大一圈透明边距，外圈投影落进边距才可见（Electron 透明+无边框窗
// DWM 不给影，setHasShadow 在 Windows 路径是空操作）；不透明窗零改动（DWM 系统投影为主）。
// base.css 的 html[data-wintx='1'] #app padding 与 MARGIN 必须一致，两处手改需同步
const CONTENT_W = 800
const CONTENT_H = 560
const MARGIN_X = 32
const MARGIN_TOP = 32
const MARGIN_BOTTOM = 48
const WINDOW_W = CONTENT_W + MARGIN_X * 2
const WINDOW_H = CONTENT_H + MARGIN_TOP + MARGIN_BOTTOM

// 深度链接注入：GTOOLS_DEEP_LINK 传 hash 体（不含 #），如 'plugin=calc&q=1%2B1&demo=1'，截图/自动化入口
const deepLinkHash = process.env.GTOOLS_DEEP_LINK?.trim() || ''

let win: BrowserWindow | null = null
let lastShownAt = 0

/** 失焦自动隐藏的模块内镜像（设置页开关即时生效，只约束主窗） */
let hideOnBlurEnabled = true

export function applyHideOnBlur(v: boolean): void {
  hideOnBlurEnabled = v
}

// 原生对话框附着 parent 夺焦会触发父窗 blur（win32 尤其），计数>0 期间失焦不隐藏
let suspendBlurHideCount = 0

export function suspendBlurHide<T>(fn: () => Promise<T>): Promise<T> {
  suspendBlurHideCount++
  return fn().finally(() => {
    suspendBlurHideCount--
  })
}

// ESM 主进程无 __dirname，preload 相对 bundle 产物定位（out/main → out/preload）
const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))

/**
 * 透明窗判定 + 圆角分治（详见上）：
 * - darwin 恒透明窗：磨霜靠 CSS backdrop-filter 采样桌面，窗口必须透明；不透明窗叠 alpha 底色
 *   会在显隐/缩放时闪烁（实测白闪根因）；且 macOS 没有 Win32「透明窗不可拖缘拉伸」约束
 * - win32/linux：模糊关闭的透明档与玻璃清透档才要透明标志；带模糊走不透明窗+系统材质（DWM acrylic 只给不透明窗）
 */
function wantsTransparentFlag(tx: TransparencySettings, theme: ThemeName): boolean {
  if (process.platform === 'darwin') return true
  return (tx.enabled || theme === 'glass') && !tx.blur
}

// Electron 无 isTransparent()：创建时带透明标志的窗口记入此表，材质应用时判断能否直透桌面
const transparentWindows = new WeakSet<object>()

/** 把窗口真实透明标志同步给渲染层（html[data-wintx]）：CSS 据此决定根圆角画不画——
 *  透明窗画（四角透空），不透明窗不画（内容满幅交 OS 裁弧，双弧夹层露底色即「圆角主体+直角边」穿帮根因） */
function syncWindowTransparentFlag(target: BrowserWindow): void {
  const flag = transparentWindows.has(target) ? '1' : '0'
  target.webContents
    .executeJavaScript(`document.documentElement.dataset.wintx = '${flag}'; undefined`, true)
    .catch(() => {
      // 页面未就绪/导航竞态：dom-ready 监听会再同步
    })
}

function bindTransparentFlagSync(target: BrowserWindow): void {
  target.webContents.on('dom-ready', () => syncWindowTransparentFlag(target))
  syncWindowTransparentFlag(target)
}

export function createSearchWindow(): BrowserWindow {
  if (win) return win
  const { workArea } = screen.getPrimaryDisplay()
  const transparent = wantsTransparentFlag(currentTransparency, currentTheme)
  // 透明窗加投影边距；不透明窗维持内容尺寸（uiFixes：外圈投影为透明窗专属，不透明窗零改动）
  const width = transparent ? WINDOW_W : CONTENT_W
  const height = transparent ? WINDOW_H : CONTENT_H
  win = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height * 0.28),
    frame: false,
    resizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    transparent,
    // 透明窗只留 CSS 阴影：macOS 原生影按含阴影 alpha 的整窗矩形生成，与 CSS 影叠加成又硬又大的方框
    hasShadow: !transparent,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
      // 不设 backgroundThrottling:false——它会让隐藏窗口的 document 恒为 visible，
      // visibilitychange（弹出后焦点重置等）全部失效
    }
  })
  if (transparent) transparentWindows.add(win)

  applyThemeToBrowserWindow(win, currentTheme)
  bindTransparentFlagSync(win)
  win.on('blur', () => {
    // macOS 刚 show() 瞬间可能有一次假 blur，200ms 内忽略
    if (Date.now() - lastShownAt < 200) return
    if (suspendBlurHideCount > 0 || !hideOnBlurEnabled) return
    hideSearchWindow()
  })
  win.on('closed', () => {
    win = null
  })
  // 容器插件页可发起顶层导航/弹窗：SPA 只认本渲染源，其余一律拦下（iframe sandbox 为第一道防线）
  const rendererOrigin = process.env.ELECTRON_RENDERER_URL ?? 'file://'
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(rendererOrigin)) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL
    const url = deepLinkHash ? `${base}#${deepLinkHash}` : base
    const load = (): void => {
      win?.loadURL(url).catch(() => {
        setTimeout(load, 200)
      })
    }
    load()
  } else {
    const file = fileURLToPath(new URL('../renderer/index.html', import.meta.url))
    void win.loadFile(file, deepLinkHash ? { hash: deepLinkHash } : undefined)
  }
  return win
}

export function getSearchWindow(): BrowserWindow | null {
  return win
}

export function showSearchWindow(): void {
  if (!win) return
  win.show()
  win.focus()
  lastShownAt = Date.now()
}

export function hideSearchWindow(): void {
  win?.hide()
}

/** 外壳按态请求窗口高度（空态应用网格加高，ui-style-guide §1.5）：锚定左上角只改高，超出工作区由系统夹紧。
 *  渲染层报的是内容口径（透明窗已扣边距），透明窗在此加回 MARGIN */
export function setSearchWindowHeight(height: number): void {
  if (!win) return
  const margin = transparentWindows.has(win) ? MARGIN_TOP + MARGIN_BOTTOM : 0
  const [x, y] = win.getPosition()
  win.setBounds({ x, y, width: transparentWindows.has(win) ? WINDOW_W : CONTENT_W, height: Math.round(height) + margin })
}

/**
 * 插件模式临时放开主窗拉伸（Detach 等插件场景需要更大画布），非插件态经 restoreSearchWindowSize 复原。
 * 可用性按窗口透明性：不透明窗（默认 亚克力/实色）三平台均可拖缘拉伸；透明窗（无模糊/玻璃）在
 * Win32 放开拉伸可能使透明窗失效（Electron 官方约束），维持不可拉伸，大画布走 Ctrl+D Detach 独立窗。
 */
export function setSearchWindowResizable(resizable: boolean, minWidth?: number, minHeight?: number): void {
  if (!win) return
  win.setResizable(resizable)
  if (resizable && typeof minWidth === 'number' && typeof minHeight === 'number') {
    win.setMinimumSize(minWidth, minHeight)
  }
}

/** 退出插件态复原固定尺寸并锚定左上角（高度回内容 560 的窗口口径，空态/结果态由渲染层再报高） */
export function restoreSearchWindowSize(): void {
  if (!win) return
  win.setMinimumSize(0, 0)
  win.setResizable(false)
  const transparent = transparentWindows.has(win)
  const [x, y] = win.getPosition()
  win.setBounds({ x, y, width: transparent ? WINDOW_W : CONTENT_W, height: transparent ? WINDOW_H : CONTENT_H })
}

export function toggleSearchWindow(): void {
  if (win && win.isVisible()) hideSearchWindow()
  else showSearchWindow()
}

/** 当前主题/透明设置的模块内镜像：独立窗口晚于设置切换创建时（detach），创建参数需读到最新值 */
let currentTheme: ThemeName = 'light'
let currentTransparency: TransparencySettings = { ...DEFAULT_TRANSPARENCY }

/**
 * 主题×透明联动单个窗口原生效果（主窗/独立窗共用）——不截图不读壁纸：
 * - 磨霜：win32 不透明窗走 DWM acrylic；macOS 不用 vibrancy（整窗矩形磨霜会越出卡片圆角边距，
 *   即实测的「外圈玻璃块」），霜面由渲染层 .app/.detached 的 CSS backdrop-filter 实时采样桌面承担
 * - 模糊关：透明窗直透桌面（clear 效果）；win32 不透明档回退主题底色
 */
export function applyThemeToBrowserWindow(target: BrowserWindow, theme: ThemeName, tx: TransparencySettings = currentTransparency): void {
  syncWindowTransparentFlag(target)
  // 原生实时模糊：透明开+模糊，或玻璃磨砂档（玻璃强制视为透明开）
  const nativeBlur = tx.blur && (tx.enabled || theme === 'glass')
  const transparent = transparentWindows.has(target)
  try {
    if (process.platform === 'darwin') {
      // 不设 vibrancy：它按整窗矩形生效，会把磨砂延伸到卡片外的透明边距（终审实测的外圈玻璃块）；
      // 磨砂全由 CSS backdrop-filter 在卡片上实时采样桌面承担，blur 开关走 data-blur
      target.setVibrancy(null)
      // darwin 恒透明窗：alpha 底色让桌面从页面半透明涂层下透出
      target.setBackgroundColor('#00000000')
    } else {
      try {
        // Win11 acrylic 只给不透明窗；DWM tint 亮度只跟系统明暗（与 nativeTheme.themeSource 无关）
        if (nativeBlur && !transparent) target.setBackgroundMaterial('acrylic')
      } catch {
        // 旧版 Windows 无此 API，忽略
      }
      target.setBackgroundColor(transparent ? '#00000000' : theme === 'dark' ? '#1e1e1e' : '#f2f3f5')
    }
  } catch {
    // 窗口效果失败不阻塞主题切换（CSS 变量仍生效）
  }
}

export function applyThemeToWindow(theme: ThemeName, transparency?: TransparencySettings): void {
  currentTheme = theme
  if (transparency) currentTransparency = { ...transparency }
  // themeSource 只影响渲染层原生控件的明暗感知；DWM 亚克力 tint 只跟系统明暗，别指望在此控制霜色
  try {
    nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light'
  } catch {
    // 设置失败不影响 CSS 主题
  }
  if (!win) return
  // 透明↔不透明类别跟窗口创建时定死（Win 透明窗不可事后补标志）：跨类别切换只能重建窗口（darwin 恒透明不会走到）
  if (transparentWindows.has(win) !== wantsTransparentFlag(currentTransparency, currentTheme)) {
    recreateSearchWindow()
    return
  }
  applyThemeToBrowserWindow(win, theme)
}

/** 销毁并按最新镜像重建主窗；原可见则复显（win32 透明类别切换专用，darwin 恒透明不会走到） */
function recreateSearchWindow(): void {
  if (!win) return
  const wasVisible = win.isVisible()
  const old = win
  win = null
  old.destroy()
  createSearchWindow()
  if (wasVisible) showSearchWindow()
}

/** 独立插件窗口：titleBarStyle hidden 保留 macOS 交通灯（渲染层顶栏做 70px 避让），安全配置与主窗一致；透明+无模糊模式创建即带透明标志 */
export function createDetachedWindow(opts: DetachedWindowOptions): DetachedWindowLike {
  const transparent = wantsTransparentFlag(currentTransparency, currentTheme)
  const w = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    x: opts.x,
    y: opts.y,
    titleBarStyle: 'hidden',
    show: false,
    minWidth: 360,
    minHeight: 240,
    transparent,
    // 与主窗同因：透明窗关原生影，防原生整窗矩形影与 CSS 影叠加出方框
    hasShadow: !transparent,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  if (wantsTransparentFlag(currentTransparency, currentTheme)) transparentWindows.add(w)
  if (opts.alwaysOnTop) w.setAlwaysOnTop(true, 'floating')
  applyThemeToBrowserWindow(w, currentTheme)
  bindTransparentFlagSync(w)
  return {
    webContentsId: w.webContents.id,
    webContents: { send: (channel, payload) => w.webContents.send(channel, payload) },
    loadURL: (url) => void w.loadURL(url),
    show: () => w.show(),
    focus: () => w.focus(),
    setAlwaysOnTop: (v, level) => w.setAlwaysOnTop(v, level ?? 'floating'),
    applyTheme: (theme, tx) => applyThemeToBrowserWindow(w, theme, tx),
    close: () => w.close(),
    destroy: () => w.destroy(),
    isDestroyed: () => w.isDestroyed(),
    on: (event, cb) => {
      w.on(event, cb)
    }
  }
}

/** 独立窗口入口：与主窗同一 renderer 页，hash 携带 detached 参数（deep-link.ts 解析进插件态） */
export function detachedEntryUrl(pluginId: string, query: string): string {
  const hash = `detached=true&plugin=${encodeURIComponent(pluginId)}&query=${encodeURIComponent(query)}`
  if (process.env.ELECTRON_RENDERER_URL) return `${process.env.ELECTRON_RENDERER_URL}#${hash}`
  const file = fileURLToPath(new URL('../renderer/index.html', import.meta.url))
  return `${pathToFileURL(file).href}#${hash}`
}
