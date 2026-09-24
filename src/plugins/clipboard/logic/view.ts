// 剪贴板视图层纯逻辑：条目分类、固定/隐藏的 UI 状态、demo 示例数据。
// 仅渲染层 import（backend 不依赖）；无 vue/node API，保持与 history.ts 同样的可测纯函数风格。

import type { ClipboardRecord } from './history'

export type EntryTab = 'all' | 'text' | 'link' | 'image' | 'file'
export type EntryKind = Exclude<EntryTab, 'all'>

export const TAB_DEFS: readonly { id: EntryTab; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'text', label: '文本' },
  { id: 'link', label: '链接' },
  { id: 'image', label: '图片' },
  { id: 'file', label: '文件' }
]

export const KIND_LABELS: Record<EntryKind, string> = { text: '文本', link: '链接', image: '图片', file: '文件' }

/** 文本条目按内容细分：单行 http(s) URL → 链接；单行绝对路径/file:// → 文件；判定保守，宁归文本勿误判 */
export function entryKindOf(r: ClipboardRecord): EntryKind {
  if (r.kind === 'image') return 'image'
  const t = r.text.trim()
  if (/[\r\n]/.test(t)) return 'text'
  if (/^https?:\/\/\S+$/i.test(t)) return 'link'
  if (isLikelyPath(t)) return 'file'
  return 'text'
}

function isLikelyPath(t: string): boolean {
  if (/^file:\/\//i.test(t)) return true
  if (/^~\/\S+$/.test(t)) return true
  // POSIX 绝对路径且至少两级（/tmp 这类单级太容易与普通文本混淆，不认）
  if (/^\/\S*$/.test(t) && t.slice(1).includes('/')) return true
  if (/^[a-z]:[\\/]\S+$/i.test(t)) return true
  return false
}

/**
 * 渲染层私有的 UI 偏好（固定/删除）：backend 只认 state 与 clear-marker，
 * 渲染层直写 state 会与 backend 在途写入互相覆盖，故固定/删除落在独立键，由展示层过滤实现。
 */
export const UI_STATE_KEY = 'ui-state'

export interface ClipboardUiState {
  pinned: string[]
  hidden: string[]
}

export const EMPTY_UI_STATE: ClipboardUiState = { pinned: [], hidden: [] }

export function parseUiState(raw: unknown): ClipboardUiState {
  if (typeof raw !== 'object' || raw === null) return { pinned: [], hidden: [] }
  const o = raw as Record<string, unknown>
  return {
    pinned: Array.isArray(o.pinned) ? o.pinned.filter((x): x is string => typeof x === 'string') : [],
    hidden: Array.isArray(o.hidden) ? o.hidden.filter((x): x is string => typeof x === 'string') : []
  }
}

/** 记录被容量淘汰/清空后清悬空 id；无变化返回原引用（可作是否回写的判据） */
export function pruneUiState(state: ClipboardUiState, records: readonly ClipboardRecord[]): ClipboardUiState {
  const alive = new Set(records.map((r) => r.id))
  const pinned = state.pinned.filter((id) => alive.has(id))
  const hidden = state.hidden.filter((id) => alive.has(id))
  if (pinned.length === state.pinned.length && hidden.length === state.hidden.length) return state
  return { pinned, hidden }
}

export function togglePin(state: ClipboardUiState, id: string): ClipboardUiState {
  const has = state.pinned.includes(id)
  return { ...state, pinned: has ? state.pinned.filter((x) => x !== id) : [id, ...state.pinned] }
}

export function hideRecord(state: ClipboardUiState, id: string): ClipboardUiState {
  if (state.hidden.includes(id)) return state
  return { pinned: state.pinned.filter((x) => x !== id), hidden: [id, ...state.hidden] }
}

/** 固定条目置顶（组内仍按记录自身时间序，records 已是 ts 降序）；无固定项返回原引用 */
export function orderRecords(records: readonly ClipboardRecord[], pinned: ReadonlySet<string>): ClipboardRecord[] {
  if (pinned.size === 0) return records as ClipboardRecord[]
  const head: ClipboardRecord[] = []
  const tail: ClipboardRecord[] = []
  for (const r of records) (pinned.has(r.id) ? head : tail).push(r)
  return head.concat(tail)
}

export function filterByTab(records: readonly ClipboardRecord[], tab: EntryTab): ClipboardRecord[] {
  if (tab === 'all') return records as ClipboardRecord[]
  return records.filter((r) => entryKindOf(r) === tab)
}

export interface DemoEntry {
  record: ClipboardRecord
  /** 来源应用为示例值：SDK/Electron 剪贴板不暴露来源应用，真实记录该槽位显示类型标签 */
  sourceApp: string
}

const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/** demo 视图（initialCommand==='demo'）：6 条固定内容示例（2 文本/1 链接/1 图片占位/1 文件/1 置顶），时间相对入页时刻 */
export function buildDemoEntries(now: number): { entries: DemoEntry[]; pinnedIds: string[] } {
  const entries: DemoEntry[] = [
    {
      sourceApp: '备忘录',
      record: {
        id: 'demo-pin',
        kind: 'text',
        ts: now - 26 * MIN,
        text: 'GTools 四期验收要点：分类 tab、卡片两行截断、hover 操作组、固定置顶带徽标'
      }
    },
    {
      sourceApp: 'Safari',
      record: { id: 'demo-link', kind: 'text', ts: now - 20 * MIN, text: 'https://electronjs.org/docs/latest/api/clipboard' }
    },
    {
      sourceApp: '截图',
      record: { id: 'demo-img', kind: 'image', ts: now - 45 * MIN, hash: 'demo', width: 1200, height: 800, bytes: 384_000, dataUrl: null }
    },
    {
      sourceApp: '微信',
      record: {
        id: 'demo-text',
        kind: 'text',
        ts: now - 2 * HOUR,
        text: '周会纪要 0.9.4\n- 剪贴板历史改版进入验收\n- 下周对齐 translate 双栏布局\n- 记得同步 themes.css 新 token'
      }
    },
    {
      sourceApp: 'VS Code',
      record: { id: 'demo-cmd', kind: 'text', ts: now - 5 * HOUR, text: 'npm run typecheck && npx vitest run --coverage' }
    },
    {
      sourceApp: 'Finder',
      record: { id: 'demo-file', kind: 'text', ts: now - DAY - 3 * HOUR, text: '/Users/demo/Documents/GTools-验收报告.pdf' }
    }
  ]
  return { entries, pinnedIds: ['demo-pin'] }
}
