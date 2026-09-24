import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../../../src/plugins/markdown-notes/logic/render'
import {
  NOTES_STORAGE_KEY,
  WELCOME_CONTENT,
  createNote,
  deleteNote,
  deriveTitle,
  displayTitle,
  emptyNotesState,
  filterNotes,
  normalizeNotesState,
  renameNote,
  selectNote,
  updateNoteContent,
  type NoteRecord
} from '../../../../src/plugins/markdown-notes/logic/notes'

function note(id: string, over: Partial<NoteRecord> = {}): NoteRecord {
  return { id, title: '', content: '', createdAt: 1, updatedAt: 1, ...over }
}

describe('normalizeNotesState', () => {
  it('非法输入回空状态', () => {
    expect(normalizeNotesState(null)).toEqual(emptyNotesState())
    expect(normalizeNotesState('x')).toEqual(emptyNotesState())
    expect(normalizeNotesState({ notes: 'no' })).toEqual(emptyNotesState())
  })
  it('逐条丢弃无 id 数据、去重 id、字段损坏按默认值回填', () => {
    const s = normalizeNotesState({
      notes: [
        { id: 'a', content: 'x', createdAt: 1, updatedAt: 5 },
        { no: 'id' },
        { id: 'a', content: 'dup', createdAt: 1, updatedAt: 9 },
        { id: 'b', title: 1, content: null, createdAt: -1, updatedAt: 'x' },
        'junk'
      ],
      lastNoteId: 'zzz',
      seq: 3
    })
    expect(s.notes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(s.notes[0].content).toBe('x')
    expect(s.notes[0].title).toBe('')
    expect(s.notes[0].createdAt).toBe(1)
    expect(s.notes[0].updatedAt).toBe(5)
    expect(s.notes[1].title).toBe('')
    expect(s.notes[1].content).toBe('')
    expect(s.notes[1].createdAt).toBe(0)
    expect(s.notes[1].updatedAt).toBe(0)
    expect(s.lastNoteId).toBeNull()
    expect(s.seq).toBe(3)
  })
  it('按 updatedAt 倒序，合法 lastNoteId 保留', () => {
    const s = normalizeNotesState({
      notes: [note('old', { updatedAt: 1 }), note('new', { updatedAt: 9 })],
      lastNoteId: 'old'
    })
    expect(s.notes.map((n) => n.id)).toEqual(['new', 'old'])
    expect(s.lastNoteId).toBe('old')
  })
  it('seq 缺省回退为条数', () => {
    const s = normalizeNotesState({ notes: [note('a'), note('b')] })
    expect(s.seq).toBe(2)
  })
})

describe('createNote', () => {
  it('新建置顶并设为当前', () => {
    const base = normalizeNotesState({ notes: [note('a', { updatedAt: 9 })], lastNoteId: 'a', seq: 4 })
    const { state, note: n } = createNote(base, 1000)
    expect(n.id).toBe('note-rs-5')
    expect(state.notes[0].id).toBe(n.id)
    expect(state.lastNoteId).toBe(n.id)
    expect(state.seq).toBe(5)
  })
  it('同毫秒连建 id 不冲突（seq 递增）', () => {
    let s = emptyNotesState()
    const ids = new Set<string>()
    for (let i = 0; i < 3; i++) {
      const r = createNote(s, 42)
      ids.add(r.note.id)
      s = r.state
    }
    expect(ids.size).toBe(3)
  })
})

describe('updateNoteContent', () => {
  it('更新内容并按最近编辑置顶', () => {
    const s0 = normalizeNotesState({
      notes: [note('a', { content: '旧', updatedAt: 1 }), note('b', { updatedAt: 9 })]
    })
    const s1 = updateNoteContent(s0, 'a', '新', 100)
    expect(s1.notes[0].id).toBe('a')
    expect(s1.notes[0].content).toBe('新')
    expect(s1.notes[0].updatedAt).toBe(100)
    expect(s0.notes[0].id).toBe('b') // 原 state 不被改写
  })
  it('未知 id 原样返回', () => {
    const s0 = emptyNotesState()
    expect(updateNoteContent(s0, 'nope', 'x', 1)).toBe(s0)
  })
})

describe('renameNote', () => {
  it('trim 并截断到 60 字符', () => {
    const s0 = normalizeNotesState({ notes: [note('a')] })
    const s1 = renameNote(s0, 'a', '  新标题  ')
    expect(s1.notes[0].title).toBe('新标题')
    const long = '标'.repeat(80)
    expect(renameNote(s0, 'a', long).notes[0].title).toHaveLength(60)
  })
  it('空标题与未知 id 不生效', () => {
    const s0 = normalizeNotesState({ notes: [note('a', { title: '原' })] })
    expect(renameNote(s0, 'a', '   ')).toBe(s0)
    expect(renameNote(s0, 'nope', 'x')).toBe(s0)
  })
})

describe('deleteNote', () => {
  it('删除后 lastNoteId 顺延到首条', () => {
    const s0 = normalizeNotesState({
      notes: [note('a', { updatedAt: 9 }), note('b', { updatedAt: 1 })],
      lastNoteId: 'a'
    })
    const s1 = deleteNote(s0, 'a')
    expect(s1.notes.map((n) => n.id)).toEqual(['b'])
    expect(s1.lastNoteId).toBe('b')
  })
  it('删的是非当前笔记时 lastNoteId 不变；未知 id 原样返回', () => {
    const s0 = normalizeNotesState({
      notes: [note('a', { updatedAt: 9 }), note('b', { updatedAt: 1 })],
      lastNoteId: 'a'
    })
    expect(deleteNote(s0, 'b').lastNoteId).toBe('a')
    expect(deleteNote(s0, 'nope')).toBe(s0)
  })
  it('selectNote 未知 id 不生效', () => {
    const s0 = emptyNotesState()
    expect(selectNote(s0, 'nope')).toBe(s0)
    const s1 = normalizeNotesState({ notes: [note('a')], lastNoteId: null })
    expect(selectNote(s1, 'a').lastNoteId).toBe('a')
  })
})

describe('deriveTitle / displayTitle', () => {
  it('从各类首行派生并剥掉标记', () => {
    expect(deriveTitle('# 项目计划\n正文')).toBe('项目计划')
    expect(deriveTitle('普通首行')).toBe('普通首行')
    expect(deriveTitle('- 列表标题')).toBe('列表标题')
    expect(deriveTitle('> 引用标题')).toBe('引用标题')
    expect(deriveTitle('**加粗标题**')).toBe('加粗标题')
    expect(deriveTitle('1. 有序标题')).toBe('有序标题')
  })
  it('跳过空行与围栏行', () => {
    expect(deriveTitle('\n\n```\ncode\n```\n# 真标题')).toBe('真标题')
    expect(deriveTitle('', '空')).toBe('空')
  })
  it('超长截断到 50 字符加省略号', () => {
    expect(deriveTitle('长'.repeat(60))).toBe(`${'长'.repeat(50)}…`)
  })
  it('displayTitle 显式标题优先', () => {
    expect(displayTitle(note('a', { title: 'T', content: '# C' }))).toBe('T')
    expect(displayTitle(note('a', { content: '# C' }))).toBe('C')
  })
})

describe('filterNotes', () => {
  const notes = [
    note('a', { title: 'Work Log', updatedAt: 9 }),
    note('b', { content: '# 会议纪要', updatedAt: 1 })
  ]
  it('按显式/派生标题大小写不敏感匹配', () => {
    expect(filterNotes(notes, 'work').map((n) => n.id)).toEqual(['a'])
    expect(filterNotes(notes, 'WORK')).toEqual([notes[0]])
    expect(filterNotes(notes, '会议').map((n) => n.id)).toEqual(['b'])
  })
  it('空查询返回全部', () => {
    expect(filterNotes(notes, '  ')).toHaveLength(2)
  })
})

describe('示例笔记', () => {
  it('WELCOME_CONTENT 可被渲染器完整渲染且覆盖主要语法', () => {
    const html = renderMarkdown(WELCOME_CONTENT)
    expect(html).toContain('<h1>')
    expect(html).toContain('<li>')
    expect(html).toContain('language-ts')
    expect(html).toContain('<table>')
  })
  it('存储键带版本号命名空间', () => {
    expect(NOTES_STORAGE_KEY).toBe('markdown-notes:v1')
  })
})
