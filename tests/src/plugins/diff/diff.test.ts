import { describe, expect, it } from 'vitest'
import {
  computeLineDiff,
  diffSequences,
  formatUnified,
  lineKey,
  splitLines,
  tokenize,
  wordSegments,
  type DiffOptions,
  type EditOp
} from '../../../../src/plugins/diff/logic/diff'

const OPTS: DiffOptions = { ignoreCase: false, ignoreWhitespace: false }

// 操作序列合法性：构成一条从 (0,0) 到 (n,m) 的完整路径，equal 处两元素必须相等
function assertValidOps(a: readonly string[], b: readonly string[], ops: EditOp[]): void {
  let x = 0
  let y = 0
  for (const op of ops) {
    if (op.type === 'equal') {
      expect(op.aIdx).toBe(x)
      expect(op.bIdx).toBe(y)
      expect(a[x]).toBe(b[y])
      x++
      y++
    } else if (op.type === 'delete') {
      expect(op.aIdx).toBe(x)
      x++
    } else {
      expect(op.bIdx).toBe(y)
      y++
    }
  }
  expect(x).toBe(a.length)
  expect(y).toBe(b.length)
}

// 确定性伪随机（避免快照测试的不稳定）
function lcg(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648
    return s / 2147483648
  }
}

function randomLines(seed: number, count: number, vocab: string[]): string[] {
  const rnd = lcg(seed)
  const out: string[] = []
  for (let i = 0; i < count; i++) out.push(vocab[Math.floor(rnd() * vocab.length)])
  return out
}

// 两侧行内容按序还原不变式：左列单元格文本拼起来 == splitLines(A)
function assertSidesPreserved(result: ReturnType<typeof computeLineDiff>, a: string[], b: string[]): void {
  expect(result.rows.filter((r) => r.left !== null).map((r) => r.left!.text)).toEqual(a)
  expect(result.rows.filter((r) => r.right !== null).map((r) => r.right!.text)).toEqual(b)
}

describe('splitLines', () => {
  it('空串无行', () => {
    expect(splitLines('')).toEqual([])
  })
  it('按 \\n 断行且行尾换行不产生空行', () => {
    expect(splitLines('a\nb')).toEqual(['a', 'b'])
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('\n')).toEqual([''])
  })
  it('Windows CRLF 与孤立 \\r 均按行断开', () => {
    expect(splitLines('a\r\nb\r\nc')).toEqual(['a', 'b', 'c'])
    expect(splitLines('a\rb')).toEqual(['a', 'b'])
    expect(splitLines('a\r\nb\n')).toEqual(['a', 'b'])
  })
})

describe('lineKey', () => {
  it('默认原样', () => {
    expect(lineKey('  Foo  Bar ', OPTS)).toBe('  Foo  Bar ')
  })
  it('忽略大小写', () => {
    expect(lineKey('ABC', { ignoreCase: true, ignoreWhitespace: false })).toBe('abc')
  })
  it('忽略空白：去首尾并折叠连续空白', () => {
    expect(lineKey('  a \t b  ', { ignoreCase: false, ignoreWhitespace: true })).toBe('a b')
    expect(lineKey('a  b', { ignoreCase: false, ignoreWhitespace: true })).toBe('a b')
  })
  it('两个选项可叠加', () => {
    expect(lineKey(' A  B ', { ignoreCase: true, ignoreWhitespace: true })).toBe('a b')
  })
})

describe('diffSequences（Myers）', () => {
  it('相同序列全 equal', () => {
    const ops = diffSequences(['a', 'b', 'c'], ['a', 'b', 'c'])
    expect(ops).toEqual([
      { type: 'equal', aIdx: 0, bIdx: 0 },
      { type: 'equal', aIdx: 1, bIdx: 1 },
      { type: 'equal', aIdx: 2, bIdx: 2 }
    ])
  })
  it('单点替换产生一删一增（编辑距离 2）', () => {
    const ops = diffSequences(['a', 'b', 'c'], ['a', 'x', 'c'])
    expect(ops.filter((o) => o.type !== 'equal')).toHaveLength(2)
    assertValidOps(['a', 'b', 'c'], ['a', 'x', 'c'], ops)
  })
  it('纯插入 / 纯删除', () => {
    expect(
      diffSequences(['a', 'c'], ['a', 'b', 'c']).filter((o) => o.type !== 'equal')
    ).toEqual([{ type: 'insert', aIdx: -1, bIdx: 1 }])
    expect(
      diffSequences(['a', 'b', 'c'], ['a', 'c']).filter((o) => o.type !== 'equal')
    ).toEqual([{ type: 'delete', aIdx: 1, bIdx: -1 }])
  })
  it('空序列边界', () => {
    expect(diffSequences([], [])).toEqual([])
    expect(diffSequences([], ['x'])).toEqual([{ type: 'insert', aIdx: -1, bIdx: 0 }])
    expect(diffSequences(['x'], [])).toEqual([{ type: 'delete', aIdx: 0, bIdx: -1 }])
  })
  it('随机序列路径合法且为最优编辑距离（与手算对照）', () => {
    // abcabba -> cbabac：LCS 长 4（如 baba），最优编辑脚本 3 删 + 2 增 = 5 步
    const ops = diffSequences('abcabba'.split(''), 'cbabac'.split(''))
    assertValidOps('abcabba'.split(''), 'cbabac'.split(''), ops)
    expect(ops.filter((o) => o.type !== 'equal')).toHaveLength(5)
  })
  it('多组随机输入路径始终合法', () => {
    const vocab = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5']
    for (let seed = 1; seed <= 10; seed++) {
      const a = randomLines(seed, 30, vocab)
      const b = randomLines(seed + 100, 35, vocab)
      assertValidOps(a, b, diffSequences(a, b))
    }
  })
  it('大而不相干的输入走降级分支：整块删+增且保序', () => {
    const a = Array.from({ length: 2000 }, (_, i) => `left-${i}`)
    const b = Array.from({ length: 2000 }, (_, i) => `right-${i}`)
    const ops = diffSequences(a, b)
    assertValidOps(a, b, ops)
    expect(ops[0].type).toBe('delete')
    expect(ops[ops.length - 1].type).toBe('insert')
    expect(ops.filter((o) => o.type === 'delete')).toHaveLength(2000)
    expect(ops.filter((o) => o.type === 'insert')).toHaveLength(2000)
  })
})

describe('computeLineDiff', () => {
  it('完全一致：无差异统计，行全 equal，行号双侧对应', () => {
    const r = computeLineDiff('a\nb\nc', 'a\nb\nc', OPTS)
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 })
    expect(r.rows).toHaveLength(3)
    expect(r.rows.every((row) => row.type === 'equal')).toBe(true)
    expect(r.rows[2].left?.lineNo).toBe(3)
    expect(r.rows[2].right?.lineNo).toBe(3)
  })
  it('纯插入：新增行左侧为空占位', () => {
    const r = computeLineDiff('a\nc', 'a\nb\nc', OPTS)
    expect(r.stats).toEqual({ added: 1, removed: 0, modified: 0 })
    const ins = r.rows[1]
    expect(ins.type).toBe('insert')
    expect(ins.left).toBeNull()
    expect(ins.right?.text).toBe('b')
    expect(ins.right?.lineNo).toBe(2)
  })
  it('纯删除：删除行右侧为空占位', () => {
    const r = computeLineDiff('a\nb\nc', 'a\nc', OPTS)
    expect(r.stats).toEqual({ added: 0, removed: 1, modified: 0 })
    expect(r.rows[1].type).toBe('delete')
    expect(r.rows[1].right).toBeNull()
    expect(r.rows[1].left?.lineNo).toBe(2)
  })
  it('共享 token 的行配对为修改行，含词级高亮分段', () => {
    const r = computeLineDiff('const x = 1', 'const x = 2', OPTS)
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 1 })
    const row = r.rows[0]
    expect(row.type).toBe('modify')
    expect(row.left?.segments).toEqual([
      { text: 'const x = ', changed: false },
      { text: '1', changed: true }
    ])
    expect(row.right?.segments).toEqual([
      { text: 'const x = ', changed: false },
      { text: '2', changed: true }
    ])
  })
  it('无共享 token 的成对增删按纯删+纯增展示', () => {
    const r = computeLineDiff('b', 'X', OPTS)
    expect(r.stats).toEqual({ added: 1, removed: 1, modified: 0 })
    expect(r.rows.map((row) => row.type)).toEqual(['delete', 'insert'])
  })
  it('删除多于插入：先按同下标配对，剩余为纯删除', () => {
    const a = 'f(1)\nf(2)\nf(3)'
    const b = 'f(1)\nf(9)'
    const r = computeLineDiff(a, b, OPTS)
    expect(r.stats).toEqual({ added: 0, removed: 1, modified: 1 })
    expect(r.rows.map((row) => row.type)).toEqual(['equal', 'modify', 'delete'])
  })
  it('忽略大小写：仅大小写不同的行视为一致', () => {
    const r = computeLineDiff('Hello\nWorld', 'hello\nWORLD', { ignoreCase: true, ignoreWhitespace: false })
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 })
    expect(r.rows[0].left?.text).toBe('Hello')
  })
  it('忽略空白：首尾与行内多空格差异视为一致', () => {
    const r = computeLineDiff('  a  b ', 'a b', { ignoreCase: false, ignoreWhitespace: true })
    expect(r.stats).toEqual({ added: 0, removed: 0, modified: 0 })
  })
  it('行内词级也遵循忽略空白（空格数量差不高亮）', () => {
    const segs = wordSegments('a =  1', 'a = 1', { ignoreCase: false, ignoreWhitespace: true })
    expect(segs.left.every((s) => !s.changed)).toBe(true)
    expect(segs.right.every((s) => !s.changed)).toBe(true)
    const segs2 = wordSegments('a =  1', 'a = 1', OPTS)
    expect(segs2.left.some((s) => s.changed)).toBe(true)
  })
  it('中文按字级 token 高亮', () => {
    const segs = wordSegments('你好世界', '你好啊世界', OPTS)
    expect(segs.right).toEqual([
      { text: '你好', changed: false },
      { text: '啊', changed: true },
      { text: '世界', changed: false }
    ])
    // 相邻同态段合并：左行全部未变，归并为单段
    expect(segs.left).toEqual([{ text: '你好世界', changed: false }])
  })
  it('多处差异行号保持原始行号', () => {
    const a = '1\n2\n3\n4\n5\n6\n7'
    const b = '1\nx 2\n3\n4\n5\n6\ny 7'
    const r = computeLineDiff(a, b, OPTS)
    const mod2 = r.rows.find((row) => row.type === 'modify' && row.left?.lineNo === 2)
    expect(mod2?.right?.lineNo).toBe(2)
    const last = r.rows[r.rows.length - 1]
    expect(last.type).toBe('modify')
    expect(last.left?.lineNo).toBe(7)
    expect(last.right?.lineNo).toBe(7)
    expect(r.stats.modified).toBe(2)
  })
  it('CRLF 输入按行正确对比', () => {
    const r = computeLineDiff('a\r\nb\r\nc', 'a\r\nB\r\nc', OPTS)
    // b/B 无共享 token → 一行删 + 一行增
    expect(r.rows.map((row) => row.type)).toEqual(['equal', 'delete', 'insert', 'equal'])
    expect(r.stats).toEqual({ added: 1, removed: 1, modified: 0 })
  })
  it('空文本边界', () => {
    expect(computeLineDiff('', '', OPTS).rows).toEqual([])
    const r = computeLineDiff('', 'a\nb', OPTS)
    expect(r.stats).toEqual({ added: 2, removed: 0, modified: 0 })
  })
  it('随机输入下两侧内容与行号保序还原', () => {
    const vocab = ['foo()', 'bar = 1', '// note', '}', 'x']
    const aLines = randomLines(7, 60, vocab)
    const bLines = randomLines(8, 70, vocab)
    const r = computeLineDiff(aLines.join('\n'), bLines.join('\n'), OPTS)
    assertSidesPreserved(r, aLines, bLines)
    // 行号严格递增且与文本位置一致
    const leftNos = r.rows.filter((row) => row.left !== null).map((row) => row.left!.lineNo)
    expect(leftNos).toEqual([...leftNos].sort((p, q) => p - q))
    expect(leftNos).toEqual(aLines.map((_, i) => i + 1))
  })
})

describe('formatUnified', () => {
  it('无差异返回空串', () => {
    const r = computeLineDiff('a\nb', 'a\nb', OPTS)
    expect(formatUnified(r, 'L', 'R')).toBe('')
  })
  it('单处修改输出标准 unified 文本（3 行上下文）', () => {
    const r = computeLineDiff('a\nb\nc', 'a\nx\nc', OPTS)
    const out = formatUnified(r, 'L', 'R')
    expect(out).toBe('--- L\n+++ R\n@@ -1,3 +1,3 @@\n a\n-b\n+x\n c\n')
  })
  it('超过 6 行间隔的差异分成多个 hunk，行号正确', () => {
    const a = '1\n2\n3\n4\n5\n6\n7\n8\n9\n10'
    const b = '1\nx\n3\n4\n5\n6\n7\n8\n9\ny'
    const r = computeLineDiff(a, b, OPTS)
    const out = formatUnified(r, 'A.txt', 'B.txt')
    const lines = out.split('\n')
    expect(lines[0]).toBe('--- A.txt')
    expect(lines[1]).toBe('+++ B.txt')
    expect(lines[2]).toBe('@@ -1,5 +1,5 @@')
    expect(lines.filter((l) => l.startsWith('@@'))).toHaveLength(2)
    // 第二个 hunk 从第 7 行起（10-3 上下文）
    expect(lines[lines.indexOf('@@ -7,4 +7,4 @@')]).toBe('@@ -7,4 +7,4 @@')
    expect(out).toContain('-10')
    expect(out).toContain('+y')
  })
})

describe('tokenize', () => {
  it('词、空白、符号三类 token（符号逐字符、中文逐字）', () => {
    expect(tokenize('const x=1; // 注释')).toEqual([
      'const', ' ', 'x', '=', '1', ';', ' ', '/', '/', ' ', '注', '释'
    ])
  })
  it('空串无 token', () => {
    expect(tokenize('')).toEqual([])
  })
})
