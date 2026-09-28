// 剪贴板历史纯逻辑：记录模型、去重、容量与图片预算收敛、搜索、持久化解析。
// backend（主进程）与渲染层共用，禁用 node API（Buffer 等），两侧才能同一份代码。

export const DEFAULT_MAX_RECORDS = 500
export const MIN_MAX_RECORDS = 10
export const MAX_MAX_RECORDS = 2000
/** 单条文本超此长度不记录，防巨文本撑爆内存与 kv.json */
export const MAX_TEXT_CHARS = 200_000
/** 全部图片 dataUrl 的总字符预算，超出从最旧图片开始清 dataUrl（条目保留但不可回贴） */
export const IMAGE_DATA_BUDGET = 8_000_000

export interface ClipboardTextRecord {
  id: string
  kind: 'text'
  ts: number
  text: string
}

export interface ClipboardImageRecord {
  id: string
  kind: 'image'
  ts: number
  /** 内容指纹（字节长度:宽x高:头4KB哈希），去重判据 */
  hash: string
  width: number
  height: number
  bytes: number
  /** null = 已被预算淘汰，条目仍在但不可回贴 */
  dataUrl: string | null
}

export type ClipboardRecord = ClipboardTextRecord | ClipboardImageRecord

export interface ClipboardSettings {
  maxRecords: number
  clearOnExit: boolean
  /** 敏感内容（密码/JWT/密钥）不入库；旧 kv.json 缺省视为 true */
  skipSensitive: boolean
}

export const DEFAULT_SETTINGS: ClipboardSettings = {
  maxRecords: DEFAULT_MAX_RECORDS,
  clearOnExit: false,
  skipSensitive: true
}

export function clampMaxRecords(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_MAX_RECORDS
  return Math.min(MAX_MAX_RECORDS, Math.max(MIN_MAX_RECORDS, Math.round(n)))
}

export function sameRecordContent(a: ClipboardRecord, b: ClipboardRecord): boolean {
  if (a.kind === 'text') return b.kind === 'text' && a.text === b.text
  return b.kind === 'image' && a.hash === b.hash
}

/** 从最旧图片开始清 dataUrl 直到总量落入预算；预算内原样返回（保持引用相等可作变更判据） */
export function enforceImageBudget(records: ClipboardRecord[], budget: number): ClipboardRecord[] {
  let used = 0
  for (const r of records) {
    if (r.kind === 'image' && r.dataUrl !== null) used += r.dataUrl.length
  }
  if (used <= budget) return records
  const next = records.slice()
  for (let i = next.length - 1; i >= 0 && used > budget; i--) {
    const r = next[i]
    if (r.kind !== 'image' || r.dataUrl === null) continue
    used -= r.dataUrl.length
    next[i] = { ...r, dataUrl: null }
  }
  return next
}

/** 超容量淘汰最旧（数组头新尾旧）；不做 settings 收敛（那是入库点的职责），未超返回原引用 */
export function enforceCap(records: ClipboardRecord[], maxRecords: number): ClipboardRecord[] {
  if (!Number.isFinite(maxRecords) || maxRecords < 1) return records
  return records.length > maxRecords ? records.slice(0, Math.floor(maxRecords)) : records
}

/** 与最新一条内容相同只刷新时间戳，否则插到最前并做容量与图片预算收敛 */
export function appendRecord(
  records: ClipboardRecord[],
  incoming: ClipboardRecord,
  now: number,
  maxRecords: number
): ClipboardRecord[] {
  const newest = records[0]
  if (newest !== undefined && sameRecordContent(newest, incoming)) {
    return [{ ...newest, ts: now }, ...records.slice(1)]
  }
  return enforceImageBudget(enforceCap([incoming, ...records], maxRecords), IMAGE_DATA_BUDGET)
}

export function filterRecords(records: ClipboardRecord[], query: string): ClipboardRecord[] {
  const q = query.trim().toLowerCase()
  if (q === '') return records
  return records.filter((r) => haystackOf(r).includes(q))
}

function haystackOf(r: ClipboardRecord): string {
  if (r.kind === 'text') return r.text.toLowerCase()
  return `图片 image ${r.width}x${r.height} ${r.bytes}`
}

export function previewOf(record: ClipboardRecord, maxLen = 120): string {
  if (record.kind === 'image') return `图片 ${record.width}×${record.height}`
  const collapsed = record.text.replace(/\s+/g, ' ').trim()
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen)}…` : collapsed
}

export interface PersistedClipboardState {
  v: 1
  settings: ClipboardSettings
  records: ClipboardRecord[]
}

/** 清空标记键：渲染层只写此键（单调递增数值），backend 比对后统一落盘，避免双方直写 state 互相覆盖 */
export const CLEAR_MARKER_KEY = 'clear-marker'

/** 单条删除标记：与 CLEAR_MARKER_KEY 同款「渲染层只写标记、backend 采纳后统一落盘」协议 */
export const REMOVE_MARKER_KEY = 'remove-marker'

export interface RemoveMarker {
  /** 产生时刻：backend 只采纳 ts 更新的标记（同 ts 不重复采纳 = 幂等） */
  ts: number
  ids: string[]
}

/** 防御式解析删除标记：结构不对返回 null（视为无删除） */
export function parseRemoveMarker(raw: unknown): RemoveMarker | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return null
  if (!Array.isArray(o.ids)) return null
  return { ts: o.ts, ids: o.ids.filter((x): x is string => typeof x === 'string') }
}

/** 采纳单条删除：与现存 id 取交集防标记膨胀；无变化返回原引用（可作是否落盘判据） */
export function adoptRemoveRecords<T extends { id: string }>(records: readonly T[], ids: readonly string[]): T[] {
  const dead = new Set(ids)
  const kept = records.filter((r) => !dead.has(r.id))
  return kept.length === records.length ? (records as T[]) : kept
}

/** 删除标记读-改-写的最小存储面：真实 HostApi.storage 与测试 fake 均可直接注入 */
export interface RemoveMarkerStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

// 模块级互斥队列：并发删除串行化读-改-写，防「同时读到旧 ids 后互相覆盖」丢 id（与 backend 置空标记的并发同理）
let removeWriteChain: Promise<void> = Promise.resolve()
let lastRemoveTs = 0

/** 串行化追加删除 id：ts 严格单调（同刻多次删除不被 backend 幂等去重）；失败向上 reject 但不阻塞队列后续写入 */
export function appendRemoveId(store: RemoveMarkerStore, id: string, now: number): Promise<void> {
  const write = removeWriteChain.then(async () => {
    const cur = parseRemoveMarker(await store.get(REMOVE_MARKER_KEY))
    lastRemoveTs = Math.max(now, lastRemoveTs + 1, cur?.ts ?? 0)
    await store.set(REMOVE_MARKER_KEY, { ts: lastRemoveTs, ids: [...(cur?.ids ?? []), id] })
  })
  removeWriteChain = write.catch(() => {})
  return write
}

export function toPersisted(settings: ClipboardSettings, records: ClipboardRecord[]): PersistedClipboardState {
  return { v: 1, settings: { ...settings }, records: records.map((r) => ({ ...r })) }
}

/** 防御式解析存储整包状态：结构不对返回 null（视为无历史），坏条目丢弃 */
export function parsePersistedState(raw: unknown): PersistedClipboardState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  if (obj.v !== 1) return null
  const settings = parseSettings(obj.settings)
  const rawRecords = Array.isArray(obj.records) ? obj.records : []
  const records: ClipboardRecord[] = []
  for (const item of rawRecords) {
    const rec = parseRecord(item)
    if (rec !== null) records.push(rec)
  }
  records.sort((a, b) => b.ts - a.ts)
  return {
    v: 1,
    settings,
    records: enforceImageBudget(enforceCap(records, settings.maxRecords), IMAGE_DATA_BUDGET)
  }
}

function parseSettings(raw: unknown): ClipboardSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS }
  const o = raw as Record<string, unknown>
  return {
    maxRecords: typeof o.maxRecords === 'number' ? clampMaxRecords(o.maxRecords) : DEFAULT_MAX_RECORDS,
    clearOnExit: o.clearOnExit === true,
    // 缺省回 true 兼容旧 kv.json（旧状态无此字段），仅显式 false 才关闭过滤
    skipSensitive: o.skipSensitive !== false
  }
}

function parseRecord(raw: unknown): ClipboardRecord | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id === '') return null
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return null
  if (o.kind === 'text') {
    if (typeof o.text !== 'string') return null
    return { id: o.id, kind: 'text', ts: o.ts, text: o.text }
  }
  if (o.kind === 'image') {
    if (typeof o.hash !== 'string') return null
    if (typeof o.width !== 'number' || typeof o.height !== 'number' || typeof o.bytes !== 'number') return null
    return {
      id: o.id,
      kind: 'image',
      ts: o.ts,
      hash: o.hash,
      width: o.width,
      height: o.height,
      bytes: o.bytes,
      dataUrl: typeof o.dataUrl === 'string' ? o.dataUrl : null
    }
  }
  return null
}
