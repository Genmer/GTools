import type {
  FloatWindowEvent,
  FloatWindowOptions,
  FloatWindowPatch
} from '@sdk/api'

/** 浮窗窗口的最小面（Electron BrowserWindow 的可注入子集，测试传 fake） */
export interface FloatWindowLike {
  readonly webContentsId: number
  loadURL(url: string): void
  setBounds(b: { x?: number; y?: number; width?: number; height?: number }): void
  setAlwaysOnTop(v: boolean, level?: 'floating'): void
  setResizable(v: boolean): void
  setOpacity(v: number): void
  focus(): void
  close(): void
  destroy(): void
  isDestroyed(): boolean
  on(event: 'closed', cb: () => void): void
}

export interface FloatWindowHostOptions {
  width: number
  height: number
  x: number
  y: number
  title?: string
  resizable: boolean
  alwaysOnTop: boolean
  transparent: boolean
  /** false：创建后不显示 */
  show: boolean
  /** false：显示但不抢焦点 */
  focus: boolean
}

export interface FloatManagerDeps {
  /** 创建底层窗口（生产环境包 BrowserWindow，测试包 fake） */
  createWindow(opts: FloatWindowHostOptions): FloatWindowLike
  /** 光标所在显示器的工作区（无坐标创建时居中用） */
  getWorkArea(): { x: number; y: number; width: number; height: number }
  /** 浮窗页面事件回传创建方插件渲染层（plugin-event 通道） */
  onFloatEvent(pluginId: string, payload: FloatWindowEvent): void
}

export const MAX_FLOAT_WINDOWS_PER_PLUGIN = 8
export const MAX_FLOAT_HTML_CHARS = 2_000_000
const MIN_SIZE = 80
const MAX_SIZE = 4000
const MIN_OPACITY = 0.1

/** 注入浮窗页面的默认文档骨架：零边距 + 拖动工具类（插件 html 自带背景与布局） */
export function buildFloatDocument(html: string): string {
  const style =
    'html,body{margin:0;padding:0;overflow:hidden;' +
    'font:13px/1.5 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;cursor:default}' +
    '.drag{-webkit-app-region:drag}.no-drag{-webkit-app-region:no-drag}'
  return `<!doctype html><html><head><meta charset="utf-8"/><style>${style}</style></head><body>${html}</body></html>`
}

export function floatDataURL(html: string): string {
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(buildFloatDocument(html))
}

export function clampFloatSize(n: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(n)))
}

function clampOpacity(n: number): number {
  return Math.min(1, Math.max(MIN_OPACITY, n))
}

interface FloatRecord {
  id: string
  pluginId: string
  win: FloatWindowLike
}

/** 主进程对外暴露的浮窗操作面（dispatch 与 ipc 共用） */
export interface FloatWindowApi {
  create(pluginId: string, opts: FloatWindowOptions): string
  update(pluginId: string, id: string, patch: FloatWindowPatch): void
  close(pluginId: string, id: string): void
  closeAllForPlugin(pluginId: string): void
  closeAll(): void
  /** 浮窗 preload 通道用：按 webContents.id 定位 */
  closeByWebContents(webContentsId: number): boolean
  emitFromWebContents(webContentsId: number, event: string, payload: unknown): boolean
  infoByWebContents(webContentsId: number): { id: string; pluginId: string } | null
}

/**
 * 浮窗生命周期管理：按插件命名空间分配 id，数量上限 + closed 清理 + 插件级/全局批量关闭，
 * 防止插件异常路径泄漏窗口。插件只能操作自己的浮窗（update/close 校验归属）。
 */
export class FloatWindowManager implements FloatWindowApi {
  private readonly byId = new Map<string, FloatRecord>()
  private readonly byWebContents = new Map<number, FloatRecord>()
  private readonly seqByPlugin = new Map<string, number>()

  constructor(private readonly deps: FloatManagerDeps) {}

  countFor(pluginId: string): number {
    let n = 0
    for (const rec of this.byId.values()) if (rec.pluginId === pluginId) n++
    return n
  }

  create(pluginId: string, opts: FloatWindowOptions): string {
    if (opts === null || typeof opts !== 'object') throw new Error('浮窗参数必须是对象')
    if (typeof opts.html !== 'string' || opts.html.trim() === '') throw new Error('浮窗 html 不能为空')
    if (opts.html.length > MAX_FLOAT_HTML_CHARS) throw new Error(`浮窗 html 超过上限 ${MAX_FLOAT_HTML_CHARS} 字符`)
    if (this.countFor(pluginId) >= MAX_FLOAT_WINDOWS_PER_PLUGIN) {
      throw new Error(`插件 ${pluginId} 浮窗数量已达上限 ${MAX_FLOAT_WINDOWS_PER_PLUGIN}，请先关闭部分浮窗`)
    }

    const width = clampFloatSize(opts.width ?? 360)
    const height = clampFloatSize(opts.height ?? 240)
    let x: number
    let y: number
    if (typeof opts.x === 'number' && Number.isFinite(opts.x) && typeof opts.y === 'number' && Number.isFinite(opts.y)) {
      x = Math.round(opts.x)
      y = Math.round(opts.y)
    } else {
      const area = this.deps.getWorkArea()
      x = Math.round(area.x + (area.width - width) / 2)
      y = Math.round(area.y + (area.height - height) / 2)
    }

    const seq = (this.seqByPlugin.get(pluginId) ?? 0) + 1
    this.seqByPlugin.set(pluginId, seq)
    const id = `${pluginId}#${seq}`

    const win = this.deps.createWindow({
      width,
      height,
      x,
      y,
      title: opts.title,
      resizable: opts.resizable ?? false,
      alwaysOnTop: opts.alwaysOnTop ?? true,
      transparent: opts.transparent ?? false,
      show: opts.show !== false,
      focus: opts.focus !== false
    })
    const rec: FloatRecord = { id, pluginId, win }
    this.byId.set(id, rec)
    this.byWebContents.set(win.webContentsId, rec)
    win.on('closed', () => {
      // close/destroy 都会触发，重复删除无害
      this.byId.delete(id)
      this.byWebContents.delete(win.webContentsId)
    })
    win.loadURL(floatDataURL(opts.html))
    return id
  }

  update(pluginId: string, id: string, patch: FloatWindowPatch): void {
    const rec = this.own(pluginId, id)
    const p = patch ?? {}
    if (p.html !== undefined) {
      if (typeof p.html !== 'string' || p.html.length > MAX_FLOAT_HTML_CHARS) throw new Error('浮窗 html 非法或超长')
      rec.win.loadURL(floatDataURL(p.html))
    }
    const bounds: { x?: number; y?: number; width?: number; height?: number } = {}
    if (typeof p.width === 'number' && Number.isFinite(p.width)) bounds.width = clampFloatSize(p.width)
    if (typeof p.height === 'number' && Number.isFinite(p.height)) bounds.height = clampFloatSize(p.height)
    if (typeof p.x === 'number' && Number.isFinite(p.x)) bounds.x = Math.round(p.x)
    if (typeof p.y === 'number' && Number.isFinite(p.y)) bounds.y = Math.round(p.y)
    if (Object.keys(bounds).length > 0) rec.win.setBounds(bounds)
    if (p.resizable !== undefined) rec.win.setResizable(p.resizable)
    if (p.alwaysOnTop !== undefined) rec.win.setAlwaysOnTop(p.alwaysOnTop, 'floating')
    if (typeof p.opacity === 'number' && Number.isFinite(p.opacity)) rec.win.setOpacity(clampOpacity(p.opacity))
    if (p.focus === true) rec.win.focus()
  }

  close(pluginId: string, id: string): void {
    this.own(pluginId, id).win.close()
  }

  closeAllForPlugin(pluginId: string): void {
    for (const rec of [...this.byId.values()]) {
      if (rec.pluginId === pluginId) this.destroyRecord(rec)
    }
  }

  closeAll(): void {
    for (const rec of [...this.byId.values()]) this.destroyRecord(rec)
  }

  closeByWebContents(webContentsId: number): boolean {
    const rec = this.byWebContents.get(webContentsId)
    if (!rec) return false
    this.destroyRecord(rec)
    return true
  }

  emitFromWebContents(webContentsId: number, event: string, payload: unknown): boolean {
    const rec = this.byWebContents.get(webContentsId)
    if (!rec) return false
    this.deps.onFloatEvent(rec.pluginId, { id: rec.id, event, payload })
    return true
  }

  infoByWebContents(webContentsId: number): { id: string; pluginId: string } | null {
    const rec = this.byWebContents.get(webContentsId)
    return rec ? { id: rec.id, pluginId: rec.pluginId } : null
  }

  private own(pluginId: string, id: string): FloatRecord {
    const rec = this.byId.get(id)
    if (!rec || rec.pluginId !== pluginId) {
      throw new Error(`浮窗不存在或不属于插件 ${pluginId}：${id}`)
    }
    return rec
  }

  /** close 优先（走正常关闭流程）；窗口已死时 destroy 兜底清注册表 */
  private destroyRecord(rec: FloatRecord): void {
    try {
      if (rec.win.isDestroyed()) {
        this.byId.delete(rec.id)
        this.byWebContents.delete(rec.win.webContentsId)
      } else {
        rec.win.close()
      }
    } catch {
      rec.win.destroy()
    }
  }
}
