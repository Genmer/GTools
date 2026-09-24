import type { HotItem } from './types'

export function toKeys(items: readonly HotItem[]): string[] {
  return items.map((i) => i.key)
}

/**
 * 与上一次快照对比标记『新上榜』：prevKeys 为空（首次拉取/换设备无缓存）时不标，
 * 避免首次打开满屏都是『新』。
 */
export function markNew(current: readonly HotItem[], prevKeys: readonly string[]): HotItem[] {
  const prev = new Set(prevKeys)
  return current.map((i) => ({ ...i, isNew: prev.size > 0 && !prev.has(i.key) }))
}
