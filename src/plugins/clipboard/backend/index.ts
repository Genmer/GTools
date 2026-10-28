import type { BackendContext, PluginBackend } from '@sdk/api'
import {
  DEFAULT_SETTINGS,
  MAX_TEXT_CHARS,
  REMOVE_MARKER_KEY,
  appendRecord,
  adoptRemoveRecords,
  clampMaxRecords,
  enforceCap,
  parsePersistedState,
  parseRemoveMarker,
  toPersisted,
  type ClipboardRecord,
  type ClipboardSettings,
  type PersistedClipboardState,
  type RemoveMarker
} from '../logic/history'
import { imageFingerprint } from '../logic/image-hash'
import { isSensitiveText } from '../logic/sensitive'
import { CLEAR_MARKER_KEY } from '../logic/history'

export const POLL_INTERVAL_MS = 1000
/** 外部变更（渲染层清空/改设置）检测周期；提交前的同步兜底覆盖更小窗口 */
export const SYNC_INTERVAL_MS = 5000
const STATE_KEY = 'state'

type ContentSig = { kind: 'text'; text: string } | { kind: 'image'; hash: string }

export interface BackendScheduler {
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(id: unknown): void
}

const nodeScheduler: BackendScheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>)
}

function parseClearMarker(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
}

/**
 * 剪贴板历史常驻 backend：轮询记录 + 经 ctx.storage 持久化 + emit 推送渲染层。
 * backend 能力只经 ctx（协议约束，无 fs/electron），图片因此随 kv.json 整包落盘并用预算约束体积。
 */
export class ClipboardHistoryBackend implements PluginBackend {
  private ctx: BackendContext | null = null
  private settings: ClipboardSettings = { ...DEFAULT_SETTINGS }
  private records: ClipboardRecord[] = []
  private lastSig: ContentSig | null = null
  private lastImageDataUrl = ''
  private clearMarker = 0
  private removeMarker = 0
  private pollTimer: unknown = null
  private syncTimer: unknown = null
  private dirty = false
  private saving = false

  constructor(private readonly scheduler: BackendScheduler = nodeScheduler) {}

  async init(ctx: BackendContext): Promise<void> {
    this.ctx = ctx
    await this.reloadFromStorage()
    // 采纳上次会话退出前可能残留的清空标记（用户点了清空但 backend 未及感知即退出）
    await this.syncExternal()
  }

  async start(): Promise<void> {
    if (this.pollTimer !== null) return
    await this.pollOnce()
    this.pollTimer = this.scheduler.setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS)
    this.syncTimer = this.scheduler.setInterval(() => void this.syncExternal(), SYNC_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    if (this.pollTimer !== null) this.scheduler.clearInterval(this.pollTimer)
    if (this.syncTimer !== null) this.scheduler.clearInterval(this.syncTimer)
    this.pollTimer = null
    this.syncTimer = null
    await this.flush()
  }

  async dispose(): Promise<void> {
    if (this.settings.clearOnExit) {
      this.records = []
      this.lastSig = null
      this.lastImageDataUrl = ''
      this.dirty = true
    }
    await this.flush()
  }

  snapshot(): readonly ClipboardRecord[] {
    return this.records
  }

  /** 单轮轮询：文本优先，仅文本为空才读图（省解码）；内容指纹未变则跳过 */
  async pollOnce(): Promise<void> {
    const ctx = this.ctx
    if (ctx === null) return
    try {
      const text = await ctx.clipboard.readText()
      if (text !== '') {
        if (this.lastSig !== null && this.lastSig.kind === 'text' && this.lastSig.text === text) return
        if (text.length > MAX_TEXT_CHARS) {
          this.lastSig = { kind: 'text', text }
          return
        }
        if (this.settings.skipSensitive && isSensitiveText(text)) {
          this.lastSig = { kind: 'text', text } // 记指纹防同内容每秒反复过正则
          return
        }
        if (await ctx.clipboard.isTextExempted(text)) {
          this.lastSig = { kind: 'text', text } // 宿主自己写入的敏感内容（vault 指纹豁免）：记指纹防每秒反复查询
          return
        }
        await this.syncExternal()
        this.commit({ id: nextId(), kind: 'text', ts: Date.now(), text })
        this.lastImageDataUrl = ''
      } else {
        const img = await ctx.clipboard.readImage()
        if (img === null) return
        if (this.lastImageDataUrl !== '' && img.dataUrl === this.lastImageDataUrl) return
        const fp = imageFingerprint(img)
        if (this.lastSig !== null && this.lastSig.kind === 'image' && this.lastSig.hash === fp.hash) {
          this.lastImageDataUrl = img.dataUrl
          return
        }
        await this.syncExternal()
        this.commit({
          id: nextId(),
          kind: 'image',
          ts: Date.now(),
          hash: fp.hash,
          width: img.width,
          height: img.height,
          bytes: fp.bytes,
          dataUrl: img.dataUrl
        })
        this.lastImageDataUrl = img.dataUrl
      }
    } catch {
      // Windows（含远程会话剪贴板占用）读取分支未实测：瞬态失败静默放弃本轮
    }
  }

  /**
   * 同步渲染层对 storage 的外部变更；records 非空时内存为准（渲染层副本可能落后）。
   * 清空/单条删除的唯一信号是相应标记变新（渲染层不直写 state），
   * 自己的写入（dirty/saving）未落盘时跳过检测，避免用旧值误判。
   */
  async syncExternal(): Promise<void> {
    if (this.ctx === null) return
    if (this.dirty || this.saving) return
    let marker = 0
    let remove: RemoveMarker | null = null
    let persisted: PersistedClipboardState | null = null
    try {
      marker = parseClearMarker(await this.ctx.storage.get(CLEAR_MARKER_KEY))
      remove = parseRemoveMarker(await this.ctx.storage.get(REMOVE_MARKER_KEY))
      if (marker <= this.clearMarker) {
        persisted = parsePersistedState(await this.ctx.storage.get(STATE_KEY))
      }
    } catch {
      return
    }
    if (marker > this.clearMarker) {
      // 清空优先：并发时清空胜出、被删 id 不复活，只需消费掉删除标记防滞后重复采纳
      if (remove !== null && remove.ts > this.removeMarker) {
        this.removeMarker = remove.ts
        await this.rewriteRemoveMarker(remove)
      }
      try {
        await this.adoptClear(marker)
      } catch {
        this.dirty = true // 清空落盘失败置脏，下轮 flush 重写空状态
      }
      return
    }
    if (remove !== null && remove.ts > this.removeMarker) {
      this.removeMarker = remove.ts
      const kept = adoptRemoveRecords(this.records, remove.ids)
      if (kept !== this.records) {
        this.records = kept
        this.dirty = true
        void this.flush()
        this.ctx.emit('history-changed', { count: this.records.length })
      }
      // 已采纳的 id 清空：同 ts 不重复采纳 = 幂等，标记自身不随删除次数膨胀
      await this.rewriteRemoveMarker(remove)
    }
    if (persisted !== null) this.applySettings(persisted.settings)
  }

  /** 采纳后的删除标记重写为空 id 集；失败无实害（同 ts 幂等，顶多下轮重复采纳一次无变化） */
  private async rewriteRemoveMarker(remove: RemoveMarker): Promise<void> {
    try {
      await this.ctx!.storage.set(REMOVE_MARKER_KEY, { ts: remove.ts, ids: [] })
    } catch {
      // 放弃本轮重写
    }
  }

  /** 采纳清空：消费标记、清内存指纹并落盘空状态（杀掉可能被在途写入复活的历史），再通知渲染层 */
  private async adoptClear(marker: number): Promise<void> {
    this.clearMarker = marker
    this.records = []
    this.lastSig = null
    this.lastImageDataUrl = ''
    // 采纳即消费标记（重写为 0，键形状是数值；与 remove 标记采纳后重写同款）：不消费则重启后内存 clearMarker 归零，同一标记再次被采纳，清掉重启前新采集的历史
    try {
      await this.ctx!.storage.set(CLEAR_MARKER_KEY, 0)
    } catch {
      // 消费失败无补救：本会话不会重采，重启后该标记会被再采纳一次
    }
    await this.ctx!.storage.set(STATE_KEY, toPersisted(this.settings, []))
    this.ctx?.emit('history-changed', { count: 0 })
  }

  private applySettings(next: ClipboardSettings): void {
    const maxRecords = clampMaxRecords(next.maxRecords)
    const clearOnExit = next.clearOnExit === true
    const skipSensitive = next.skipSensitive === true
    if (
      maxRecords === this.settings.maxRecords &&
      clearOnExit === this.settings.clearOnExit &&
      skipSensitive === this.settings.skipSensitive
    ) {
      return
    }
    // 整体重建三字段：漏字段会让 skipSensitive 在每轮 syncExternal→applySettings 后静默归 false
    this.settings = { maxRecords, clearOnExit, skipSensitive }
    const capped = enforceCap(this.records, maxRecords)
    if (capped !== this.records) {
      this.records = capped
      this.dirty = true
      void this.flush()
      this.ctx?.emit('history-changed', { count: this.records.length })
    }
  }

  private commit(rec: ClipboardRecord): void {
    this.records = appendRecord(this.records, rec, rec.ts, this.settings.maxRecords)
    this.lastSig = rec.kind === 'text' ? { kind: 'text', text: rec.text } : { kind: 'image', hash: rec.hash }
    this.dirty = true
    void this.flush()
    this.ctx?.emit('history-changed', { count: this.records.length })
  }

  private async reloadFromStorage(): Promise<void> {
    let persisted: PersistedClipboardState | null = null
    try {
      persisted = parsePersistedState(await this.ctx?.storage.get(STATE_KEY))
    } catch {
      // 读失败按空历史启动
    }
    if (persisted !== null) {
      this.settings = { ...persisted.settings }
      this.records = persisted.records
    }
    const newest = this.records[0]
    if (newest === undefined) {
      this.lastSig = null
      this.lastImageDataUrl = ''
    } else if (newest.kind === 'text') {
      this.lastSig = { kind: 'text', text: newest.text }
      this.lastImageDataUrl = ''
    } else {
      this.lastSig = { kind: 'image', hash: newest.hash }
      this.lastImageDataUrl = newest.dataUrl ?? ''
    }
  }

  /** 落盘（脏标记 + 并发保护）；写前比对清空标记，早于用户清空的在途数据整批丢弃 */
  async flush(): Promise<void> {
    if (this.ctx === null || this.saving || !this.dirty) return
    this.saving = true
    this.dirty = false
    try {
      const marker = parseClearMarker(await this.ctx.storage.get(CLEAR_MARKER_KEY))
      if (marker > this.clearMarker) {
        // 清空发生在脏数据产生后：丢弃在途记录，改写空状态（读标记到写状态间仍有毫秒级窗口，彻底封死需 storage 层 CAS，不做）
        await this.adoptClear(marker)
        return
      }
      await this.ctx.storage.set(STATE_KEY, toPersisted(this.settings, this.records))
    } catch {
      this.dirty = true
    } finally {
      this.saving = false
    }
  }
}

let seq = 0
function nextId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ?? `${Date.now().toString(36)}-${(seq++).toString(36)}`
}

const backend = new ClipboardHistoryBackend()
export default backend
