import { describe, expect, it } from 'vitest'
import {
  MAX_TODO_TEXT,
  addTodo,
  dateKeyOf,
  isTodayItem,
  makeTodo,
  parsePersistedTodos,
  removeTodo,
  sortTodos,
  toPersistedTodos,
  toggleTodo,
  todosForView,
  updateTodo,
  type Todo
} from '../../../../src/plugins/todo-pomodoro/logic/todos'

const T0 = 1_700_000_000_000
const TODAY = dateKeyOf(T0)

/** 相对 T0 偏移 N 天的本地日期键（避免测试里硬编码日期与时区纠缠） */
function day(offset: number): string {
  const d = new Date(T0)
  d.setDate(d.getDate() + offset)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function item(partial: Partial<Todo> = {}): Todo {
  return {
    id: partial.id ?? 'a',
    text: partial.text ?? '买牛奶',
    priority: partial.priority ?? 'normal',
    done: partial.done ?? false,
    date: partial.date ?? TODAY,
    completedOn: partial.completedOn ?? null,
    createdAt: partial.createdAt ?? T0,
    updatedAt: partial.updatedAt ?? T0
  }
}

describe('makeTodo / addTodo', () => {
  it('创建默认待办：trim、normal、归属今日', () => {
    const t = makeTodo({ text: '  买牛奶  ', now: T0 })
    expect(t).not.toBeNull()
    expect(t!.text).toBe('买牛奶')
    expect(t!.priority).toBe('normal')
    expect(t!.date).toBe(TODAY)
    expect(t!.done).toBe(false)
    expect(t!.id).not.toBe('')
  })

  it('空文本/纯空白/非字符串返回 null', () => {
    expect(makeTodo({ text: '   ', now: T0 })).toBeNull()
    expect(makeTodo({ text: 42, now: T0 })).toBeNull()
    expect(addTodo([], { text: '', now: T0 })).toBeNull()
  })

  it('超长文本截断到上限', () => {
    const t = makeTodo({ text: 'x'.repeat(MAX_TODO_TEXT + 10), now: T0 })
    expect(t!.text.length).toBe(MAX_TODO_TEXT)
  })

  it('非法优先级回退 normal，非法 date 回退今日', () => {
    const t = makeTodo({ text: 'a', priority: '!!!', date: '2026/09/24', now: T0 })
    expect(t!.priority).toBe('normal')
    expect(t!.date).toBe(TODAY)
  })

  it('addTodo 追加不改原数组', () => {
    const src = [item()]
    const next = addTodo(src, { text: 'b', now: T0 })
    expect(next).not.toBeNull()
    expect(next!.length).toBe(2)
    expect(src.length).toBe(1)
  })
})

describe('updateTodo / toggleTodo / removeTodo', () => {
  it('改文本与优先级', () => {
    const next = updateTodo([item()], 'a', { text: ' 买豆奶 ', priority: 'high' }, T0 + 5)
    expect(next![0].text).toBe('买豆奶')
    expect(next![0].priority).toBe('high')
    expect(next![0].updatedAt).toBe(T0 + 5)
  })

  it('非法文本整体拒绝（返回 null，调用方保持原态）', () => {
    expect(updateTodo([item()], 'a', { text: '  ' }, T0)).toBeNull()
  })

  it('id 不存在返回 null', () => {
    expect(updateTodo([item()], 'nope', { text: 'x' }, T0)).toBeNull()
    expect(toggleTodo([item()], 'nope', T0)).toBeNull()
  })

  it('勾选完成记完成日为今天，取消勾选清空', () => {
    const done = updateTodo([item()], 'a', { done: true }, T0 + 9)
    expect(done![0].done).toBe(true)
    expect(done![0].completedOn).toBe(dateKeyOf(T0 + 9))
    const undone = updateTodo(done!, 'a', { done: false }, T0 + 10)
    expect(undone![0].done).toBe(false)
    expect(undone![0].completedOn).toBeNull()
  })

  it('toggleTodo 双向翻转；removeTodo 删除', () => {
    const one = toggleTodo([item()], 'a', T0)
    expect(one![0].done).toBe(true)
    const back = toggleTodo(one!, 'a', T0)
    expect(back![0].done).toBe(false)
    expect(removeTodo([item({ id: 'x' }), item()], 'x').length).toBe(1)
  })
})

describe('视图与排序', () => {
  it('今日视图：未完成且归属日不晚于今日（含逾期）＋ 今日完成', () => {
    const list = [
      item({ id: 'past', date: day(-4) }),
      item({ id: 'today', date: TODAY }),
      item({ id: 'future', date: day(6) }),
      item({ id: 'done-today', done: true, completedOn: TODAY }),
      item({ id: 'done-yest', done: true, completedOn: day(-1) })
    ]
    const ids = todosForView(list, 'today', TODAY).map((t) => t.id)
    expect(ids).toContain('past')
    expect(ids).toContain('today')
    expect(ids).toContain('done-today')
    expect(ids).not.toContain('future')
    expect(ids).not.toContain('done-yest')
  })

  it('全部视图返回全部（排序后）', () => {
    const list = [item({ id: 'x' }), item({ id: 'y' })]
    expect(todosForView(list, 'all', TODAY).length).toBe(2)
  })

  it('排序：未完成优先 → 优先级高到低 → 新到旧；已完成沉底', () => {
    const list = [
      item({ id: 'done', done: true, completedOn: '2026-09-23', createdAt: T0 }),
      item({ id: 'low-old', priority: 'low', createdAt: T0 }),
      item({ id: 'high-old', priority: 'high', createdAt: T0 }),
      item({ id: 'normal-new', priority: 'normal', createdAt: T0 + 100 }),
      item({ id: 'high-new', priority: 'high', createdAt: T0 + 100 })
    ]
    expect(sortTodos(list).map((t) => t.id)).toEqual(['high-new', 'high-old', 'normal-new', 'low-old', 'done'])
  })

  it('已完成之间按完成日新到旧', () => {
    const list = [
      item({ id: 'old-done', done: true, completedOn: '2026-09-01' }),
      item({ id: 'new-done', done: true, completedOn: '2026-09-23' })
    ]
    expect(sortTodos(list).map((t) => t.id)).toEqual(['new-done', 'old-done'])
  })

  it('isTodayItem 边界：同日字符串比较', () => {
    expect(isTodayItem(item({ date: TODAY }), TODAY)).toBe(true)
    expect(isTodayItem(item({ date: day(1) }), TODAY)).toBe(false)
  })
})

describe('持久化解析', () => {
  it('roundtrip', () => {
    const list = [item(), item({ id: 'b', done: true, completedOn: '2026-09-23', priority: 'low' })]
    expect(parsePersistedTodos(toPersistedTodos(list))).toEqual(list)
  })

  it('结构不对返回 null', () => {
    expect(parsePersistedTodos(null)).toBeNull()
    expect(parsePersistedTodos({ v: 1 })).toBeNull()
    expect(parsePersistedTodos({ items: 'x' })).toBeNull()
  })

  it('坏条目丢弃、好条目保留并修复默认值', () => {
    const raw = {
      v: 1,
      items: [
        { id: 'ok', text: ' ok ', createdAt: T0, updatedAt: T0 },
        { id: 'no-text', text: '  ' },
        'garbage',
        { text: 'no-id-gets-one', priority: 'high' }
      ]
    }
    const out = parsePersistedTodos(raw)!
    expect(out.length).toBe(2)
    expect(out[0].text).toBe('ok')
    expect(out[1].priority).toBe('high')
    expect(out[1].id).not.toBe('')
    expect(out[1].completedOn).toBeNull()
  })
})
