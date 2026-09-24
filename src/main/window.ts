import { BrowserWindow, screen } from 'electron'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { ThemeName } from './settings-store'
import type { DetachedWindowLike, DetachedWindowOptions } from './detached-window-manager'

// 800px 为四期 uTools 视觉规范宽度（docs/design/ui-style-guide.md §1.1）
const WINDOW_W = 800
const WINDOW_H = 560

// 深度链接注入：GTOOLS_DEEP_LINK 传 hash 体（不含 #），如 'plugin=calc&q=1%2B1&demo=1'，截图/自动化入口
const deepLinkHash = process.env.GTOOLS_DEEP_LINK?.trim() || ''

let win: BrowserWindow | null = null
let lastShownAt = 0

// ESM 主进程无 __dirname，preload 相对 bundle 产物定位（out/main → out/preload）
const preloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))

export function createSearchWindow(): BrowserWindow {
  if (win) return win
  const { workArea } = screen.getPrimaryDisplay()
  win = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    x: Math.round(workArea.x + (workArea.width - WINDOW_W) / 2),
    y: Math.round(workArea.y + workArea.height * 0.28),
    frame: false,
    resizable: false,
    fullscreenable: false,
    show: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  win.on('blur', () => {
    // macOS 刚 show() 瞬间可能有一次假 blur，200ms 内忽略
    if (Date.now() - lastShownAt < 200) return
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

/** 外壳按态请求窗口高度（空态应用网格加高，ui-style-guide §1.5）：锚定左上角只改高，超出工作区由系统夹紧 */
export function setSearchWindowHeight(height: number): void {
  if (!win) return
  const [x, y] = win.getPosition()
  win.setBounds({ x, y, width: WINDOW_W, height })
}

/** 插件模式临时放开主窗拉伸（Detach 等插件场景需要更大画布），非插件态经 restoreSearchWindowSize 复原 */
export function setSearchWindowResizable(resizable: boolean, minWidth?: number, minHeight?: number): void {
  if (!win) return
  win.setResizable(resizable)
  if (resizable && typeof minWidth === 'number' && typeof minHeight === 'number') {
    win.setMinimumSize(minWidth, minHeight)
  }
}

/** 退出插件态复原固定尺寸并锚定左上角（高度回 WINDOW_H，空态/结果态由渲染层再报高） */
export function restoreSearchWindowSize(): void {
  if (!win) return
  win.setMinimumSize(0, 0)
  win.setResizable(false)
  const [x, y] = win.getPosition()
  win.setBounds({ x, y, width: WINDOW_W, height: WINDOW_H })
}

export function toggleSearchWindow(): void {
  if (win && win.isVisible()) hideSearchWindow()
  else showSearchWindow()
}

/** 当前主题的模块内镜像：独立窗口晚于主题切换创建时（detach），创建参数需读到最新主题 */
let currentTheme: ThemeName = 'light'

/** 主题联动单个窗口原生效果（主窗/独立窗共用）：glass 用 vibrancy/亚克力，light/dark 回不透明底色 */
export function applyThemeToBrowserWindow(target: BrowserWindow, theme: ThemeName): void {
  try {
    if (theme === 'glass') {
      if (process.platform === 'darwin') {
        target.setVibrancy('under-window')
        target.setBackgroundColor('#00000000')
      } else {
        // Win11 acrylic；Win10 不支持时降级为不透明深色
        target.setBackgroundMaterial('acrylic')
      }
    } else {
      if (process.platform === 'darwin') target.setVibrancy(null)
      else {
        try {
          target.setBackgroundMaterial('none')
        } catch {
          // 旧版 Windows 无此 API，忽略
        }
      }
      target.setBackgroundColor(theme === 'dark' ? '#1e1e1e' : '#f2f3f5')
    }
  } catch {
    // 窗口效果失败不阻塞主题切换（CSS 变量仍生效）
  }
}

export function applyThemeToWindow(theme: ThemeName): void {
  currentTheme = theme
  if (win) applyThemeToBrowserWindow(win, theme)
}

/** 独立插件窗口：titleBarStyle hidden 保留 macOS 交通灯（渲染层顶栏做 70px 避让），安全配置与主窗一致；glass 主题创建即透明托底毛玻璃 */
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
    transparent: currentTheme === 'glass',
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  if (opts.alwaysOnTop) w.setAlwaysOnTop(true, 'floating')
  applyThemeToBrowserWindow(w, currentTheme)
  return {
    webContentsId: w.webContents.id,
    webContents: { send: (channel, payload) => w.webContents.send(channel, payload) },
    loadURL: (url) => void w.loadURL(url),
    show: () => w.show(),
    focus: () => w.focus(),
    setAlwaysOnTop: (v, level) => w.setAlwaysOnTop(v, level ?? 'floating'),
    applyTheme: (theme) => applyThemeToBrowserWindow(w, theme),
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
