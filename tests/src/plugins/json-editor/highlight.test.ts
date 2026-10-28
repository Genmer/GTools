import { describe, expect, it } from 'vitest'
import { escapeHtml, highlightJson } from '../../../../src/plugins/json-editor/logic/highlight'
import { buildFindMarks, highlightJsonWithFinds, type FindMark } from '../../../../src/plugins/json-editor/logic/highlight'

describe('escapeHtml', () => {
  it('转义 & < > "', () => {
    expect(escapeHtml('&<>"')).toBe('&amp;&lt;&gt;&quot;')
  })

  it('普通字符串不作修改', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123')
  })
})

describe('highlightJson', () => {
  it('正确区分 key 与 string', () => {
    const input = '{"title": "GTools"}'
    const out = highlightJson(input)
    expect(out).toContain('<span class="hl-key">&quot;title&quot;:</span>')
    expect(out).toContain('<span class="hl-str">&quot;GTools&quot;</span>')
  })

  it('数字、布尔与 null 高亮', () => {
    const input = '{"num": 42, "neg": -3.14, "exp": 1e3, "flag": true, "empty": null}'
    const out = highlightJson(input)
    expect(out).toContain('<span class="hl-num">42</span>')
    expect(out).toContain('<span class="hl-num">-3.14</span>')
    expect(out).toContain('<span class="hl-num">1e3</span>')
    expect(out).toContain('<span class="hl-bool">true</span>')
    expect(out).toContain('<span class="hl-null">null</span>')
  })

  it('标点符号高亮', () => {
    const input = '{"arr": [1, 2]}'
    const out = highlightJson(input)
    expect(out).toContain('<span class="hl-punct">{</span>')
    expect(out).toContain('<span class="hl-punct">}</span>')
    expect(out).toContain('<span class="hl-punct">[</span>')
    expect(out).toContain('<span class="hl-punct">]</span>')
    expect(out).toContain('<span class="hl-punct">,</span>')
  })

  it('保留缩进与换行空白', () => {
    const input = '{\n  "a": 1\n}'
    const out = highlightJson(input)
    expect(out).toBe('<span class="hl-punct">{</span>\n  <span class="hl-key">&quot;a&quot;:</span> <span class="hl-num">1</span>\n<span class="hl-punct">}</span>')
  })

  it('包含 HTML 特殊字符时转义安全', () => {
    const input = '{"<tag>": "a & b > c"}'
    const out = highlightJson(input)
    expect(out).toContain('&lt;tag&gt;')
    expect(out).toContain('a &amp; b &gt; c')
    expect(out).not.toContain('<tag>')
  })

  it('超过 200,000 字符时走超大文本兜底只转义不分词', () => {
    const large = '{"x": 1},'.repeat(25000)
    expect(large.length).toBeGreaterThan(200_000)
    const out = highlightJson(large)
    expect(out).not.toContain('<span class=')
    expect(out).toBe(escapeHtml(large))
  })

  it('空字符串输出空字符串', () => {
    expect(highlightJson('')).toBe('')
  })

  it('混合 token 全量输出逐字节锁定', () => {
    expect(highlightJson('{"k": true}')).toBe(
      '<span class="hl-punct">{</span><span class="hl-key">&quot;k&quot;:</span> <span class="hl-bool">true</span><span class="hl-punct">}</span>'
    )
  })
})

describe('buildFindMarks', () => {
  it('starts 映射为区间并按 currentIndex 标 current', () => {
    expect(buildFindMarks([2, 10, 20], 3, 1, 100)).toEqual([
      { start: 2, end: 5, current: false },
      { start: 10, end: 13, current: true },
      { start: 20, end: 23, current: false }
    ])
  })

  it('cap 只取前 cap 条（currentIndex 超出 cap 则无 current 条）', () => {
    expect(buildFindMarks([0, 1, 2, 3], 1, 0, 2)).toEqual([
      { start: 0, end: 1, current: true },
      { start: 1, end: 2, current: false }
    ])
    expect(buildFindMarks([0, 1, 2, 3], 1, 2, 2).every((m) => !m.current)).toBe(true)
  })

  it('len≤0 或 cap≤0 或空 starts 返回 []', () => {
    expect(buildFindMarks([1, 2], 0, 0, 10)).toEqual([])
    expect(buildFindMarks([1, 2], -1, 0, 10)).toEqual([])
    expect(buildFindMarks([1, 2], 2, 0, 0)).toEqual([])
    expect(buildFindMarks([], 2, 0, 10)).toEqual([])
  })

  it('currentIndex 为 -1 或大越界值时无 current 条', () => {
    expect(buildFindMarks([0, 5], 2, -1, 10).every((m) => !m.current)).toBe(true)
    expect(buildFindMarks([0, 5], 2, 99, 10).every((m) => !m.current)).toBe(true)
  })

  it('cap 恰好截在 currentIndex：末条保留且标 current', () => {
    expect(buildFindMarks([0, 5, 10], 2, 2, 3)).toEqual([
      { start: 0, end: 2, current: false },
      { start: 5, end: 7, current: false },
      { start: 10, end: 12, current: true }
    ])
  })

  it('cap 大于 starts.length 时全量保留', () => {
    expect(buildFindMarks([0, 5], 2, 0, 100)).toHaveLength(2)
  })
})

describe('highlightJsonWithFinds', () => {
  it('marks 为空时输出与 highlightJson 一致', () => {
    const input = '{\n  "<tag>": "a & b > c", "n": -3.14, "e": null, "arr": [1, 2]}'
    expect(highlightJsonWithFinds(input, [])).toBe(highlightJson(input))
  })

  it('普通注入：str token 内部包 find-all 且外层语法色保留', () => {
    const out = highlightJsonWithFinds('{"name": "abc"}', [{ start: 10, end: 13, current: false }])
    expect(out).toBe(
      '<span class="hl-punct">{</span><span class="hl-key">&quot;name&quot;:</span> <span class="hl-str">&quot;<span class="find-all">abc</span>&quot;</span><span class="hl-punct">}</span>'
    )
  })

  it('匹配跨 token 边界时背景连续、语法色分段保留', () => {
    // needle = `1, "b"`：横跨 数字/标点/空白/key 四个 segment
    const out = highlightJsonWithFinds('{"a": 1, "b": 2}', [{ start: 6, end: 11, current: false }])
    expect(out).toBe(
      '<span class="hl-punct">{</span><span class="hl-key">&quot;a&quot;:</span> ' +
        '<span class="hl-num"><span class="find-all">1</span></span>' +
        '<span class="hl-punct"><span class="find-all">,</span></span>' +
        '<span class="find-all"> </span>' +
        '<span class="hl-key"><span class="find-all">&quot;b</span>&quot;:</span>' +
        ' <span class="hl-num">2</span><span class="hl-punct">}</span>'
    )
  })

  it('中文 needle 注入', () => {
    const out = highlightJsonWithFinds('{"名称": "值"}', [{ start: 8, end: 9, current: false }])
    expect(out).toContain('<span class="hl-str">&quot;<span class="find-all">值</span>&quot;</span>')
  })

  it('current 条目输出 find-all cur 类', () => {
    const out = highlightJsonWithFinds('{"name": "abc"}', [{ start: 10, end: 13, current: true }])
    expect(out).toContain('<span class="find-all cur">abc</span>')
  })

  it('非法 marks（越界/负值/零长/倒序/NaN）跳过不抛错且不影响输出', () => {
    const input = '{"name": "abc"}'
    const bad: FindMark[] = [
      { start: 100, end: 200, current: false },
      { start: -1, end: 3, current: false },
      { start: 4, end: 4, current: false },
      { start: 7, end: 3, current: false },
      { start: Number.NaN, end: 3, current: false }
    ]
    expect(() => highlightJsonWithFinds(input, bad)).not.toThrow()
    expect(highlightJsonWithFinds(input, bad)).toBe(highlightJson(input))
  })

  it('乱序/重叠条目相对已接受条目跳过', () => {
    const input = '{"name": "abc"}'
    const out = highlightJsonWithFinds(input, [
      { start: 10, end: 13, current: false },
      { start: 2, end: 4, current: false },
      { start: 12, end: 14, current: false }
    ])
    expect(out).toBe(highlightJsonWithFinds(input, [{ start: 10, end: 13, current: false }]))
  })

  it('Infinity 条目与 end 恰越界 1 的条目跳过', () => {
    const input = '{"a": 1}'
    expect(
      highlightJsonWithFinds(input, [
        { start: Number.NEGATIVE_INFINITY, end: 3, current: false },
        { start: 0, end: input.length + 1, current: false },
        { start: Number.POSITIVE_INFINITY, end: Number.POSITIVE_INFINITY, current: false }
      ])
    ).toBe(highlightJson(input))
  })

  it('空串输入任何 marks 均无效输出空串', () => {
    expect(highlightJsonWithFinds('', [{ start: 0, end: 1, current: false }])).toBe('')
  })

  it('mark 覆盖恰好全文长度（start=0,end=length）整体注入不丢尾部', () => {
    const input = '{"a": 1}'
    const out = highlightJsonWithFinds(input, [{ start: 0, end: input.length, current: false }])
    expect(out).toBe(
      '<span class="hl-punct"><span class="find-all">{</span></span>' +
        '<span class="hl-key"><span class="find-all">&quot;a&quot;:</span></span>' +
        '<span class="find-all"> </span>' +
        '<span class="hl-num"><span class="find-all">1</span></span>' +
        '<span class="hl-punct"><span class="find-all">}</span></span>'
    )
  })

  it('mark 起点在 token 边界（": "空格处）跨 gap 与下个 token 注入无空 span', () => {
    // 段布局：{=0  "a":=1..4  空格=5  1=6  }=7；mark 起点恰在 key token 之后的 gap 段起点
    const out = highlightJsonWithFinds('{"a": 1}', [{ start: 5, end: 7, current: false }])
    expect(out).toBe(
      '<span class="hl-punct">{</span>' +
        '<span class="hl-key">&quot;a&quot;:</span>' +
        '<span class="find-all"> </span>' +
        '<span class="hl-num"><span class="find-all">1</span></span>' +
        '<span class="hl-punct">}</span>'
    )
  })

  it('相邻 marks（end==下一条 start）同段内无空档不重复包裹', () => {
    // 段布局：{=0  "x":=1..4  空格=5  "aaabbb"=6..13  }=14；aaa=[7,10) 与 bbb=[10,13) 相邻
    const out = highlightJsonWithFinds('{"x": "aaabbb"}', [
      { start: 7, end: 10, current: false },
      { start: 10, end: 13, current: true }
    ])
    expect(out).toBe(
      '<span class="hl-punct">{</span>' +
        '<span class="hl-key">&quot;x&quot;:</span> ' +
        '<span class="hl-str">&quot;<span class="find-all">aaa</span><span class="find-all cur">bbb</span>&quot;</span>' +
        '<span class="hl-punct">}</span>'
    )
  })

  it('相邻 marks 跨 segment 边界（前条 end==后条 start==段边界）各自注入', () => {
    const out = highlightJsonWithFinds('{"a": 1}', [
      { start: 5, end: 6, current: false },
      { start: 6, end: 7, current: true }
    ])
    expect(out).toBe(
      '<span class="hl-punct">{</span>' +
        '<span class="hl-key">&quot;a&quot;:</span>' +
        '<span class="find-all"> </span>' +
        '<span class="hl-num"><span class="find-all cur">1</span></span>' +
        '<span class="hl-punct">}</span>'
    )
  })

  it('超过 200K 兜底路径同样注入 marks', () => {
    const body = 'needle'.repeat(40000)
    expect(body.length).toBeGreaterThan(200_000)
    const out = highlightJsonWithFinds(body, [
      { start: 0, end: 6, current: true },
      { start: 6, end: 12, current: false }
    ])
    expect(out).toBe(
      '<span class="find-all cur">needle</span><span class="find-all">needle</span>' + escapeHtml(body.slice(12))
    )
  })
})
