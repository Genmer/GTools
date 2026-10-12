import { pinyin } from 'pinyin-pro'
import { matchEntry, type PinyinIndexed, type SearchEntry } from './matcher'

const cache = new Map<string, PinyinIndexed>()

// pinyin-pro type:'all' 项的最小结构面（官方 AllData 子集，两侧类型名不导出故本地声明）
interface PinyinItem {
  origin: string
  pinyin: string
  first: string
  isZh: boolean
}

/** 对 title 预计算拼音索引（多音字取默认读音，已知限制）；同 title 复用缓存。
 *  单次 type:'all' 同时产出全拼与首字母：首字母口径 = 中文取首字母、非中文保留原文（与拆两次调用结果一致） */
export function pinyinIndex(title: string): PinyinIndexed {
  const hit = cache.get(title)
  if (hit) return hit
  // nonZh:'consecutive' 让英文单词整体保留（如 'json'），避免逐字母拆散音节对齐
  const items = pinyin(title, { toneType: 'none', type: 'all', nonZh: 'consecutive' }) as unknown as PinyinItem[]
  const syllables: string[] = []
  let run = ''
  for (const it of items) {
    if (it.isZh) {
      if (run !== '') syllables.push(run)
      run = ''
      syllables.push(it.pinyin)
    } else {
      run += it.origin
    }
  }
  if (run !== '') syllables.push(run)
  const indexed: PinyinIndexed = {
    lower: title.toLowerCase(),
    compact: title.toLowerCase().replace(/\s+/g, ''),
    syllables,
    initials: items.map((it) => (it.isZh ? it.first : it.origin)).join('').toLowerCase()
  }
  cache.set(title, indexed)
  return indexed
}

// 空闲预建：首键不再停顿数十毫秒；分批跑在 idle 回调（node/测试环境退化为 setTimeout）不与输入抢帧
const WARM_CHUNK = 40
const warmPending = new Set<string>()
let warmScheduled = false

function scheduleWarm(): void {
  if (warmScheduled) return
  warmScheduled = true
  const step = (): void => {
    warmScheduled = false
    for (let i = 0; i < WARM_CHUNK && warmPending.size > 0; i++) {
      const t = warmPending.values().next().value
      if (t === undefined) break
      warmPending.delete(t)
      pinyinIndex(t)
    }
    if (warmPending.size > 0) scheduleWarm()
  }
  const g = globalThis as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    setTimeout: (cb: () => void, ms: number) => unknown
  }
  if (typeof g.requestIdleCallback === 'function') g.requestIdleCallback(step, { timeout: 2000 })
  else g.setTimeout(step, 16)
}

/** 启动/词条池变化后调用：未建索引的标题排进空闲批处理（已建即跳过，重复调用幂等） */
export function warmupPinyinIndex(titles: readonly string[]): void {
  for (const t of titles) {
    if (t !== '' && !cache.has(t)) warmPending.add(t)
  }
  if (warmPending.size > 0) scheduleWarm()
}

/** 对词条的 title + 额外 keywords 全部建索引，匹配取最小分 */
export function matchEntryBest(query: string, entry: SearchEntry): number | null {
  const titles = [entry.title, ...(entry.keywords ?? [])]
  let best: number | null = null
  for (const t of titles) {
    const score = matchEntry(query, entry, pinyinIndex(t))
    if (score !== null && (best === null || score < best)) best = score
  }
  return best
}
