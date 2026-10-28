import type { OutlineColor, ThemeName, TransparencySettings } from './settings-store'

/** 独立窗口的最小面（Electron BrowserWindow 的可注入子集，测试传 fake，生产由 window.ts 适配） */
export interface DetachedWindowLike {
  readonly webContentsId: number
  readonly webContents: { send(channel: string, payload: unknown): void }
  loadURL(url: string): void
  show(): void
  /** 两阶段关窗第一步：先隐藏保观感（渲染层冲刷草稿期间窗口不可见） */
  hide(): void
  focus(): void
  setAlwaysOnTop(v: boolean, level?: 'floating'): void
  /** 窗口原生主题效果（vibrancy/亚克力/底色），与 webContents 的 CSS 主题事件并行下发 */
  applyTheme(theme: ThemeName, transparency: TransparencySettings): void
  close(): void
  destroy(): void
  isDestroyed(): boolean
  on(event: 'closed', cb: () => void): void
  /** 原生 close 拦截（mac 交通灯 X / Alt+F4）：回调可 preventDefault 拦下，转两阶段关闭 */
  on(event: 'close', cb: (e: { preventDefault(): void }) => void): void
  /** 首帧就绪回调（门控 show 用，防空窗闪现） */
  once(event: 'ready-to-show', cb: () => void): void
}

export interface DetachedWindowOptions {
  width: number
  height: number
  x: number
  y: number
  alwaysOnTop: boolean
}

/** 独立窗 CSS 侧轮廓环视觉；环纯 CSS 实现，原生 applyTheme 不感知 */
export interface OutlineVisual {
  enabled: boolean
  width: number
  color: OutlineColor
  /** 自定义环色 hex；宽松可选（旧载荷缺省容忍），接收端经 sanitizeOutlineCustomColor 自校验 */
  customColor?: string
  /** 流动速度档位；宽松可选（旧载荷缺省容忍），接收端经 sanitizeOutlineFlowSpeed 自校验 */
  flowSpeed?: number
}

export interface DetachedWindowManagerDeps {
  createWindow(opts: DetachedWindowOptions): DetachedWindowLike
  getWorkArea(): { x: number; y: number; width: number; height: number }
  /** 独立窗口页面入口（dev 取 renderer URL，prod 取 index.html file URL，hash 由实现拼） */
  entryUrlFor(pluginId: string, query: string): string
}

interface DetachedRecord {
  pluginId: string
  win: DetachedWindowLike
}

export const DETACHED_DEFAULT_W = 680
export const DETACHED_DEFAULT_H = 480
export const DETACHED_THEME_EVENT = 'detached:theme'
/** 两阶段关窗第二段事件：主进程发本事件让渲染层冲刷草稿，冲刷完经 window:close-detached ACK */
export const DETACHED_FLUSH_EVENT = 'detached:flush'
/** 渲染层 ACK 的超时兜底：到点不等草稿直接销毁（渲染层卡死/未就绪时关窗不被拖延） */
export const DETACHED_FLUSH_TIMEOUT_MS = 600

/**
 * 插件独立窗口生命周期：每插件单实例（重复打开只聚焦复用），closed 自清理，
 * 插件禁用/应用退出时批量关闭防泄漏；主题变化经 detached:theme 事件同步各窗口。
 */
export class DetachedWindowManager {
  private readonly byPlugin = new Map<string, DetachedRecord>()
  private readonly byWebContents = new Map<number, DetachedRecord>()
  /** 已进入冲刷等待的窗口（webContentsId → 超时兜底定时器） */
  private readonly flushing = new Map<number, ReturnType<typeof setTimeout>>()
  private quitting = false

  constructor(private readonly deps: DetachedWindowManagerDeps) {}

  /** 退出放行：app.quit() 先逐窗发 close 再进 will-quit，退出期不拦 close，防 preventDefault 中止整个退出 */
  markQuitting(): void {
    this.quitting = true
  }

  /** 打开插件的独立窗口；已存在则聚焦复用。返回 created/focused 供调用方感知 */
  open(pluginId: string, query: string): 'created' | 'focused' {
    const exist = this.byPlugin.get(pluginId)
    if (exist && !exist.win.isDestroyed()) {
      exist.win.show()
      exist.win.focus()
      return 'focused'
    }
    const area = this.deps.getWorkArea()
    const win = this.deps.createWindow({
      width: DETACHED_DEFAULT_W,
      height: DETACHED_DEFAULT_H,
      x: Math.round(area.x + (area.width - DETACHED_DEFAULT_W) / 2),
      y: Math.round(area.y + (area.height - DETACHED_DEFAULT_H) / 2),
      alwaysOnTop: false
    })
    const rec: DetachedRecord = { pluginId, win }
    this.byPlugin.set(pluginId, rec)
    this.byWebContents.set(win.webContentsId, rec)
    win.on('closed', () => this.remove(rec))
    // 原生关闭也走两阶段（拦下先冲刷草稿）；destroy 不发 close 事件，销毁链路不受此拦截
    win.on('close', (e) => {
      if (this.quitting) return
      e.preventDefault()
      this.requestClose(rec)
    })
    win.loadURL(this.deps.entryUrlFor(pluginId, query))
    // 首帧就绪再显窗：loadURL 后立即 show 会先见空窗再跳内容
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
    })
    return 'created'
  }

  has(pluginId: string): boolean {
    const rec = this.byPlugin.get(pluginId)
    return rec !== undefined && !rec.win.isDestroyed()
  }

  closeForPlugin(pluginId: string): void {
    const rec = this.byPlugin.get(pluginId)
    if (rec) this.destroyRecord(rec)
  }

  closeAll(): void {
    for (const rec of [...this.byPlugin.values()]) this.destroyRecord(rec)
  }

  applyThemeToAll(theme: ThemeName, transparency: TransparencySettings, outline: OutlineVisual): void {
    for (const rec of this.byPlugin.values()) {
      try {
        rec.win.applyTheme(theme, transparency)
        rec.win.webContents.send(DETACHED_THEME_EVENT, { theme, transparency, outline })
      } catch {
        // 窗口销毁竞态时抛错，跳过即可
      }
    }
  }

  closeByWebContents(webContentsId: number): boolean {
    const rec = this.byWebContents.get(webContentsId)
    if (!rec) return false
    // 已在冲刷中：本次调用即渲染层 ACK，直接销毁；未冲刷则先起闸等 ACK（超时兜底）
    if (this.flushing.has(webContentsId)) this.destroyRecord(rec)
    else this.requestClose(rec)
    return true
  }

  /** 按 webContentsId 查该独立窗登记的插件 id（gtools:api 的 sender 绑定校验用），未登记返回 null */
  pluginIdForWebContents(webContentsId: number): string | null {
    return this.byWebContents.get(webContentsId)?.pluginId ?? null
  }

  setAlwaysOnTopFor(webContentsId: number, value: boolean): boolean {
    const rec = this.byWebContents.get(webContentsId)
    if (!rec) return false
    rec.win.setAlwaysOnTop(value, 'floating')
    return true
  }

  private remove(rec: DetachedRecord): void {
    this.byPlugin.delete(rec.pluginId)
    const id = rec.win.webContentsId
    this.byWebContents.delete(id)
    const t = this.flushing.get(id)
    if (t !== undefined) {
      clearTimeout(t)
      this.flushing.delete(id)
    }
  }

  /** 两阶段关窗第一段：隐藏 → 通知渲染层冲刷草稿 → 登记 flushing 等 ACK 或超时 */
  private requestClose(rec: DetachedRecord): void {
    const id = rec.win.webContentsId
    if (this.flushing.has(id)) return
    try {
      rec.win.hide()
      rec.win.webContents.send(DETACHED_FLUSH_EVENT, null)
    } catch {
      // 页面未就绪/窗口已死：无从冲刷，直接销毁
      this.destroyRecord(rec)
      return
    }
    this.flushing.set(id, setTimeout(() => this.destroyRecord(rec), DETACHED_FLUSH_TIMEOUT_MS))
  }

  /** 直接 destroy 不走两阶段（禁用/退出链路确定性优先）；destroy 不发 close 事件，不会被 close 拦截卡住 */
  private destroyRecord(rec: DetachedRecord): void {
    const t = this.flushing.get(rec.win.webContentsId)
    if (t !== undefined) {
      clearTimeout(t)
      this.flushing.delete(rec.win.webContentsId)
    }
    try {
      if (rec.win.isDestroyed()) {
        this.remove(rec)
      } else {
        rec.win.destroy()
      }
    } catch {
      this.remove(rec)
    }
  }
}
