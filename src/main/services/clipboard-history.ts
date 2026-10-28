import { isSensitiveText } from '@sdk/sensitive'

export const POLL_INTERVAL_MS = 1000
export const CAP = 50
/** 超长整条跳过不截断：截断存储会破坏 copy 回写语义；50×100KB 即内存上限 */
export const TEXT_MAX_CHARS = 100_000
export const PREVIEW_CHARS = 120
/** 图片条目更重：独立更小容量 + dataUrl 字符上限（约 6MB 位图），超限整条跳过 */
export const IMAGE_CAP = 12
export const IMAGE_MAX_CHARS = 8_000_000

/** 与 electron-services clipboard.readImage 同构（nativeImage → {width,height,dataUrl}） */
export interface ClipboardImage {
  width: number
  height: number
  dataUrl: string
}

export type ClipboardHistoryEntry =
  | { id: string; kind: 'text'; text: string; ts: number }
  | ({ id: string; kind: 'image'; ts: number } & ClipboardImage)

/** 跨 IPC 下发形态：文本只带 preview 不带全文；图片以 dataUrl 为预览本体（内存态），preview 恒存在兜底展示 */
export type ClipboardHistoryItem =
  | { id: string; kind: 'text'; preview: string; ts: number }
  | { id: string; kind: 'image'; preview: string; ts: number; dataUrl: string; width: number; height: number }

export interface ClipboardHistoryScheduler {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(id: unknown): void
}

const nodeScheduler: ClipboardHistoryScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>)
}

export interface ClipboardHistoryDeps {
  scheduler?: ClipboardHistoryScheduler
  readText(): Promise<string>
  writeText(text: string): Promise<void>
  /** 图片读写（Electron 44 W3C 异步化后经 ClipboardItem）；未注入则图片路径整体跳过 */
  readImage?(): Promise<ClipboardImage | null>
  writeImage?(dataUrl: string): Promise<void>
  /** 默认 sdk 单源判定（从严超集）；测试注入计数 fake */
  isSensitive?(text: string): boolean
  /** 敏感指纹豁免查询（vault 经 writeTextEphemeral 登记的内容）；可注入 sync/async fake */
  isExempted?(text: string): boolean | Promise<boolean>
  /** 列表容量，默认 CAP */
  cap?: number
  /** 图片容量，默认 IMAGE_CAP */
  imageCap?: number
}

/** 纯函数：取首个非空行、折叠空白、截 PREVIEW_CHARS 加省略号 */
export function formatPreview(text: string): string {
  const firstLine = text.split('\n').find((l) => l.trim() !== '') ?? ''
  const folded = firstLine.trim().replace(/\s+/g, ' ')
  return folded.length > PREVIEW_CHARS ? `${folded.slice(0, PREVIEW_CHARS)}…` : folded
}

let seq = 0
function nextId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ?? `${Date.now().toString(36)}-${(seq++).toString(36)}`
}

/**
 * 主进程剪贴板历史采集（Win+V 式面板数据源）：纯内存不落盘（退出即逝）、文本+图片
 * （图片独立小容量、文本优先同存不采图），与 clipboard 插件的落盘历史并存（双读幂等无冲突）。
 * electron 能力全部构造注入（vitest node 纯逻辑纪律，不顶层 import electron）。
 */
export class ClipboardHistoryService {
  private entries: ClipboardHistoryEntry[] = []
  /** 内容指纹：与最近一次见到的剪贴板全文比对，相同即整轮 no-op（含敏感/超长已见内容） */
  private lastSeen = ''
  /** 图片指纹（dataUrl）：防面板回写与轮询互吃 */
  private lastSeenImage = ''
  private timer: unknown = null
  private notify: (() => void) | null = null
  private readonly scheduler: ClipboardHistoryScheduler
  private readonly cap: number
  private readonly imageCap: number
  private readonly isSensitive: (text: string) => boolean
  private readonly isExempted: ((text: string) => boolean | Promise<boolean>) | null
  private readonly readText: () => Promise<string>
  private readonly writeText: (text: string) => Promise<void>
  private readonly readImage: (() => Promise<ClipboardImage | null>) | null
  private readonly writeImage: ((dataUrl: string) => Promise<void>) | null

  constructor(deps: ClipboardHistoryDeps) {
    this.scheduler = deps.scheduler ?? nodeScheduler
    this.cap = deps.cap ?? CAP
    this.imageCap = deps.imageCap ?? IMAGE_CAP
    this.isSensitive = deps.isSensitive ?? isSensitiveText
    this.isExempted = deps.isExempted ?? null
    this.readText = deps.readText
    this.writeText = deps.writeText
    this.readImage = deps.readImage ?? null
    this.writeImage = deps.writeImage ?? null
  }

  start(): void {
    if (this.timer !== null) return
    void this.pollOnce()
    this.timer = this.scheduler.setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer !== null) this.scheduler.clearInterval(this.timer)
    this.timer = null
  }

  /** 运行时启停（设置 position 切换）；未运行时 setEnabled(true) 等价 start */
  setEnabled(enabled: boolean): void {
    if (enabled) this.start()
    else this.stop()
  }

  /** 变更回调（轮询新采集/置顶/copy/remove/clear），ipc 层接线广播 */
  onChanged(cb: () => void): void {
    this.notify = cb
  }

  items(): ClipboardHistoryItem[] {
    return this.entries.map((e) =>
      e.kind === 'text'
        ? { id: e.id, kind: 'text' as const, preview: formatPreview(e.text), ts: e.ts }
        : {
            id: e.id,
            kind: 'image' as const,
            preview: `图片 ${e.width}×${e.height}`,
            ts: e.ts,
            dataUrl: e.dataUrl,
            width: e.width,
            height: e.height
          }
    )
  }

  /** 回写剪贴板 + 置顶刷新 ts（复用 id），未命中返回 false */
  async copy(id: string): Promise<boolean> {
    const entry = this.entries.find((e) => e.id === id)
    if (entry === undefined) return false
    if (entry.kind === 'text') {
      await this.writeText(entry.text)
      this.lastSeen = entry.text // 防下一轮轮询把面板回写内容再采一遍
    } else {
      if (this.writeImage === null) return false
      await this.writeImage(entry.dataUrl)
      this.lastSeenImage = entry.dataUrl
    }
    this.promote(entry)
    return true
  }

  /** 单条删除；返回是否确有命中 */
  remove(id: string): boolean {
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e.id !== id)
    if (this.entries.length === before) return false
    this.changed()
    return true
  }

  clear(): void {
    if (this.entries.length === 0) return
    this.entries = []
    this.changed()
  }

  private changed(): void {
    this.notify?.()
  }

  /** 置顶+刷新 ts（复用 id）；全列表查重（非仅队头）后由调用方触发变更通知 */
  private promote(entry: ClipboardHistoryEntry): void {
    entry.ts = Date.now()
    this.entries = [entry, ...this.entries.filter((e) => e !== entry)]
    this.trim()
    this.changed()
  }

  /** 文本/图片各自容量封顶（图片更重独立小容量），从队尾裁 */
  private trim(): void {
    let texts = 0
    let images = 0
    this.entries = this.entries.filter((e) => {
      if (e.kind === 'text') return ++texts <= this.cap
      return ++images <= this.imageCap
    })
  }

  async pollOnce(): Promise<void> {
    let text: string
    try {
      text = await this.readText()
    } catch {
      // 剪贴板被占用等瞬态失败：静默放弃本轮
      return
    }
    if (text !== '' && text.trim() !== '') {
      if (text === this.lastSeen) return
      // 先记指纹再判敏感/超长：敏感命中也记指纹，防同内容每秒重跑正则
      this.lastSeen = text
      if (text.length > TEXT_MAX_CHARS) return
      if (this.isSensitive(text)) return
      // 宿主自己写入的敏感内容（vault 指纹豁免）：正则拦不住任意密码，靠指纹闭环；lastSeen 已记，同内容不重复查询
      if (this.isExempted !== null && (await this.isExempted(text))) return
      const existing = this.entries.find((e) => e.kind === 'text' && e.text === text)
      if (existing !== undefined) {
        this.promote(existing)
        return
      }
      this.entries = [{ id: nextId(), kind: 'text', text, ts: Date.now() }, ...this.entries]
      this.trim()
      this.changed()
      return
    }
    // 纯图片剪贴板（文本面为空）：文本优先，同存时图片不采
    if (this.readImage === null) return
    let img: ClipboardImage | null
    try {
      img = await this.readImage()
    } catch {
      return
    }
    if (img === null || img.dataUrl === '' || img.width < 2 || img.height < 2) return
    if (img.dataUrl === this.lastSeenImage) return
    this.lastSeenImage = img.dataUrl
    if (img.dataUrl.length > IMAGE_MAX_CHARS) return
    const existingImage = this.entries.find((e) => e.kind === 'image' && e.dataUrl === img!.dataUrl)
    if (existingImage !== undefined) {
      this.promote(existingImage)
      return
    }
    this.entries = [{ id: nextId(), kind: 'image', ts: Date.now(), ...img }, ...this.entries]
    this.trim()
    this.changed()
  }
}
