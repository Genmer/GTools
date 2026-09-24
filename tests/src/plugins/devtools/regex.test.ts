import { describe, expect, it } from 'vitest'
import { buildRegex, runPattern } from '../../../../src/plugins/devtools/views/logic/regex'

describe('devtools regex buildRegex', () => {
  it('副本上强制补 g，不改用户传入语义', () => {
    const re = buildRegex('ab', 'i')
    expect(re).toBeInstanceOf(RegExp)
    if (!(re instanceof RegExp) || 'error' in re) return
    expect(re.flags).toBe('gi')
    expect(buildRegex('a', 'g')).toMatchObject({ flags: 'g' })
  })

  it('非法模式返回错误对象而非抛异常', () => {
    const re = buildRegex('(', '')
    expect('error' in re).toBe(true)
    if ('error' in re) expect(re.error.length).toBeGreaterThan(0)
  })
})

describe('devtools regex runPattern', () => {
  it('列举全部匹配与位置（未给 g 也能列举）', () => {
    const r = runPattern('a', '', 'a-a-a')
    expect(r).toEqual({
      ok: true,
      matches: [
        { match: 'a', index: 0, groups: [] },
        { match: 'a', index: 2, groups: [] },
        { match: 'a', index: 4, groups: [] }
      ]
    })
  })

  it('捕获组与 i 标志', () => {
    const r = runPattern('(\\w+)@(\\w+)', 'i', 'a@b and CC@dd')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.matches).toEqual([
        { match: 'a@b', index: 0, groups: ['a', 'b'] },
        { match: 'CC@dd', index: 8, groups: ['CC', 'dd'] }
      ])
    }
    const ri = runPattern('ab', 'i', 'AB ab Ab')
    expect(ri.ok && ri.matches).toHaveLength(3)
  })

  it('零匹配是合法结果', () => {
    expect(runPattern('\\d+', '', '无数字')).toEqual({ ok: true, matches: [] })
  })

  it('非法模式 / 非法标志返回 ok:false', () => {
    expect(runPattern('[', '', 'x').ok).toBe(false)
    const bad = runPattern('a', 'q', 'a')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.message.length).toBeGreaterThan(0)
  })

  it('匹配数封顶 1000（防病态输入撑爆 UI）', () => {
    const r = runPattern('a', '', 'a'.repeat(1500))
    expect(r.ok && r.matches).toHaveLength(1000)
  })
})
