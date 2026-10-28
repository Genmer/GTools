import { BrowserWindow, nativeTheme, screen } from 'electron'
import type { WebContents } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ThemeName, TransparencySettings } from './settings-store'
import { DEFAULT_TRANSPARENCY } from '@sdk/settings'
import type { DetachedWindowLike, DetachedWindowOptions } from './detached-window-manager'
import {
  MARGIN_BOTTOM,
  MARGIN_TOP,
  MARGIN_X,
  detachedWindowBounds,
  wantsDetachedMargin
} from './detached-window-geometry'
import { closeClipboardFlyout, hideClipboardFlyout, showClipboardFlyout } from './clipboard-flyout-window'
import { decideShowPosition, applyResizeDelta } from './window-position'
import { logoIconPath } from './logo-skin'
import { decideAutoReload } from './services/crash-reload-policy'

// 内容口径 800×560 为四期 uTools 视觉规范（docs/design/ui-style-guide.md §1.1）。
// 透明窗的 OS 窗口比内容大一圈透明边距，外圈投影落进边距才可见（Electron 透明+无边框窗
// DWM 不给影，setHasShadow 在 Windows 路径是空操作）；不透明窗零改动（DWM 系统投影为主）。
// MARGIN 常数单源在 detached-window-geometry.ts（与 base.css #app padding 两处手改需同步）
const CONTENT_W = 800
const CONTENT_H = 560
const WINDOW_W = CONTENT_W + MARGIN_X * 2
const WINDOW_H = CONTENT_H + MARGIN_TOP + MARGIN_BOTTOM

// 深度链接注入：GTOOLS_DEEP_LINK 传 hash 体（不含 #），如 'plugin=calc&q=1%2B1&demo=1'，截图/自动化入口
const deepLinkHash = process.env.GTOOLS_DEEP_LINK?.trim() || ''

let win: BrowserWindow | null = null
let lastShownAt = 0

// 首帧就绪门控：冷启动后立即按热键 show 会白屏，未就绪时挂起等 ready-to-show 再显
let rendererReady = false
let showPending = false

// 渲染进程崩溃/加载失败的自动重载时间戳（60 秒滑动窗，超限放弃），窗口重建时清零新账；
// 垂死旧窗晚到的 ERR_ABORTED/崩溃事件须先查 isDestroyed 再记账，防污染新窗刚清零的历史
let crashReloadHistory: number[] = []

/** 失焦自动隐藏的模块内镜像（设置页开关即时生效，只约束主窗） */
let hideOnBlurEnabled = true

// 上次位置记忆（用户拖动后记录，经 bindWindowPositionSink 持久化到 settings.windowPos）
let rememberedPos: { x: number; y: number } | null = null
let persistWindowPos: ((p: { x: number; y: number } | null) => void) | null = null
// 程序化 setPosition 的目标值：moved 回调据此识别自触发的移动，不当作用户拖动记录
let lastProgrammaticPos: { x: number; y: number } | null = null
let movedDebounce: ReturnType<typeof setTimeout> | null = null

export function setRememberedWindowPos(p: { x: number; y: number } | null): void {
  rememberedPos =
    p !== null && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: Math.round(p.x), y: Math.round(p.y) } : null
}

export function bindWindowPositionSink(cb: (p: { x: number; y: number } | null) => void): void {
  persistWindowPos = cb
}

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
export function wantsTransparentFlag(tx: TransparencySettings, theme: ThemeName): boolean {
  if (process.platform === 'darwin') return true
  return (tx.enabled || theme === 'glass') && !tx.blur
}

// Electron 无 isTransparent()：创建时带透明标志的窗口记入此表，材质应用时判断能否直透桌面
const transparentWindows = new WeakSet<object>()

/** 飞窗等 window.ts 外部创建的透明窗共用同一登记表：不登记会被材质应用/数据同步当不透明窗处理 */
export function markTransparentWindow(target: BrowserWindow): void {
  transparentWindows.add(target)
}

/** ipc 等外部消费方查透明标志（Electron 无 isTransparent()，只认创建时登记） */
export function isTransparentWindow(target: BrowserWindow): boolean {
  return transparentWindows.has(target)
}

/** 当前视觉类别快照（飞窗创建/锚定与主窗同源）：transparent 取主窗实际标志，无窗时回退公式值 */
export function currentVisualState(): { theme: ThemeName; tx: TransparencySettings; transparent: boolean } {
  return {
    theme: currentTheme,
    tx: { ...currentTransparency },
    transparent: win ? transparentWindows.has(win) : wantsTransparentFlag(currentTransparency, currentTheme)
  }
}

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

export function bindTransparentFlagSync(target: BrowserWindow): void {
  target.webContents.on('dom-ready', () => syncWindowTransparentFlag(target))
  syncWindowTransparentFlag(target)
}

/** 全部自建窗口统一导航钳制：SPA 只认本渲染源，其余顶层导航一律拦下、弹窗恒 deny（iframe sandbox 为第一道防线）。
 *  loadURL 初始加载不触发 will-navigate，data:URL 遮罩/浮窗初始页不受影响。 */
export function secureWebContents(wc: WebContents): void {
  const rendererOrigin = process.env.ELECTRON_RENDERER_URL ?? 'file://'
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(rendererOrigin)) e.preventDefault()
  })
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
}

export function createSearchWindow(): BrowserWindow {
  // 销毁间隙的旧引用不认（closed 置 null 与销毁非同拍），与 getSearchWindow 口径一致
  if (win && !win.isDestroyed()) return win
  const { workArea } = screen.getPrimaryDisplay()
  const transparent = wantsTransparentFlag(currentTransparency, currentTheme)
  // 透明窗加投影边距；不透明窗维持内容尺寸（uiFixes：外圈投影为透明窗专属，不透明窗零改动）
  const win32Icon = process.platform === 'win32' ? logoIconPath() : null
  const width = transparent ? WINDOW_W : CONTENT_W
  const height = transparent ? WINDOW_H : CONTENT_H
  win = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height * 0.28),
    frame: false,
    // Win11 DWM 默认对 frameless 窗做系统圆角裁剪会咬掉轮廓环四角，win32 一律关掉；darwin 不设，保持系统行为
    ...(process.platform === 'win32' ? { roundedCorners: false } : {}),
    resizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    transparent,
    // 透明窗只留 CSS 阴影：macOS 原生影按含阴影 alpha 的整窗矩形生成，与 CSS 影叠加成又硬又大的方框
    hasShadow: !transparent,
    backgroundColor: '#00000000',
    // win32 任务栏/窗口图标随应用 logo 底色（设置-外观）；darwin 图标由 applyAppLogoSkin 写 Dock
    ...(win32Icon ? { icon: win32Icon } : {}),
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
  // closed/render-process-gone 等回调晚于窗口重建触发时模块 win 可能已指向新窗，回调只认本窗
  const self = win

  rendererReady = false
  showPending = false
  crashReloadHistory = []
  win.once('ready-to-show', () => {
    rendererReady = true
    if (showPending) {
      showPending = false
      showSearchWindow()
    }
  })

  applyThemeToBrowserWindow(win, currentTheme)
  bindTransparentFlagSync(win)
  win.on('blur', () => {
    // macOS 刚 show() 瞬间可能有一次假 blur，200ms 内忽略
    if (Date.now() - lastShownAt < 200) return
    if (suspendBlurHideCount > 0 || !hideOnBlurEnabled) return
    hideSearchWindow()
  })
  // 拖动后防抖记忆位置；与 lastProgrammaticPos 重合的是 showSearchWindow 自己挪的，跳过
  win.on('moved', () => {
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const [x, y] = win.getPosition()
    if (lastProgrammaticPos !== null && lastProgrammaticPos.x === x && lastProgrammaticPos.y === y) return
    if (movedDebounce !== null) clearTimeout(movedDebounce)
    movedDebounce = setTimeout(() => {
      movedDebounce = null
      if (!win || win.isDestroyed() || !win.isVisible()) return
      const [px, py] = win.getPosition()
      rememberedPos = { x: px, y: py }
      persistWindowPos?.(rememberedPos)
    }, 600)
  })
  win.on('closed', () => {
    transparentWindows.delete(self)
    if (win === self) win = null
  })
  // 渲染进程崩溃（OOM/原生崩溃）后白死窗口无自愈：按滑动窗策略自动重载，超限放弃防 reload 风暴
  win.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit' || self.isDestroyed()) return
    const decision = decideAutoReload(crashReloadHistory, Date.now())
    crashReloadHistory = decision.history
    if (decision.reload) {
      console.error('GTools 主窗渲染进程异常（' + details.reason + '），自动重载')
      if (!self.isDestroyed()) self.webContents.reload()
    } else {
      console.error('GTools 主窗渲染进程异常（' + details.reason + '），60 秒内已 3 次，放弃自动重载')
    }
  })
  // 容器插件页可发起顶层导航/弹窗：统一导航钳制（见 secureWebContents）
  secureWebContents(win.webContents)

  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL
    const url = deepLinkHash ? `${base}#${deepLinkHash}` : base
    const load = (): void => {
      if (self.isDestroyed()) return
      // dev server 未起时的 200ms 重试同样受滑动窗策略封顶，不再无限重试
      self.loadURL(url).catch((err: unknown) => {
        if (self.isDestroyed()) return
        const decision = decideAutoReload(crashReloadHistory, Date.now())
        crashReloadHistory = decision.history
        if (decision.reload) setTimeout(load, 200)
        else console.error('GTools 主窗 dev 加载重试超限（60 秒内已 3 次），放弃：', err)
      })
    }
    load()
  } else {
    const file = fileURLToPath(new URL('../renderer/index.html', import.meta.url))
    void self.loadFile(file, deepLinkHash ? { hash: deepLinkHash } : undefined).catch((err: unknown) => {
      if (self.isDestroyed()) return
      console.error('GTools 主窗加载失败：', err)
      const decision = decideAutoReload(crashReloadHistory, Date.now())
      crashReloadHistory = decision.history
      if (decision.reload) {
        setTimeout(() => {
          if (!self.isDestroyed()) self.webContents.reload()
        }, 200)
      } else {
        console.error('GTools 主窗加载重试超限（60 秒内已 3 次），放弃自动重载')
      }
    })
  }
  return win
}

/** 主窗销毁后（Alt+F4 真关/透明类别重建间隙）不得把 destroyed 引用交给消费者，send 会抛错 */
export function getSearchWindow(): BrowserWindow | null {
  return win !== null && !win.isDestroyed() ? win : null
}

/** 全窗投递广播的目标集合：getAllWindows 含销毁中窗口，须过滤防 destroyed send */
export function allLiveWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
}

export function showSearchWindow(): void {
  if (!win || win.isDestroyed()) {
    // 主窗被真关（Alt+F4/Cmd+W 后 closed 置 null）后热键/托盘唤起须重建，否则托盘常驻应用整体僵尸；
    // 新窗 rendererReady 恒 false，挂起待 ready-to-show 再显（与下方未就绪分支同语义）
    createSearchWindow()
    showPending = true
    return
  }
  if (!rendererReady) {
    // 页面首帧未就绪：挂起待 ready-to-show 再显，防冷启动白屏
    showPending = true
    return
  }
  // 唤起位置跟随光标所在屏；用户拖过的位置在同屏内沿用（隐藏状态下挪动，用户无感）
  const [w, h] = win.getSize()
  const target = decideShowPosition(rememberedPos, screen.getCursorScreenPoint(), screen.getAllDisplays(), {
    width: w,
    height: h
  })
  const [cx, cy] = win.getPosition()
  if (cx !== target.x || cy !== target.y) {
    lastProgrammaticPos = target
    win.setPosition(target.x, target.y, false)
  }
  // macOS 全屏覆盖：普通 show 会切走前台 app 的全屏空间（回桌面）；先挂「全工作区可见
  // （含全屏空间）」再显（uTools 同款手法），隐藏时复位防窗口常驻各空间
  if (process.platform === 'darwin') {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  win.show()
  win.focus()
  lastShownAt = Date.now()
  showClipboardFlyout()
}

export function hideSearchWindow(): void {
  hideClipboardFlyout()
  // 拖动防抖未到期即隐藏（hideOnBlur 常见）：就地落一次位置，防本次摆放被丢弃
  if (movedDebounce !== null && win && !win.isDestroyed()) {
    clearTimeout(movedDebounce)
    movedDebounce = null
    const [px, py] = win.getPosition()
    rememberedPos = { x: px, y: py }
    persistWindowPos?.(rememberedPos)
  }
  win?.hide()
  if (process.platform === 'darwin' && win && !win.isDestroyed()) {
    win.setVisibleOnAllWorkspaces(false)
  }
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

/** 插件态自绘手柄拉伸（透明窗 OS 拖缘在隐形外缘上抓不到）：锚定左上角增量改窗，夹最小尺寸与工作区 */
export function resizeSearchWindowBy(dw: number, dh: number): void {
  if (!win) return
  const [minW, minH] = win.getMinimumSize()
  const area = screen.getDisplayMatching(win.getBounds()).workArea
  const size = applyResizeDelta(
    { width: win.getBounds().width, height: win.getBounds().height },
    { width: minW > 0 ? minW : 520, height: minH > 0 ? minH : 360 },
    { width: area.width, height: area.height },
    dw,
    dh
  )
  const [x, y] = win.getPosition()
  win.setBounds({ x, y, ...size })
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
 * - 磨霜：win32 不透明窗走 DWM acrylic（allowMaterial=false 的窗口不申请，见下）；macOS 不用
 *   vibrancy（整窗矩形磨霜会越出卡片圆角边距，即实测的「外圈玻璃块」），霜面由渲染层
 *   .app/.detached 的 CSS backdrop-filter 实时采样桌面承担
 * - 模糊关：透明窗直透桌面（clear 效果）；win32 不透明档回退主题底色
 * - allowMaterial：DWM 同进程只有单活霜面槽，新材质窗会抢走旧窗的槽——独立窗必须传 false，
 *   否则 attach 即打死主窗霜面
 */
export function applyThemeToBrowserWindow(
  target: BrowserWindow,
  theme: ThemeName,
  tx: TransparencySettings = currentTransparency,
  allowMaterial = true
): void {
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
      let materialApplied = false
      // DWM tint 亮度只跟系统明暗（与 nativeTheme.themeSource 无关）
      if (nativeBlur && !transparent && allowMaterial) {
        try {
          target.setBackgroundMaterial('acrylic')
          materialApplied = true
        } catch {
          // Win10/旧版无此 API：退主题实色
        }
      }
      // 材质生效前提是窗口底色透明（不透明色会从内部盖死 DWM 霜面，与调用顺序无关）；
      // 材质未生效（API 缺失/独立窗）时不透明窗必须回退主题实色防透明黑底
      target.setBackgroundColor(
        transparent || materialApplied ? '#00000000' : theme === 'dark' ? '#1e1e1e' : '#f2f3f5'
      )
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

/**
 * 销毁并按最新镜像重建主窗；原可见则复显（win32 透明类别切换专用，darwin 恒透明不会走到）。
 * DWM 霜面槽同进程单活且销毁后同矩形区域烧毁不可复活：重建窗的磨砂观感只能靠 CSS 兜底（噪点+曲线）。
 */
function recreateSearchWindow(): void {
  if (!win) return
  const wasVisible = win.isVisible()
  const old = win
  // 飞窗监听与锚定都挂在旧主窗上：跨透明类别重建必须连飞窗一起销毁，下次 show 按新类别惰性重建
  closeClipboardFlyout()
  win = null
  old.destroy()
  createSearchWindow()
  if (wasVisible) showSearchWindow()
}

/** 车道契约：把本窗是否带边距环同步给渲染层（html[data-dmargin]）——CSS 据此决定独立窗
 *  吃不吃 #app 边距环（darwin 恒无环维持满幅现状）；几何创建时定死，窗口生命周期内不变 */
function syncDetachedMarginFlag(target: BrowserWindow, withMargin: boolean): void {
  const flag = withMargin ? '1' : '0'
  target.webContents
    .executeJavaScript(`document.documentElement.dataset.dmargin = '${flag}'; undefined`, true)
    .catch(() => {
      // 页面未就绪/导航竞态：dom-ready 监听会再同步
    })
}

export function bindDetachedMarginSync(target: BrowserWindow, withMargin: boolean): void {
  target.webContents.on('dom-ready', () => syncDetachedMarginFlag(target, withMargin))
  syncDetachedMarginFlag(target, withMargin)
}

/** 独立插件窗口：titleBarStyle hidden 保留 macOS 交通灯（渲染层顶栏做 70px 避让），安全配置与主窗一致；透明+无模糊模式创建即带透明标志 */
export function createDetachedWindow(opts: DetachedWindowOptions): DetachedWindowLike {
  const transparent = wantsTransparentFlag(currentTransparency, currentTheme)
  // win32/linux 透明窗加边距环容纳 CSS 外影；darwin 恒透明但不加环（零改动门控）
  const withMargin = wantsDetachedMargin(transparent, process.platform)
  // manager opts 是内容口径，此处换算成 OS 窗口口径（无环恒等，不透明窗 + darwin 同现状）
  const bounds = detachedWindowBounds(opts, withMargin)
  const win32Icon = process.platform === 'win32' ? logoIconPath() : null
  const w = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    titleBarStyle: 'hidden',
    // Win11 DWM 默认对 frameless 窗做系统圆角裁剪会咬掉轮廓环四角，win32 一律关掉；darwin 不设，保持系统行为
    ...(process.platform === 'win32' ? { roundedCorners: false } : {}),
    // win32 透明档放开 OS 拖缘拉伸会使透明失效（与主窗同约束）；darwin 恒透明但无此约束，保持可拉伸
    resizable: !(process.platform === 'win32' && transparent),
    show: false,
    minWidth: bounds.minWidth,
    minHeight: bounds.minHeight,
    transparent,
    // 与主窗同因：透明窗关原生影，防原生整窗矩形影与 CSS 影叠加出方框
    hasShadow: !transparent,
    backgroundColor: '#00000000',
    ...(win32Icon ? { icon: win32Icon } : {}),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  if (transparent) transparentWindows.add(w)
  if (opts.alwaysOnTop) w.setAlwaysOnTop(true, 'floating')
  // macOS 全屏覆盖：与主窗同法，分离窗常驻全工作区可见（含全屏空间），不切走前台 app 全屏
  if (process.platform === 'darwin') {
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }
  // 独立窗不申请系统材质：DWM 霜面槽唯一，attach 即抢死主窗霜面（磨砂观感由噪点+CSS 曲线承担）
  applyThemeToBrowserWindow(w, currentTheme, currentTransparency, false)
  bindTransparentFlagSync(w)
  bindDetachedMarginSync(w, withMargin)
  secureWebContents(w.webContents)
  return {
    webContentsId: w.webContents.id,
    webContents: { send: (channel, payload) => w.webContents.send(channel, payload) },
    loadURL: (url) => void w.loadURL(url),
    show: () => w.show(),
    hide: () => w.hide(),
    focus: () => w.focus(),
    setAlwaysOnTop: (v, level) => w.setAlwaysOnTop(v, level ?? 'floating'),
    applyTheme: (theme, tx) => applyThemeToBrowserWindow(w, theme, tx, false),
    close: () => w.close(),
    destroy: () => w.destroy(),
    isDestroyed: () => w.isDestroyed(),
    // 'close' 回调带 preventDefault（两阶段关窗拦截用），'closed' 回调无参；BrowserWindow.on
    // 的重载族不接受事件名联合，按字面量分派
    on: (event: 'close' | 'closed', cb: (e: { preventDefault(): void }) => void): void => {
      if (event === 'closed') w.on('closed', cb as () => void)
      else w.on('close', cb)
    },
    once: (event, cb) => {
      w.once(event, cb)
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
