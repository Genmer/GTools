import { BrowserWindow, nativeTheme, screen } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { GlassMaterial, ThemeName, TransparencySettings } from './settings-store'
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
 * 透明+无模糊模式、以及玻璃主题的壁纸折射模式（win32 上 acrylic 材质是不透明窗）需要窗口透明标志。
 * 圆角取舍（四角无瑕疵 vs Win 拖缘拉伸）按窗口透明性分治：
 * - 透明窗：四角靠 CSS 圆角真正透空（任意半径、Win10 也圆），但 Win32 透明窗不可拖缘调整
 *   大小（Electron 官方约束 setResizable(true) 可能使透明窗失效）→ 主窗插件态拉伸在这类窗口上放弃。
 * - 不透明窗（默认 亚克力/实色）：内容满幅、圆角交 OS 裁剪（Win11 DWMWCP_ROUND / macOS 系统弧；
 *   Win10 无 DWM 圆角 API 降级方角），Win32 拖缘拉伸照常可用。
 */
function wantsTransparentFlag(tx: TransparencySettings, theme: ThemeName, gm: GlassMaterial): boolean {
  // 玻璃 acrylic 档恒不透明（材质即玻璃身景，透明档语义不适用），glass 的 wallpaper/clear 档恒透明
  return (tx.enabled && !tx.blur && theme !== 'glass') || (theme === 'glass' && gm !== 'acrylic')
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
  const transparent = wantsTransparentFlag(currentTransparency, currentTheme, currentGlassMaterial)
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
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
      // 不设 backgroundThrottling:false——它会让隐藏窗口的 document 恒为 visible，
      // visibilitychange（弹出抓帧+焦点重置等）全部失效；隐藏期节流对流取帧的影响实测可接受
    }
  })
  if (transparent) transparentWindows.add(win)

  applyThemeToBrowserWindow(win, currentTheme)
  bindTransparentFlagSync(win)
  // show:false 窗口首次显隐前页面 visibilityState 会卡 visible（Electron 怪癖，visibilitychange 不可靠），
  // 玻璃快照流的养流/抓帧联动改由主进程窗口事件驱动（永远可靠）；closed 置空 win 不影响闭包内常量引用
  const liveWin = win
  win.on('show', () => liveWin.webContents.send('host:win-visibility', true))
  win.on('hide', () => liveWin.webContents.send('host:win-visibility', false))
  win.on('blur', () => {
    // macOS 刚 show() 瞬间可能有一次假 blur，200ms 内忽略
    if (Date.now() - lastShownAt < 200) return
    if (suspendBlurHideCount > 0 || !hideOnBlurEnabled) return
    hideSearchWindow()
  })
  win.on('closed', () => {
    win = null
  })

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

/** 当前主题/透明/玻璃材质的模块内镜像：独立窗口晚于设置切换创建时（detach），创建参数需读到最新值 */
let currentTheme: ThemeName = 'light'
let currentTransparency: TransparencySettings = { ...DEFAULT_TRANSPARENCY }
let currentGlassMaterial: GlassMaterial = 'wallpaper'

/**
 * 主题×透明联动单个窗口原生效果（主窗/独立窗共用）：
 * - 透明关：不透明主题底色
 * - 透明开+实时模糊：Win11 亚克力 / macOS vibrancy（不需要窗口透明标志，不影响拖缘调整大小）
 * - 透明开+模糊关：透明标志窗口直透桌面（材质保持默认 auto，绝不调 setBackgroundMaterial——
 *   fresh 透明窗设 'none' 实测白板且 'auto' 救不回）；运行时才关模糊的窗口没有透明标志
 *   （Windows 透明窗口不可拖缘调整大小，无法事后补），回退主题底色
 * - glass 壁纸折射模式：恒透明窗+不设任何原生材质，折射源是页内壁纸层（原生模糊只会盖掉折射，见 themes.css）
 * - glass 亚克力模式：不透明窗+系统 acrylic 实时身景（win32 实时背后的唯一安全路，透明窗+防捕获
 *   在 hide/show 循环下 DWM 整窗渲黑），材质应用与 light 的透明+模糊档完全同参
 */
export function applyThemeToBrowserWindow(
  target: BrowserWindow,
  theme: ThemeName,
  tx: TransparencySettings = currentTransparency,
  gm: GlassMaterial = currentGlassMaterial
): void {
  const opaque = theme === 'glass' ? '#e9eef5' : theme === 'dark' ? '#1e1e1e' : '#f2f3f5'
  syncWindowTransparentFlag(target)
  // 原生实时模糊：light/dark 的「透明+模糊开」档，或 glass 的亚克力模式
  const acrylicGlass = theme === 'glass' && gm === 'acrylic'
  const nativeBlur = (theme !== 'glass' && tx.enabled && tx.blur) || acrylicGlass
  const transparent = transparentWindows.has(target)
  try {
    if (process.platform === 'darwin') {
      target.setVibrancy(nativeBlur && !transparent ? 'under-window' : null)
      target.setBackgroundColor(nativeBlur || transparent ? '#00000000' : opaque)
    } else {
      try {
        // Win11 acrylic 只给不透明窗；DWM tint 亮度只跟系统明暗（与 nativeTheme.themeSource 无关）
        if (nativeBlur && !transparent) target.setBackgroundMaterial('acrylic')
      } catch {
        // 旧版 Windows 无此 API，忽略
      }
      target.setBackgroundColor(transparent || (tx.enabled && !tx.blur && !nativeBlur) ? '#00000000' : opaque)
    }
  } catch {
    // 窗口效果失败不阻塞主题切换（CSS 变量仍生效）
  }
}

export function applyThemeToWindow(theme: ThemeName, transparency?: TransparencySettings, glassMaterial?: GlassMaterial): void {
  currentTheme = theme
  if (transparency) currentTransparency = { ...transparency }
  if (glassMaterial) currentGlassMaterial = glassMaterial
  // themeSource 只影响渲染层原生控件的明暗感知；DWM 亚克力 tint 只跟系统明暗，别指望在此控制霜色
  try {
    nativeTheme.themeSource = theme === 'dark' ? 'dark' : 'light'
  } catch {
    // 设置失败不影响 CSS 主题
  }
  if (!win) return
  // 透明↔不透明类别跟窗口创建时定死（Win 透明窗不可事后补标志）：跨类别切换只能重建窗口。
  // 玻璃在 wallpaper(透明)↔acrylic(不透明) 间切换、或玻璃×透明档组合变化时走此路径
  if (transparentWindows.has(win) !== wantsTransparentFlag(currentTransparency, currentTheme, currentGlassMaterial)) {
    recreateSearchWindow()
    return
  }
  applyThemeToBrowserWindow(win, theme)
}

/** 销毁并按最新镜像重建主窗；原可见则复显（设置页切玻璃材质的运行时通道） */
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
  const w = new BrowserWindow({
    width: opts.width,
    height: opts.height,
    x: opts.x,
    y: opts.y,
    titleBarStyle: 'hidden',
    show: false,
    minWidth: 360,
    minHeight: 240,
    transparent: wantsTransparentFlag(currentTransparency, currentTheme, currentGlassMaterial),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  if (wantsTransparentFlag(currentTransparency, currentTheme, currentGlassMaterial)) transparentWindows.add(w)
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
