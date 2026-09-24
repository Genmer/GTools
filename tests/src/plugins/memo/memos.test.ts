import { describe, expect, it } from 'vitest'
import {
  MEMOS_STORAGE_KEY,
  TEXT_MAX,
  createMemo,
  deleteMemo,
  demoMemoState,
  emptyMemoState,
  normalizeMemoState,
  sortMemos,
  togglePin,
  type MemoRecord
} from '../../../../src/plugins/memo/logic/memos'

function memo(id: string, over: Partial<MemoRecord> = {}): MemoRecord {
  return { id, text: `text-${id}`, pinned: false, createdAt: 1, ...over }
}

describe('sortMemos', () => {
  it('置顶分组在上，组内 createdAt 倒序', () => {
    const sorted = sortMemos([
      memo('a', { createdAt: 1 }),
      memo('b', { pinned: true, createdAt: 1 }),
      memo('c', { createdAt: 3 }),
      memo('d', { pinned: true, createdAt: 9 }),
      memo('e', { createdAt: 2 })
    ])
    expect(sorted.map((m) => m.id)).toEqual(['d', 'b', 'c', 'e', 'a'])
  })
  it('同 pinned 同 createdAt 时按 id 稳定排序', () => {
    const sorted = sortMemos([memo('z'), memo('a'), memo('m')])
    expect(sorted.map((m) => m.id)).toEqual(['a', 'm', 'z'])
  })
  it('返回新数组，不改入参顺序', () => {
    const input = [memo('a', { createdAt: 2 }), memo('b', { createdAt: 9 })]
    const sorted = sortMemos(input)
    expect(input.map((m) => m.id)).toEqual(['a', 'b'])
    expect(sorted.map((m) => m.id)).toEqual(['b', 'a'])
  })
})

describe('normalizeMemoState', () => {
  it('非法输入回空状态', () => {
    expect(normalizeMemoState(null)).toEqual(emptyMemoState())
    expect(normalizeMemoState('x')).toEqual(emptyMemoState())
    expect(normalizeMemoState({ memos: 'no' })).toEqual(emptyMemoState())
  })
  it('逐条丢弃无 id / 空文本数据、去重 id、字段损坏按默认值回填', () => {
    const s = normalizeMemoState({
      memos: [
        { id: 'a', text: 'x', createdAt: 5, pinned: true },
        { no: 'id' },
        { id: 'a', text: 'dup' },
        { id: 'b', text: '   ' },
        { id: 'c', text: 1, createdAt: -1, pinned: 'yes' },
        'junk'
      ],
      seq: 3
    })
    expect(s.memos.map((m) => m.id)).toEqual(['a'])
    expect(s.memos[0].pinned).toBe(true)
    expect(s.seq).toBe(3)
  })
  it('超长文本截断到 TEXT_MAX，seq 兜底不少于条数', () => {
    const s = normalizeMemoState({ memos: [{ id: 'a', text: 'x'.repeat(TEXT_MAX + 50) }], seq: -1 })
    expect(s.memos[0].text.length).toBe(TEXT_MAX)
    expect(s.seq).toBe(1)
  })
  it('seq 为小数向下取整，缺失时回退条数', () => {
    expect(normalizeMemoState({ memos: [], seq: 2.7 }).seq).toBe(2)
    expect(normalizeMemoState({ memos: [{ id: 'a', text: 'x' }] }).seq).toBe(1)
  })
})

describe('createMemo', () => {
  it('新增便签落在置顶组之下、普通组之首', () => {
    const base = { memos: [memo('p', { pinned: true }), memo('old', { createdAt: 1 })], seq: 7 }
    const { state, memo: created } = createMemo(base, '新便签', 100)
    expect(created?.text).toBe('新便签')
    expect(created?.pinned).toBe(false)
    expect(state.memos.map((m) => m.id)).toEqual(['p', expect.any(String), 'old'])
    expect(state.seq).toBe(8)
  })
  it('空白文本返回 memo:null 且 state 引用不变', () => {
    const base = emptyMemoState()
    const r = createMemo(base, '   \n  ', 100)
    expect(r.memo).toBeNull()
    expect(r.state).toBe(base)
  })
  it('文本 trim 并截断到 TEXT_MAX', () => {
    const { memo: m } = createMemo(emptyMemoState(), `  ${'x'.repeat(TEXT_MAX + 10)}  `, 1)
    expect(m?.text.length).toBe(TEXT_MAX)
  })
  it('id 编码时间戳与 seq：同毫秒连续创建不撞 id', () => {
    const base = emptyMemoState()
    const first = createMemo(base, '一', 100)
    const second = createMemo(first.state, '二', 100)
    // 100 的 36 进制为 2s，seq 从 0 起递增
    expect(first.memo?.id).toBe('memo-2s-1')
    expect(second.memo?.id).toBe('memo-2s-2')
    expect(first.memo?.id).not.toBe(second.memo?.id)
  })
})

describe('deleteMemo / togglePin', () => {
  it('删除目标便签；未知 id 返回同一引用', () => {
    const base = { memos: [memo('a'), memo('b')], seq: 2 }
    expect(deleteMemo(base, 'a').memos.map((m) => m.id)).toEqual(['b'])
    expect(deleteMemo(base, 'zz')).toBe(base)
  })
  it('置顶切换并重排到分组顶部；再切回普通组；未知 id 返回同一引用', () => {
    const base = { memos: [memo('p', { pinned: true, createdAt: 9 }), memo('a', { createdAt: 1 })], seq: 2 }
    const pinned = togglePin(base, 'a')
    expect(pinned.memos.map((m) => m.id)).toEqual(['p', 'a'])
    expect(pinned.memos[1].pinned).toBe(true)
    const back = togglePin(pinned, 'a')
    expect(back.memos.map((m) => m.pinned)).toEqual([true, false])
    expect(togglePin(base, 'zz')).toBe(base)
  })
})

describe('demoMemoState', () => {
  it('固定 3 条、恰好 1 条置顶且排在最前', () => {
    const s = demoMemoState()
    expect(s.memos).toHaveLength(3)
    expect(s.memos.filter((m) => m.pinned)).toHaveLength(1)
    expect(s.memos[0].pinned).toBe(true)
  })
  it('重复调用结果稳定（截图依赖）', () => {
    expect(demoMemoState()).toEqual(demoMemoState())
  })
})

describe('存储键约定', () => {
  it('使用独立命名空间键', () => {
    expect(MEMOS_STORAGE_KEY).toBe('memo:v1')
  })
})
