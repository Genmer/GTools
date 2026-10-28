import { BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import type { ClipboardPanelPosition } from '@sdk/settings'
import type { ThemeName, TransparencySettings } from './settings-store'
import { currentVisualState, applyThemeToBrowserWindow, bindDetachedMarginSync, bindTransparentFlagSync, getSearchWindow, markTransparentWindow, secureWebContents } from './window'
import { wantsDetachedMargin } from './detached-window-geometry'
import { PANEL_H_DEFAULT, anchorFlyout, applyFlyoutOffset, type FlyoutOffset, type FlyoutRect } from './clipboard-flyout-geometry'
import { DETACHED_THEME_EVENT } from './detached-window-manager'

// 剪贴板飞窗（Win+V 式面板）窗口编排：全 function 声明、顶层零执行、主窗 null 时全部函数 no-op——
// window.ts 与本模块 ESM 互调（show/hide/重建联动）依赖此结构；ipc-hotkey-settings 等全 mock window 的测试也依赖此契约安全加载。
// data-wintx/data-dmargin 同步与透明登记全部复用 window.ts 导出，禁在此重实现
let flyout: BrowserWindow | null = null
let position: ClipboardPanelPosition = 'off'
// 会话级拖动偏移：用户拖头带产出，重锚（主窗 move/resize、每次显窗）时叠加保持；换预设归零，跨重启不持久
let dragOffset: FlyoutOffset = { dx: 0, dy: 0 }
// F18：已挂 move/resize 监听的主窗引用，引用变化（主窗重建）即对当期窗重挂；旧窗销毁连监听一起消失，无需手动摘
let attachedMain: BrowserWindow | null = null

function resolvePreloadPath(): string {
  return fileURLToPath(new URL('../preload/index.cjs', import.meta.url))
}

export function getClipboardFlyoutWindow(): BrowserWindow | null {
  return flyout !== null && !flyout.isDestroyed() ? flyout : null
}

export function isClipboardFlyoutSender(e: { sender: { id: number } }): boolean {
  const w = getClipboardFlyoutWindow()
  return w !== null && w.webContents.id === e.sender.id
}

export function createClipboardFlyoutWindow(): BrowserWindow | null {
  if (flyout !== null && !flyout.isDestroyed()) return flyout
  const main = getSearchWindow()
  if (!main) return null
  const state = currentVisualState()
  const transparent = state.transparent
  const withMargin = wantsDetachedMargin(transparent, process.platform)
  const w = new BrowserWindow({
    frame: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    skipTaskbar: true,
    // focusable:false 落 WS_EX_NOACTIVATE：点击不夺主窗焦点（侦查探针实证），显隐只走 showInactive/hide
    focusable: false,
    transparent,
    hasShadow: !transparent,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
      // 不设 backgroundThrottling（同主窗）：保持 visibilitychange 语义有效
    }
  })
  if (transparent) markTransparentWindow(w)
  // 非主窗不申请 DWM 材质（霜面槽单活），磨砂观感由渲染层承担（同独立窗纪律）
  applyThemeToBrowserWindow(w, state.theme, state.tx, false)
  bindTransparentFlagSync(w)
  bindDetachedMarginSync(w, withMargin)
  secureWebContents(w.webContents)
  try {
    w.setAlwaysOnTop(true, 'floating')
  } catch {
    // 平台不支持层级时 best-effort，正确性不依赖置顶
  }
  w.on('closed', () => {
    if (flyout === w) flyout = null
  })
  // 拖动偏移记录：按「当前 bounds − 新鲜锚点」差分幂等推导——程序化 setBounds 落位=锚点+现存偏移，
  // 差分回写同值无反馈环；用户拖头带产出新偏移即在此捕获
  w.on('move', () => {
    const main = getSearchWindow()
    if (main === null || w.isDestroyed()) return
    const a = computeAnchorNow(main)
    if (a === null) return
    const b = w.getBounds()
    dragOffset = { dx: b.x - a.os.x, dy: b.y - a.os.y }
  })
  const hash = 'clipboard-flyout=1'
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${hash}`)
  else void w.loadFile(fileURLToPath(new URL('../renderer/index.html', import.meta.url)), { hash })
  flyout = w
  return w
}

function attachMainWindowListeners(main: BrowserWindow): void {
  if (attachedMain === main) return
  attachedMain = main
  const follow = (): void => {
    if (main.isVisible()) reanchorClipboardFlyout()
  }
  main.on('move', follow)
  main.on('resize', follow)
}

/** 惰性创建 + 实时重算锚定 + showInactive（永不 focus）；主窗不可见时不显示（面板随主窗显隐） */
export function showClipboardFlyout(): void {
  if (position === 'off') return
  const main = getSearchWindow()
  if (!main || !main.isVisible()) return
  const w = getClipboardFlyoutWindow() ?? createClipboardFlyoutWindow()
  if (!w) return
  attachMainWindowListeners(main)
  reanchorClipboardFlyout()
  w.showInactive()
  w.moveTop()
}

export function hideClipboardFlyout(): void {
  getClipboardFlyoutWindow()?.hide()
}

export function closeClipboardFlyout(): void {
  const w = getClipboardFlyoutWindow()
  if (!w) return
  flyout = null
  w.destroy()
}

/** 当前主窗/视觉态/预设下的新鲜锚点与工作区：reanchor 与 move 差分同源输入，防两处口径漂移 */
function computeAnchorNow(main: BrowserWindow): { os: FlyoutRect; workArea: FlyoutRect } | null {
  if (position === 'off') return null
  const bounds = main.getBounds()
  const state = currentVisualState()
  const workArea = screen.getDisplayMatching(bounds).workArea
  const a = anchorFlyout({
    mainBounds: bounds,
    transparentMain: state.transparent,
    withMargin: wantsDetachedMargin(state.transparent, process.platform),
    position,
    panelH: PANEL_H_DEFAULT,
    workArea
  })
  return { os: a.os, workArea }
}

export function reanchorClipboardFlyout(): void {
  const w = getClipboardFlyoutWindow()
  const main = getSearchWindow()
  if (!w || !main || position === 'off') return
  const a = computeAnchorNow(main)
  if (!a) return
  w.setBounds(applyFlyoutOffset(a.os, dragOffset, a.workArea))
}

/** off=关窗；非 off 记录方位，主窗可见即惰性显示，不可见仅记录待下次 show（F6） */
export function setClipboardFlyoutPosition(p: ClipboardPanelPosition): void {
  position = p
  dragOffset = { dx: 0, dy: 0 } // 换预设=新意图，旧偏移作废按新预设锚定
  if (p === 'off') {
    closeClipboardFlyout()
    return
  }
  const main = getSearchWindow()
  if (main && main.isVisible()) showClipboardFlyout()
}

export function applyThemeToClipboardFlyout(theme: ThemeName, tx: TransparencySettings): void {
  const w = getClipboardFlyoutWindow()
  if (!w) return
  applyThemeToBrowserWindow(w, theme, tx, false)
  // 飞窗惰性创建后隐藏复用，原生效果之外还须同步渲染层视觉态；载荷同独立窗（glassFrost 随段携带）
  w.webContents.send(DETACHED_THEME_EVENT, { theme, transparency: tx })
}
