// 笔记状态纯逻辑：创建/重命名/删除/更新/搜索均为纯函数，持久化由渲染层经 host.storage 完成

export interface NoteRecord {
  id: string
  /** 显式标题，空串表示未命名（展示时回退到内容首行派生标题） */
  title: string
  content: string
  createdAt: number
  updatedAt: number
}

export interface NotesState {
  /** 恒按 updatedAt 倒序（最近编辑在最前） */
  notes: NoteRecord[]
  lastNoteId: string | null
  seq: number
}

export const NOTES_STORAGE_KEY = 'markdown-notes:v1'

export const TITLE_MAX = 60
const DERIVED_TITLE_MAX = 50
const SUMMARY_MAX = 64

/** 首次使用时的示例笔记，展示基础语法 */
export const WELCOME_CONTENT = `# 欢迎使用 Markdown 笔记

在左侧**新建/重命名/删除**笔记，右侧编辑实时预览。

## 基础语法

- 列表项一，支持 \`行内代码\`
- 列表项二，支持 [链接](https://example.com)
  - 嵌套列表

1. 有序列表
2. 自动保存，最近编辑自动恢复

> 引用一段话

\`\`\`ts
const note = '本地持久化'
\`\`\`

| 功能 | 快捷入口 |
| --- | :---: |
| 触发词 | md / 笔记 |
| 导出 | 右上角导出 .md |
`

export function emptyNotesState(): NotesState {
  return { notes: [], lastNoteId: null, seq: 0 }
}

/** 防御性归一化：storage 里的损坏数据（缺字段/类型错）逐条丢弃，绝不抛错 */
export function normalizeNotesState(raw: unknown): NotesState {
  if (typeof raw !== 'object' || raw === null) return emptyNotesState()
  const obj = raw as { notes?: unknown; lastNoteId?: unknown; seq?: unknown }
  if (!Array.isArray(obj.notes)) return emptyNotesState()
  const seen = new Set<string>()
  const notes: NoteRecord[] = []
  for (const item of obj.notes) {
    if (typeof item !== 'object' || item === null) continue
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || r.id === '' || seen.has(r.id)) continue
    seen.add(r.id)
    notes.push({
      id: r.id,
      title: typeof r.title === 'string' ? r.title.slice(0, TITLE_MAX) : '',
      content: typeof r.content === 'string' ? r.content : '',
      createdAt: Number.isFinite(r.createdAt) && (r.createdAt as number) >= 0 ? (r.createdAt as number) : 0,
      updatedAt: Number.isFinite(r.updatedAt) && (r.updatedAt as number) >= 0 ? (r.updatedAt as number) : 0
    })
  }
  notes.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1))
  const lastNoteId = typeof obj.lastNoteId === 'string' && seen.has(obj.lastNoteId) ? obj.lastNoteId : null
  const seq = Number.isFinite(obj.seq) && (obj.seq as number) >= 0 ? Math.floor(obj.seq as number) : notes.length
  return { notes, lastNoteId, seq: Math.max(seq, notes.length) }
}

/** 剥掉常见 Markdown 行级标记（标题/引用/列表/任务点/强调），供标题与摘要派生共用 */
function stripMarks(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s*/, '')
    .replace(/^([-*+]|\d{1,9}[.)])\s+/, '')
    .replace(/^\[([ xX])\]\s+/, '')
    .replace(/[*_~`]+/g, '')
    .trim()
}

/** 从内容首行派生展示标题：跳过代码围栏内的行 */
export function deriveTitle(content: string, fallback = '无标题'): string {
  let inFence = false
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || line === '') continue
    const text = stripMarks(line)
    if (text === '') continue
    return text.length > DERIVED_TITLE_MAX ? `${text.slice(0, DERIVED_TITLE_MAX)}…` : text
  }
  return fallback
}

/** 列表摘要：跳过已用作展示标题的首条文本行，取下一条非空行；无可用行返回 '' */
export function deriveSummary(note: NoteRecord): string {
  let inFence = false
  let titleSkipped = note.title !== ''
  for (const rawLine of note.content.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      inFence = !inFence
      continue
    }
    if (inFence || line === '') continue
    const text = stripMarks(line)
    if (text === '') continue
    if (!titleSkipped) {
      titleSkipped = true
      continue
    }
    return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX)}…` : text
  }
  return ''
}

export function displayTitle(note: NoteRecord): string {
  return note.title !== '' ? note.title : deriveTitle(note.content)
}

function sortedByRecency(notes: NoteRecord[]): NoteRecord[] {
  return [...notes].sort(
    (a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || (a.id < b.id ? -1 : 1)
  )
}

export function nextNoteId(state: NotesState, now: number): string {
  return `note-${now.toString(36)}-${state.seq + 1}`
}

export function createNote(state: NotesState, now: number, content = ''): { state: NotesState; note: NoteRecord } {
  const note: NoteRecord = {
    id: nextNoteId(state, now),
    title: '',
    content,
    createdAt: now,
    updatedAt: now
  }
  return {
    note,
    state: { notes: sortedByRecency([note, ...state.notes]), lastNoteId: note.id, seq: state.seq + 1 }
  }
}

/** 改内容并按最近编辑重排；id 不存在时原样返回（同一引用） */
export function updateNoteContent(state: NotesState, id: string, content: string, now: number): NotesState {
  let found = false
  const notes = state.notes.map((n) => {
    if (n.id !== id) return n
    found = true
    return { ...n, content, updatedAt: now }
  })
  if (!found) return state
  return { ...state, notes: sortedByRecency(notes) }
}

/** 重命名：trim + 截断；空标题视为取消（返回原 state 引用） */
export function renameNote(state: NotesState, id: string, title: string): NotesState {
  const t = title.trim().slice(0, TITLE_MAX)
  if (t === '') return state
  let found = false
  const notes = state.notes.map((n) => {
    if (n.id !== id) return n
    found = true
    return { ...n, title: t }
  })
  if (!found) return state
  return { ...state, notes }
}

/** 删除：lastNoteId 指向被删笔记时顺延到列表首条 */
export function deleteNote(state: NotesState, id: string): NotesState {
  const notes = state.notes.filter((n) => n.id !== id)
  if (notes.length === state.notes.length) return state
  const lastNoteId = state.lastNoteId === id ? (notes[0]?.id ?? null) : state.lastNoteId
  return { ...state, notes, lastNoteId }
}

export function selectNote(state: NotesState, id: string): NotesState {
  return state.notes.some((n) => n.id === id) ? { ...state, lastNoteId: id } : state
}

/** 标题搜索：匹配显式标题或派生标题，大小写不敏感 */
export function filterNotes(notes: NoteRecord[], query: string): NoteRecord[] {
  const q = query.trim().toLowerCase()
  if (q === '') return notes
  return notes.filter((n) => displayTitle(n).toLowerCase().includes(q))
}
