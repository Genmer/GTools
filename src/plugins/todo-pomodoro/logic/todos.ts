/** 待办纯逻辑：类型、增删改、视图过滤与排序。渲染层为数据属主，backend 不写此键。 */

export type Priority = 'high' | 'normal' | 'low'

export const PRIORITY_ORDER: Record<Priority, number> = { high: 0, normal: 1, low: 2 }

export const PRIORITY_LABEL: Record<Priority, string> = { high: '高', normal: '中', low: '低' }

export interface Todo {
  id: string
  text: string
  priority: Priority
  done: boolean
  /** 归属日本地日期 YYYY-MM-DD，今日视图按它判定 */
  date: string
  /** 完成日 YYYY-MM-DD，未完成为 null */
  completedOn: string | null
  createdAt: number
  updatedAt: number
}

export const MAX_TODO_TEXT = 500

/** 本地时区日期键（渲染层与 backend 同机同时区，判定一致） */
export function dateKeyOf(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function clampPriority(v: unknown): Priority {
  return v === 'high' || v === 'low' ? v : 'normal'
}

let seq = 0
export function nextTodoId(): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return uuid ?? `${Date.now().toString(36)}-${(seq++).toString(36)}`
}

export function cleanTodoText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().slice(0, MAX_TODO_TEXT)
  return t === '' ? null : t
}

export interface TodoInput {
  text: unknown
  priority?: unknown
  date?: unknown
  id?: string
  now: number
}

export function makeTodo(input: TodoInput): Todo | null {
  const text = cleanTodoText(input.text)
  if (text === null) return null
  return {
    id: typeof input.id === 'string' && input.id !== '' ? input.id : nextTodoId(),
    text,
    priority: clampPriority(input.priority),
    done: false,
    date: typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : dateKeyOf(input.now),
    completedOn: null,
    createdAt: input.now,
    updatedAt: input.now
  }
}

/** 追加一条待办；文本无效返回 null（调用方保持原数组） */
export function addTodo(todos: readonly Todo[], input: TodoInput): Todo[] | null {
  const t = makeTodo(input)
  if (t === null) return null
  return [...todos, t]
}

export interface TodoPatch {
  text?: unknown
  priority?: unknown
  done?: unknown
}

/** 改一条待办；id 不存在或 patch 无有效字段返回 null。勾选完成会带出 completedOn */
export function updateTodo(todos: readonly Todo[], id: string, patch: TodoPatch, now: number): Todo[] | null {
  let touched = false
  const next = todos.map((t): Todo => {
    if (t.id !== id) return t
    const o: Todo = { ...t, updatedAt: now }
    let changed = false
    if (patch.text !== undefined) {
      const text = cleanTodoText(patch.text)
      if (text === null) return t
      o.text = text
      changed = true
    }
    if (patch.priority !== undefined) {
      o.priority = clampPriority(patch.priority)
      changed = true
    }
    if (patch.done !== undefined) {
      const done = patch.done === true
      if (o.done !== done) {
        o.done = done
        o.completedOn = done ? dateKeyOf(now) : null
        changed = true
      }
    }
    if (!changed) return t
    touched = true
    return o
  })
  return touched ? next : null
}

export function toggleTodo(todos: readonly Todo[], id: string, now: number): Todo[] | null {
  const cur = todos.find((t) => t.id === id)
  if (cur === undefined) return null
  return updateTodo(todos, id, { done: !cur.done }, now)
}

export function removeTodo(todos: readonly Todo[], id: string): Todo[] {
  return todos.filter((t) => t.id !== id)
}

/** 排序：未完成在前，同级按优先级高→低、新→旧；已完成沉底按完成时间新→旧 */
export function sortTodos(todos: readonly Todo[]): Todo[] {
  return [...todos].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    if (!a.done) {
      const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      if (p !== 0) return p
      return b.createdAt - a.createdAt
    }
    const bd = b.completedOn ?? String(b.updatedAt)
    const ad = a.completedOn ?? String(a.updatedAt)
    return bd.localeCompare(ad)
  })
}

export type TodoView = 'today' | 'all'

/** 今日视图：未完成且归属日不晚于今日（含逾期顺延）＋ 今日完成的事项 */
export function isTodayItem(t: Todo, today: string): boolean {
  if (!t.done) return t.date <= today
  return t.completedOn === today
}

export function todosForView(todos: readonly Todo[], view: TodoView, today: string): Todo[] {
  const filtered = view === 'all' ? [...todos] : todos.filter((t) => isTodayItem(t, today))
  return sortTodos(filtered)
}

export interface PersistedTodos {
  v: 1
  items: Todo[]
}

export function toPersistedTodos(todos: readonly Todo[]): PersistedTodos {
  return { v: 1, items: [...todos] }
}

/** 宽松解析：坏条目丢弃而非整体失败；结构不对返回 null（调用方保持现态） */
export function parsePersistedTodos(raw: unknown): Todo[] | null {
  if (typeof raw !== 'object' || raw === null) return null
  const items = (raw as { items?: unknown }).items
  if (!Array.isArray(items)) return null
  const out: Todo[] = []
  for (const it of items) {
    if (typeof it !== 'object' || it === null) continue
    const r = it as Record<string, unknown>
    const text = cleanTodoText(r.text)
    if (text === null) continue
    const now = typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : 0
    out.push({
      id: typeof r.id === 'string' && r.id !== '' ? r.id : nextTodoId(),
      text,
      priority: clampPriority(r.priority),
      done: r.done === true,
      date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : dateKeyOf(now),
      completedOn:
        typeof r.completedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.completedOn) ? r.completedOn : null,
      createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : now,
      updatedAt: now
    })
  }
  return out
}
