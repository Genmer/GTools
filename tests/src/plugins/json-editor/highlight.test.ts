import { describe, expect, it } from 'vitest'
import { escapeHtml, highlightJson } from '../../../../src/plugins/json-editor/logic/highlight'
import { findMatches } from '../../../../src/plugins/json-editor/logic/search'

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

  it('多行大文档行完整：剥除标签后与原文逐字符相等（渲染缺行时问题定位到布局层）', () => {
    // 复刻粘贴 169 行量级 JSON 的场景：行数不够会先在这里红
    const obj: Record<string, unknown> = {}
    for (let i = 1; i <= 80; i++) obj[`item_${i}`] = { index: i, name: `条目 ${i}`, tags: ['alpha', 'beta'] }
    const doc = JSON.stringify(obj, null, 2)
    expect(doc.split('\n').length).toBeGreaterThanOrEqual(169)

    const out = highlightJson(doc)
    const stripped = out.replace(/<[^>]*>/g, '')
    expect(stripped.split('\n').length).toBe(doc.split('\n').length)
    expect(stripped).toBe(escapeHtml(doc))
  })
})

describe('highlightJson 搜索命中标记', () => {
  const doc = '{"a": "foo", "b": "foo"}'

  it('命中叠进 token 内包 mark，当前命中用 hl-hit-cur', () => {
    const { matches } = findMatches(doc, 'foo')
    const out = highlightJson(doc, matches, 1)
    expect(out).toContain('<span class="hl-str">&quot;<mark class="hl-hit">foo</mark>&quot;</span>')
    expect(out).toContain('<span class="hl-str">&quot;<mark class="hl-hit-cur">foo</mark>&quot;</span>')
  })

  it('命中跨 token 边界时各段分别标记', () => {
    // 关键词 `: "f` 横跨 key token 尾冒号、空白与 string token 头部
    const { matches } = findMatches(doc, ': "f')
    expect(matches.length).toBeGreaterThan(0)
    const out = highlightJson(doc, matches)
    expect(out).toContain('<span class="hl-key">&quot;a&quot;<mark class="hl-hit">:</mark></span>')
    expect(out).toContain('<span class="hl-str"><mark class="hl-hit">&quot;f</mark>oo&quot;</span>')
  })

  it('命中包含 HTML 特殊字符时先切分再转义，不产出裸标签', () => {
    const text = '{"<b>": "<b>"}'
    const { matches } = findMatches(text, '<b>')
    const out = highlightJson(text, matches)
    expect(out).toContain('<mark class="hl-hit">&lt;b&gt;</mark>')
    expect(out).not.toContain('<mark class="hl-hit"><b>')
  })

  it('>200k 逃逸路径只转义但仍标命中（与分词解耦）', { timeout: 15_000 }, () => {
    const large = '{"x": "needle"},'.repeat(20_000)
    expect(large.length).toBeGreaterThan(200_000)
    const { matches } = findMatches(large, 'needle')
    expect(matches.length).toBe(10_000)
    const out = highlightJson(large, matches, 0)
    expect(out).not.toContain('<span class=')
    expect(out).toContain('<mark class="hl-hit-cur">needle</mark>')
    expect(out).toContain('<mark class="hl-hit">needle</mark>')
  })

  it('文本变更后残留的越界命中区间安全忽略', () => {
    expect(highlightJson('{}', [{ start: 10, end: 20 }])).toBe(
      '<span class="hl-punct">{</span><span class="hl-punct">}</span>'
    )
    expect(highlightJson('abcd', [{ start: 2, end: 99 }], 0)).toBe('ab<mark class="hl-hit-cur">cd</mark>')
  })

  it('matches 传 undefined/空数组时行为与旧签名一致', () => {
    expect(highlightJson('{"a": 1}')).toBe(highlightJson('{"a": 1}', [], -1))
  })
})
