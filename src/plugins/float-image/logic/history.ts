// 悬浮历史：贴过的图持久化留存，插件页点击行可再次悬浮
import { sanitizeDataUrl } from './float-html'
import type { NaturalSize } from './state'

export const HISTORY_MAX_ITEMS = 12
/** 历史总字符封顶（与浮窗 html 预算同量级），超出从最旧开始丢弃 */
export const HISTORY_MAX_CHARS = 4_800_000

export interface PinHistoryItem {
  dataUrl: string
  label: string
  natural: NaturalSize
  thumb: string
  at: number
}

/** 新贴图入列：同图去重置顶，条数/总字符双封顶（从最旧丢） */
export function pushPinHistory(
  list: PinHistoryItem[],
  item: PinHistoryItem,
  maxItems = HISTORY_MAX_ITEMS,
  maxChars = HISTORY_MAX_CHARS
): PinHistoryItem[] {
  // 单条自身超总预算不入列：入了会让 while 把存量连自身一起弹空
  if (item.dataUrl.length + item.thumb.length > maxChars) return list
  const next = [item, ...list.filter((x) => x.dataUrl !== item.dataUrl)]
  let total = next.reduce((s, x) => s + x.dataUrl.length + x.thumb.length, 0)
  while (next.length > 0 && (next.length > maxItems || total > maxChars)) {
    const dropped = next.pop()
    total -= (dropped?.dataUrl.length ?? 0) + (dropped?.thumb.length ?? 0)
  }
  return next
}

function capList(list: PinHistoryItem[]): PinHistoryItem[] {
  if (list.length <= HISTORY_MAX_ITEMS) {
    const t = list.reduce((s, x) => s + x.dataUrl.length + x.thumb.length, 0)
    if (t <= HISTORY_MAX_CHARS) return list
  }
  return pushPinHistory(list.slice(1), list[0] as PinHistoryItem)
}

/** 存储读回净化：字段非法的条目整条丢弃，再按双封顶裁剪 */
export function normalizePinHistory(raw: unknown): PinHistoryItem[] {
  if (!Array.isArray(raw)) return []
  const out: PinHistoryItem[] = []
  for (const r of raw.slice(0, HISTORY_MAX_ITEMS)) {
    if (typeof r !== 'object' || r === null) continue
    const x = r as Record<string, unknown>
    const dataUrl = sanitizeDataUrl(x.dataUrl)
    const thumb = sanitizeDataUrl(x.thumb) ?? ''
    if (dataUrl === null) continue
    const label = typeof x.label === 'string' && x.label !== '' ? x.label.slice(0, 40) : '悬浮图片'
    const nw = typeof (x.natural as { width?: unknown })?.width === 'number' ? (x.natural as { width: number }).width : NaN
    const nh = typeof (x.natural as { height?: unknown })?.height === 'number' ? (x.natural as { height: number }).height : NaN
    if (!Number.isInteger(nw) || !Number.isInteger(nh) || nw <= 0 || nh <= 0) continue
    const at = typeof x.at === 'number' && Number.isFinite(x.at) ? x.at : 0
    out.push({ dataUrl, label, natural: { width: nw, height: nh }, thumb, at })
  }
  return capList(out)
}
