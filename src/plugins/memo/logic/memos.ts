// 便签纯逻辑：数据模型 / 排序 / 增删置顶均为纯函数，持久化由渲染层经 host.storage 完成

export interface MemoRecord {
  id: string
  text: string
  /** 置顶便签分组在上 */
  pinned: boolean
  createdAt: number
}

export interface MemoState {
  /** 恒为展示序：置顶在前，组内 createdAt 倒序 */
  memos: MemoRecord[]
  /** id 递增序号，避免同毫秒新建撞 id */
  seq: number
}

export const MEMOS_STORAGE_KEY = 'memo:v1'

/** 单条文本上限，防误粘贴巨文撑爆存储与渲染 */
export const TEXT_MAX = 2000

export function emptyMemoState(): MemoState {
  return { memos: [], seq: 0 }
}

/** 展示排序：置顶分组在上，组内 createdAt 倒序，id 兜底保证稳定序 */
export function sortMemos(memos: MemoRecord[]): MemoRecord[] {
  return [...memos].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)
  )
}

/** 防御性归一化：损坏数据（缺 id / 空文本 / 类型错）逐条丢弃并去重，绝不抛错 */
export function normalizeMemoState(raw: unknown): MemoState {
  if (typeof raw !== 'object' || raw === null) return emptyMemoState()
  const obj = raw as { memos?: unknown; seq?: unknown }
  if (!Array.isArray(obj.memos)) return emptyMemoState()
  const seen = new Set<string>()
  const memos: MemoRecord[] = []
  for (const item of obj.memos) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || r.id === '' || seen.has(r.id)) continue
    if (typeof r.text !== 'string' || r.text.trim() === '') continue
    seen.add(r.id)
    memos.push({
      id: r.id,
      text: r.text.slice(0, TEXT_MAX),
      pinned: r.pinned === true,
      createdAt: Number.isFinite(r.createdAt) && (r.createdAt as number) >= 0 ? (r.createdAt as number) : 0
    })
  }
  const seq = Number.isFinite(obj.seq) && (obj.seq as number) >= 0 ? Math.floor(obj.seq as number) : memos.length
  return { memos: sortMemos(memos), seq: Math.max(seq, memos.length) }
}

/** 空白文本返回 memo:null 且 state 引用不变（调用方据此不做任何 UI 变更） */
export function createMemo(state: MemoState, text: string, now: number): { state: MemoState; memo: MemoRecord | null } {
  const t = text.trim().slice(0, TEXT_MAX)
  if (t === '') return { state, memo: null }
  const memo: MemoRecord = { id: `memo-${now.toString(36)}-${state.seq + 1}`, text: t, pinned: false, createdAt: now }
  return { state: { memos: sortMemos([memo, ...state.memos]), seq: state.seq + 1 }, memo }
}

/** id 不存在时原样返回（同一引用），调用方可跳过持久化 */
export function deleteMemo(state: MemoState, id: string): MemoState {
  const memos = state.memos.filter((m) => m.id !== id)
  if (memos.length === state.memos.length) return state
  return { ...state, memos }
}

export function togglePin(state: MemoState, id: string): MemoState {
  let found = false
  const memos = state.memos.map((m) => {
    if (m.id !== id) return m
    found = true
    return { ...m, pinned: !m.pinned }
  })
  if (!found) return state
  return { ...state, memos: sortMemos(memos) }
}

/** demo 态固定示例（3 条、1 条置顶、1 条长文演示两行截断）；时间戳固定保证截图稳定 */
export function demoMemoState(): MemoState {
  return {
    memos: sortMemos([
      { id: 'demo-pin', text: '每周五 17:30 前提交周报，模板在团队文档库「周报 / 2026」', pinned: true, createdAt: 1789952400000 },
      { id: 'demo-2', text: '牛奶 · 鸡蛋 · 咖啡豆 · 洗衣液（周末采购）', pinned: false, createdAt: 1790145000000 },
      {
        id: 'demo-3',
        text: '读书笔记《黑客与画家》第 3 章：品味不是玄学，好设计往往「简单、永恒、贴近问题本质」；先做一个能跑的粗糙版本，再在真实使用里打磨，比一开始就追求完美更容易做出好东西——周末项目、包括这个启动器本身，都是这么长出来的。周末把剩下的章节读完。',
        pinned: false,
        createdAt: 1790166600000
      }
    ]),
    seq: 3
  }
}
