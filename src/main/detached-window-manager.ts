import type { ThemeName } from './settings-store'

/** 独立窗口的最小面（Electron BrowserWindow 的可注入子集，测试传 fake，生产由 window.ts 适配） */
export interface DetachedWindowLike {
  readonly webContentsId: number
  readonly webContents: { send(channel: string, payload: unknown): void }
  loadURL(url: string): void
  show(): void
  focus(): void
  setAlwaysOnTop(v: boolean, level?: 'floating'): void
  /** 窗口原生主题效果（vibrancy/亚克力/底色），与 webContents 的 CSS 主题事件并行下发 */
  applyTheme(theme: ThemeName): void
  close(): void
  destroy(): void
  isDestroyed(): boolean
  on(event: 'closed', cb: () => void): void
}

export interface DetachedWindowOptions {
  width: number
  height: number
  x: number
  y: number
  alwaysOnTop: boolean
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

/**
 * 插件独立窗口生命周期：每插件单实例（重复打开只聚焦复用），closed 自清理，
 * 插件禁用/应用退出时批量关闭防泄漏；主题变化经 detached:theme 事件同步各窗口。
 */
export class DetachedWindowManager {
  private readonly byPlugin = new Map<string, DetachedRecord>()
  private readonly byWebContents = new Map<number, DetachedRecord>()

  constructor(private readonly deps: DetachedWindowManagerDeps) {}

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
    win.loadURL(this.deps.entryUrlFor(pluginId, query))
    win.show()
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

  applyThemeToAll(theme: ThemeName): void {
    for (const rec of this.byPlugin.values()) {
      try {
        rec.win.applyTheme(theme)
        rec.win.webContents.send(DETACHED_THEME_EVENT, theme)
      } catch {
        // 窗口销毁竞态时抛错，跳过即可
      }
    }
  }

  closeByWebContents(webContentsId: number): boolean {
    const rec = this.byWebContents.get(webContentsId)
    if (!rec) return false
    this.destroyRecord(rec)
    return true
  }

  setAlwaysOnTopFor(webContentsId: number, value: boolean): boolean {
    const rec = this.byWebContents.get(webContentsId)
    if (!rec) return false
    rec.win.setAlwaysOnTop(value, 'floating')
    return true
  }

  private remove(rec: DetachedRecord): void {
    this.byPlugin.delete(rec.pluginId)
    this.byWebContents.delete(rec.win.webContentsId)
  }

  /** close 优先（走正常关闭流程）；窗口已死时 destroy 兜底清注册表 */
  private destroyRecord(rec: DetachedRecord): void {
    try {
      if (rec.win.isDestroyed()) {
        this.remove(rec)
      } else {
        rec.win.close()
      }
    } catch {
      rec.win.destroy()
    }
  }
}
