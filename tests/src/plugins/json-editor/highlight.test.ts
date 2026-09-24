import { describe, expect, it } from 'vitest'
import { escapeHtml, highlightJson } from '../../../../src/plugins/json-editor/logic/highlight'

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
})
