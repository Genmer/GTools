import { describe, expect, it } from 'vitest'
import { chain, runBatch, toRule, type BatchRule, type RuleDraft } from '../../../../src/plugins/text-batch/logic/batch'

const rule = (r: BatchRule): BatchRule => r
const lines = (...l: string[]): string[] => l

describe('逐行规则', () => {
  it('查找替换：全量替换；空查找串不生效', () => {
    expect(runBatch('a-b-a', [rule({ type: 'replace', find: '-', replaceWith: '+' })])).toBe('a+b+a')
    expect(chain(lines('ab', 'cd'), [rule({ type: 'replace', find: '', replaceWith: 'x' })])).toEqual(lines('ab', 'cd'))
  })

  it('正则替换：全局替换并支持捕获组；非法正则整条跳过', () => {
    expect(runBatch('id=12, id=7', [rule({ type: 'regexReplace', regex: '\\d+', replaceWith: 'N' })])).toBe('id=N, id=N')
    expect(runBatch('ab12cd', [rule({ type: 'regexReplace', regex: '(\\d+)', replaceWith: '<$1>' })])).toBe('ab<12>cd')
    expect(runBatch('a[b(', [rule({ type: 'regexReplace', regex: '[', replaceWith: 'x' })])).toBe('a[b(')
    expect(runBatch('abc', [rule({ type: 'regexReplace', regex: '', replaceWith: 'x' })])).toBe('abc')
  })

  it('大小写：upper / lower / title（词首大写、非文字分界）', () => {
    const upper = rule({ type: 'case', mode: 'upper' })
    expect(runBatch('hello 世界', [upper])).toBe('HELLO 世界')
    expect(runBatch('Hello', [rule({ type: 'case', mode: 'lower' })])).toBe('hello')
    expect(runBatch('hello world 2x', [rule({ type: 'case', mode: 'title' })])).toBe('Hello World 2x')
    // 撇号/连字符等非文字字符重置词首大写（对照 rename.ts 语义）：'t 视为新词首
    expect(runBatch("don't stop-me", [rule({ type: 'case', mode: 'title' })])).toBe("Don'T Stop-Me")
  })

  it('trim：去行首尾空白；空串原样', () => {
    expect(chain(lines('  a  ', '\tb\t', ''), [rule({ type: 'trim' })])).toEqual(lines('a', 'b', ''))
  })

  it('加前后缀：前缀后缀可只配其一', () => {
    expect(chain(lines('a', 'b'), [rule({ type: 'wrap', prefix: '[', suffix: ']' })])).toEqual(lines('[a]', '[b]'))
    expect(chain(lines('a'), [rule({ type: 'wrap', prefix: 'x', suffix: '' })])).toEqual(lines('xa'))
  })
})

describe('整列规则', () => {
  it('按行去重：保序取首次出现', () => {
    expect(chain(lines('b', 'a', 'b', 'c', 'a'), [rule({ type: 'dedupe' })])).toEqual(lines('b', 'a', 'c'))
    expect(chain(lines(''), [rule({ type: 'dedupe' })])).toEqual(lines(''))
  })

  it('排序：asc / desc，码元序（跨环境确定性）', () => {
    const sort = (order: 'asc' | 'desc'): BatchRule => rule({ type: 'sort', order })
    expect(chain(lines('b', 'A', 'a', 'c'), [sort('asc')])).toEqual(lines('A', 'a', 'b', 'c'))
    expect(chain(lines('b', 'A', 'a', 'c'), [sort('desc')])).toEqual(lines('c', 'b', 'a', 'A'))
  })

  it('按行过滤：包含 / 不包含 / 正则；空值与非法正则不生效', () => {
    const src = lines('apple pie', 'banana split', 'cherry cake')
    expect(chain(src, [rule({ type: 'filter', mode: 'include', value: 'an' })])).toEqual(lines('banana split'))
    expect(chain(src, [rule({ type: 'filter', mode: 'exclude', value: 'an' })])).toEqual(lines('apple pie', 'cherry cake'))
    expect(chain(src, [rule({ type: 'filter', mode: 'regex', value: '^(a|c)' })])).toEqual(lines('apple pie', 'cherry cake'))
    expect(chain(src, [rule({ type: 'filter', mode: 'include', value: '' })])).toEqual(src)
    expect(chain(src, [rule({ type: 'filter', mode: 'regex', value: '[' })])).toEqual(src)
  })
})

describe('规则链与边界', () => {
  it('空输入：逐行规则对单个空行生效，输出仍为空串', () => {
    expect(runBatch('', [rule({ type: 'trim' })])).toBe('')
    expect(runBatch('', [rule({ type: 'wrap', prefix: 'x', suffix: 'y' })])).toBe('xy')
  })

  it('结尾换行往返不丢；多条链式规则顺序折叠', () => {
    // 去重（保序）→ 排序（升序）→ 加前后缀
    const rules: BatchRule[] = [
      rule({ type: 'dedupe' }),
      rule({ type: 'sort', order: 'asc' }),
      rule({ type: 'wrap', prefix: '#', suffix: '' })
    ]
    expect(runBatch('b\na\nb\nc\na', rules)).toBe('#a\n#b\n#c')
    expect(runBatch('x\n', [rule({ type: 'trim' })])).toBe('x\n')
  })

  it('toRule 只收敛草稿中实际生效字段（切规则类型不串参）', () => {
    const d: RuleDraft = {
      uid: 1,
      type: 'replace',
      find: 'a',
      replaceWith: 'b',
      regex: 'DIRTY',
      order: 'desc',
      caseMode: 'lower',
      prefix: 'P',
      suffix: 'S',
      filterMode: 'regex',
      filterValue: 'DIRTY'
    }
    expect(toRule(d)).toEqual({ type: 'replace', find: 'a', replaceWith: 'b' })
    expect(toRule({ ...d, type: 'sort' })).toEqual({ type: 'sort', order: 'desc' })
    expect(toRule({ ...d, type: 'dedupe' })).toEqual({ type: 'dedupe' })
  })
})
