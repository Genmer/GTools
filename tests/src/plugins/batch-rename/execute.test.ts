import { describe, expect, it } from 'vitest'
import {
  buildPreview,
  buildUndoOps,
  executeBatch,
  makeFileItems,
  orderOps,
  planExecution,
  type RenameOp,
  type RenameRule
} from '../../../../src/plugins/batch-rename/logic/rename'

const D = '/w'

function opsOf(pairs: [string, string][]): RenameOp[] {
  return pairs.map(([from, to], i) => ({ id: `o${i}`, from, to }))
}

describe('orderOps 执行排序', () => {
  it('无依赖保持原顺序', () => {
    const r = orderOps(opsOf([[`${D}/a`, `${D}/x`], [`${D}/b`, `${D}/y`]]))
    expect(r).toEqual({ ok: true, ordered: opsOf([[`${D}/a`, `${D}/x`], [`${D}/b`, `${D}/y`]]) })
  })

  it('腾位依赖：占用目标名的文件先执行', () => {
    // a→b 依赖 b 先改走
    const r = orderOps(opsOf([[`${D}/a`, `${D}/b`], [`${D}/b`, `${D}/c`]]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ordered.map((o) => o.from)).toEqual([`${D}/b`, `${D}/a`])
  })

  it('依赖判定忽略大小写，跨目录不构成依赖', () => {
    const r = orderOps(opsOf([[`${D}/a`, `${D}/B`], [`${D}/b`, `${D}/c`]]))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ordered.map((o) => o.from)).toEqual([`${D}/b`, `${D}/a`])
    const noDep = orderOps(opsOf([[`${D}/a`, `${D}/b`], [`${D}2/b`, `${D}/c`]]))
    expect(noDep.ok).toBe(true)
    if (noDep.ok) expect(noDep.ordered.map((o) => o.from)).toEqual([`${D}/a`, `${D}2/b`])
  })

  it('两文件互换名成环 → 报错要求分两步', () => {
    const r = orderOps(opsOf([[`${D}/a`, `${D}/b`], [`${D}/b`, `${D}/a`]]))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.message).toContain('循环')
  })

  it('重复源文件拒绝；纯大小写调整无自依赖', () => {
    const dup = orderOps(opsOf([[`${D}/a`, `${D}/x`], [`${D}/a`, `${D}/y`]]))
    expect(dup.ok).toBe(false)
    expect(dup.ok === false && dup.message).toContain('重复文件')
    const solo = orderOps(opsOf([[`${D}/a.txt`, `${D}/A.txt`]]))
    expect(solo.ok).toBe(true)
  })
})

describe('executeBatch', () => {
  it('按排序顺序全部执行并回报 executed', async () => {
    const calls: string[] = []
    const rep = await executeBatch(opsOf([[`${D}/a`, `${D}/b`], [`${D}/b`, `${D}/c`]]), async (f, t) => {
      calls.push(`${f}->${t}`)
    })
    expect(rep.failures).toEqual([])
    expect(calls).toEqual([`${D}/b->${D}/c`, `${D}/a->${D}/b`])
    expect(rep.executed).toHaveLength(2)
  })

  it('单个失败不中断，失败明细带可读信息', async () => {
    const rep = await executeBatch(opsOf([[`${D}/ok1`, `${D}/n1`], [`${D}/locked`, `${D}/n2`], [`${D}/ok2`, `${D}/n3`]]), async (f) => {
      if (f === `${D}/locked`) throw new Error('文件被占用')
    })
    expect(rep.executed.map((o) => o.from)).toEqual([`${D}/ok1`, `${D}/ok2`])
    expect(rep.failures).toHaveLength(1)
    expect(rep.failures[0]?.op.from).toBe(`${D}/locked`)
    expect(rep.failures[0]?.message).toBe('文件被占用')
  })

  it('成环批次的每个操作都进失败清单且不执行', async () => {
    const calls: string[] = []
    const ops = opsOf([[`${D}/a`, `${D}/b`], [`${D}/b`, `${D}/a`]])
    const rep = await executeBatch(ops, async (f, t) => {
      calls.push(`${f}->${t}`)
    })
    expect(calls).toEqual([])
    expect(rep.executed).toEqual([])
    expect(rep.failures.map((f) => f.message)).toEqual(['存在循环命名（如两文件互换名），请分两步执行', '存在循环命名（如两文件互换名），请分两步执行'])
  })
})

describe('撤销', () => {
  it('buildUndoOps 逆序并对换 from/to（id 保留便于回写列表）', () => {
    const undo = buildUndoOps(opsOf([[`${D}/a`, `${D}/x`], [`${D}/b`, `${D}/y`]]))
    expect(undo).toEqual([
      { id: 'o1', from: `${D}/y`, to: `${D}/b` },
      { id: 'o0', from: `${D}/x`, to: `${D}/a` }
    ])
  })
})

describe('端到端（内存文件系统）', () => {
  function fakeFs(initial: string[]) {
    const files = new Set(initial)
    return {
      files,
      renamer: async (from: string, to: string): Promise<void> => {
        if (!files.has(from)) throw new Error(`源文件不存在：${from}`)
        files.delete(from)
        files.add(to) // 模拟 POSIX rename：目标存在则静默替换
      }
    }
  }

  it('执行 → 回报 → 撤销整链路还原', async () => {
    const items = makeFileItems([`${D}/a.txt`, `${D}/b.txt`])
    const existing = new Map([[D, new Set(['a.txt', 'b.txt'])]])
    const rules: RenameRule[] = [
      { type: 'replace', find: 'b', replaceWith: 'c', useRegex: false, caseSensitive: true, scope: 'name' },
      { type: 'replace', find: 'a', replaceWith: 'b', useRegex: false, caseSensitive: true, scope: 'name' }
    ]
    const pv = buildPreview(items, rules, existing, 'darwin')
    expect(pv.ok).toBe(true)
    const ops = planExecution(pv.rows)
    expect(ops.map((o) => o.to)).toEqual([`${D}/b.txt`, `${D}/c.txt`])

    const fs = fakeFs([`${D}/a.txt`, `${D}/b.txt`])
    const rep = await executeBatch(ops, fs.renamer)
    expect(rep.failures).toEqual([])
    expect([...fs.files].sort()).toEqual([`${D}/b.txt`, `${D}/c.txt`])

    const undoRep = await executeBatch(buildUndoOps(rep.executed), fs.renamer)
    expect(undoRep.failures).toEqual([])
    expect([...fs.files].sort()).toEqual([`${D}/a.txt`, `${D}/b.txt`])
  })

  it('源文件在执行前被外部删除：失败明细可见且其余成功', async () => {
    const items = makeFileItems([`${D}/1.txt`, `${D}/2.txt`])
    const pv = buildPreview(
      items,
      [{ type: 'ext', value: 'md' }],
      new Map([[D, new Set(['1.txt', '2.txt'])]]),
      'darwin'
    )
    const ops = planExecution(pv.rows)
    const fs = fakeFs([`${D}/2.txt`]) // 1.txt 已被外部删除
    const rep = await executeBatch(ops, fs.renamer)
    expect(rep.executed.map((o) => o.to)).toEqual([`${D}/2.md`])
    expect(rep.failures.map((f) => f.message)).toContain(`源文件不存在：${D}/1.txt`)
  })
})
