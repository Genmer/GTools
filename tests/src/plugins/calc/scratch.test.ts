import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  evaluateScratch,
  makeHistoryEntry,
  parseHistory,
  type HistoryEntry
} from '../../../../src/plugins/calc/logic/scratch'

describe('calc 稿纸逐行求值', () => {
  it('多行表达式逐行出结果，last 为末行', () => {
    const r = evaluateScratch('1+1\n2*3')
    expect(r.lines.map((l) => l.display)).toEqual(['= 2', '= 6'])
    expect(r.last).toBe(6)
    expect(r.lines[0]).toMatchObject({ kind: 'ok', value: 2 })
  })

  it('支持 CRLF 换行', () => {
    const r = evaluateScratch('1+1\r\n2+2')
    expect(r.lines).toHaveLength(2)
    expect(r.lines[1].display).toBe('= 4')
  })

  it('变量赋值与引用：a=3 下一行 a*5', () => {
    const r = evaluateScratch('a=3\na*5')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', varName: 'a', value: 3, display: 'a = 3' })
    expect(r.lines[1]).toMatchObject({ kind: 'ok', value: 15 })
    expect(r.vars.get('a')).toBe(3)
  })

  it('重新赋值影响后续行（整稿顺序重算）', () => {
    const r = evaluateScratch('a=1\na+10\na=10\na+10')
    expect(r.lines.map((l) => (l.kind === 'ok' ? l.value : NaN))).toEqual([1, 11, 10, 20])
  })

  it('ans 引用上一个成功求值行的结果', () => {
    const r = evaluateScratch('1+1\nans*10')
    expect(r.lines[1].value).toBe(20)
    // 赋值行同样刷新 ans
    const r2 = evaluateScratch('5\na=7\nans+1')
    expect(r2.lines[2].value).toBe(8)
  })

  it('结果展示带千分位（对齐参考图 = 4,175,270）', () => {
    const r = evaluateScratch('55+88+7689*543')
    expect(r.lines[0].value).toBe(4175270)
    expect(r.lines[0].display).toBe('= 4,175,270')
  })

  it('内置常量 pi/e 可直接参与运算（参考图 2651*pi），也可被赋值覆盖', () => {
    const r = evaluateScratch('2651*pi')
    expect(r.lines[0].kind).toBe('ok')
    expect(r.lines[0].value).toBeCloseTo(2651 * Math.PI, 10)
    const r2 = evaluateScratch('pi = 3\npi*2')
    expect(r2.lines.map((l) => l.value)).toEqual([3, 6])
  })

  it('空行与 // # 注释行跳过', () => {
    const r = evaluateScratch('// 说明\n\n# 备注\n1+1')
    expect(r.lines.slice(0, 3).every((l) => l.kind === 'skip')).toBe(true)
    expect(r.lines[3].display).toBe('= 2')
  })

  it('错误行只标记自身，不中断后续行', () => {
    const r = evaluateScratch('1/0\n2+2\n未知*3')
    expect(r.lines[0]).toMatchObject({ kind: 'error', display: '除数为 0' })
    expect(r.lines[1]).toMatchObject({ kind: 'ok', value: 4 })
    expect(r.lines[2]).toMatchObject({ kind: 'error' })
    expect(r.last).toBe(4)
  })

  it('中文变量名与全角符号', () => {
    const r = evaluateScratch('单价 = 100\n数量 = 3\n单价*数量\n（1＋2）×4')
    expect(r.lines[0]).toMatchObject({ kind: 'ok', varName: '单价' })
    expect(r.lines[2].value).toBe(300)
    expect(r.lines[3].value).toBe(12)
  })

  it('a==b 不误判为赋值，按表达式报错', () => {
    const r = evaluateScratch('a==1')
    expect(r.lines[0].kind).toBe('error')
  })

  it('前向引用未定义变量报未知变量', () => {
    const r = evaluateScratch('b*2\nb = 1')
    expect(r.lines[0]).toMatchObject({ kind: 'error', display: '未知变量：b' })
    expect(r.lines[1].kind).toBe('ok')
  })

  it('浮点结果经 12 位有效数字清理展示', () => {
    const r = evaluateScratch('0.1+0.2')
    expect(r.lines[0].display).toBe('= 0.3')
  })

  it('赋值号右侧为空报错', () => {
    const r = evaluateScratch('a =')
    expect(r.lines[0].kind).toBe('error')
    expect(r.vars.has('a')).toBe(false)
  })
})

describe('calc 历史', () => {
  it('标题取第一条非注释非空行并截断 30 字', () => {
    expect(makeHistoryEntry('// 备注\n  \n1+1\n2+2', 0).title).toBe('1+1')
    expect(makeHistoryEntry('', 0).title).toBe('（空）')
    expect(makeHistoryEntry('头'.repeat(40), 0).title).toHaveLength(30)
  })

  it('id 互不相同且含时间戳', () => {
    const a = makeHistoryEntry('1', 1000)
    const b = makeHistoryEntry('1', 1000)
    expect(a.id).not.toBe(b.id)
    expect(a.ts).toBe(1000)
  })

  it('parseHistory 逐条校验，坏条目跳过', () => {
    const good: HistoryEntry = { id: 'x', ts: 1, text: '1+1', title: '1+1' }
    expect(parseHistory(null)).toEqual([])
    expect(parseHistory('nope')).toEqual([])
    expect(parseHistory([good])).toEqual([good])
    expect(parseHistory([good, { id: '', ts: 1, text: 'a', title: 'a' }, { id: 'y', ts: 'bad', text: 'a', title: 'a' }, 42, null])).toEqual([good])
  })

  it('超过上限的历史截断到 HISTORY_LIMIT', () => {
    const many: HistoryEntry[] = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => ({
      id: String(i),
      ts: i,
      text: '1',
      title: '1'
    }))
    expect(parseHistory(many)).toHaveLength(HISTORY_LIMIT)
  })
})
