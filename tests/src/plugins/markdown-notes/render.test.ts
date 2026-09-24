import { describe, expect, it } from 'vitest'
import { escapeHtml, renderMarkdown, safeUrl } from '../../../../src/plugins/markdown-notes/logic/render'

describe('renderMarkdown 标题', () => {
  it('h1-h6', () => {
    expect(renderMarkdown('# 标题一')).toBe('<h1>标题一</h1>')
    expect(renderMarkdown('###### h6')).toBe('<h6>h6</h6>')
  })
  it('行尾闭合 # 与非标题场景', () => {
    expect(renderMarkdown('## 关闭 ##')).toBe('<h2>关闭</h2>')
    expect(renderMarkdown('####### 七个')).toBe('<p>####### 七个</p>')
    expect(renderMarkdown('#无空格')).toBe('<p>#无空格</p>')
  })
  it('标题内行内语法', () => {
    expect(renderMarkdown('## a `b` **c**')).toBe('<h2>a <code>b</code> <strong>c</strong></h2>')
  })
})

describe('renderMarkdown 段落与换行', () => {
  it('单换行默认转 <br>（速记场景）', () => {
    expect(renderMarkdown('第一行\n第二行')).toBe('<p>第一行<br>\n第二行</p>')
  })
  it('空行分段', () => {
    expect(renderMarkdown('第一行\n\n第二行')).toBe('<p>第一行</p>\n<p>第二行</p>')
  })
  it('breaks:false 时为软换行', () => {
    expect(renderMarkdown('a\nb', { breaks: false })).toBe('<p>a\nb</p>')
  })
  it('CRLF 归一', () => {
    expect(renderMarkdown('# t\r\n\r\nx')).toBe('<h1>t</h1>\n<p>x</p>')
  })
})

describe('renderMarkdown 列表', () => {
  it('无序/有序/起始序号', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>')
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol>\n<li>a</li>\n<li>b</li>\n</ol>')
    expect(renderMarkdown('3. a\n4. b')).toBe('<ol start="3">\n<li>a</li>\n<li>b</li>\n</ol>')
  })
  it('嵌套列表', () => {
    const html = renderMarkdown('- a\n  - b')
    expect(html).toContain('<li>a\n<ul>\n<li>b</li>\n</ul></li>')
    expect(html.match(/<ul>/g)).toHaveLength(2)
  })
  it('任务列表', () => {
    const html = renderMarkdown('- [ ] todo\n- [x] done')
    expect(html).toContain('<input type="checkbox" disabled> todo')
    expect(html).toContain('<input type="checkbox" disabled checked> done')
  })
  it('空行分隔的松散列表仍是一个列表', () => {
    expect(renderMarkdown('- a\n\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>')
  })
  it('不同符号开头视为两个列表', () => {
    expect(renderMarkdown('- a\n* b').match(/<ul>/g)).toHaveLength(2)
  })
  it('列表后的标题打断列表', () => {
    expect(renderMarkdown('- a\n# h')).toBe('<ul>\n<li>a</li>\n</ul>\n<h1>h</h1>')
  })
})

describe('renderMarkdown 代码', () => {
  it('围栏代码块带语言与转义', () => {
    expect(renderMarkdown('```ts\nconst a = "<b>"\n```')).toBe(
      '<pre><code class="language-ts">const a = &quot;&lt;b&gt;&quot;</code></pre>'
    )
  })
  it('未闭合围栏渲染到结尾不抛错', () => {
    expect(renderMarkdown('```\nabc')).toBe('<pre><code>abc</code></pre>')
  })
  it('行内代码不参与强调格式', () => {
    expect(renderMarkdown('用 `a<b` 记')).toBe('<p>用 <code>a&lt;b</code> 记</p>')
    expect(renderMarkdown('`**不加粗**`')).toBe('<p><code>**不加粗**</code></p>')
  })
  it('双反引号包单反引号', () => {
    expect(renderMarkdown('``a ` b``')).toBe('<p><code>a ` b</code></p>')
  })
})

describe('renderMarkdown 表格', () => {
  it('基础表格与对齐（对齐同时作用于 th 与 td）', () => {
    expect(renderMarkdown('| a | b |\n| --- | :---: |\n| 1 | 2 |')).toBe(
      '<table>\n<thead>\n<tr><th>a</th><th style="text-align:center">b</th></tr>\n</thead>\n<tbody>\n<tr><td>1</td><td style="text-align:center">2</td></tr>\n</tbody>\n</table>'
    )
  })
  it('右对齐与单元格补齐/截断', () => {
    const html = renderMarkdown('| a | b | c |\n| ---: | --- | --- |\n| 1 |')
    expect(html).toContain('<th style="text-align:right">a</th>')
    expect(html).toContain('<tr><td style="text-align:right">1</td><td></td><td></td></tr>')
  })
  it('转义竖线', () => {
    const html = renderMarkdown('| a | x\\|y |\n| --- | --- |')
    expect(html).toContain('<th>x|y</th>')
  })
  it('缺少分隔行时按段落处理', () => {
    expect(renderMarkdown('| a | b |')).toBe('<p>| a | b |</p>')
  })
})

describe('renderMarkdown 链接与图片', () => {
  it('基础链接与 title', () => {
    expect(renderMarkdown('[文本](https://a.com)')).toBe('<p><a href="https://a.com">文本</a></p>')
    expect(renderMarkdown('[t](https://a.com "提示")')).toBe('<p><a href="https://a.com" title="提示">t</a></p>')
  })
  it('相对路径 / 锚点 / mailto 放行', () => {
    expect(renderMarkdown('[x](docs/a.md)')).toBe('<p><a href="docs/a.md">x</a></p>')
    expect(renderMarkdown('[x](#sec)')).toBe('<p><a href="#sec">x</a></p>')
    expect(renderMarkdown('[m](mailto:a@b.c)')).toBe('<p><a href="mailto:a@b.c">m</a></p>')
  })
  it('javascript: 链接按字面显示', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>')
  })
  it('图片与 data:image', () => {
    expect(renderMarkdown('![alt](https://a.com/i.png)')).toBe('<p><img src="https://a.com/i.png" alt="alt"></p>')
    expect(renderMarkdown('![x](data:image/png;base64,AAAA)')).toContain('src="data:image/png;base64,AAAA"')
    expect(renderMarkdown('![x](javascript:alert(1))')).toBe('<p>![x](javascript:alert(1))</p>')
  })
  it('链接文本内的强调与行内代码', () => {
    expect(renderMarkdown('[**b**](https://a.com)')).toBe('<p><a href="https://a.com"><strong>b</strong></a></p>')
    expect(renderMarkdown('[`c`](https://a.com)')).toBe('<p><a href="https://a.com"><code>c</code></a></p>')
  })
})

describe('renderMarkdown 强调', () => {
  it('加粗斜体删除线', () => {
    expect(renderMarkdown('**加粗**')).toBe('<p><strong>加粗</strong></p>')
    expect(renderMarkdown('__加粗__')).toBe('<p><strong>加粗</strong></p>')
    expect(renderMarkdown('*斜*')).toBe('<p><em>斜</em></p>')
    expect(renderMarkdown('_斜_')).toBe('<p><em>斜</em></p>')
    expect(renderMarkdown('***粗斜***')).toBe('<p><strong><em>粗斜</em></strong></p>')
    expect(renderMarkdown('~~删除~~')).toBe('<p><del>删除</del></p>')
  })
  it('词内下划线与孤立星号不误伤', () => {
    expect(renderMarkdown('snake_case_name')).toBe('<p>snake_case_name</p>')
    expect(renderMarkdown('3 * 4 * 5')).toBe('<p>3 * 4 * 5</p>')
  })
})

describe('renderMarkdown 引用与分隔线', () => {
  it('引用与嵌套引用', () => {
    expect(renderMarkdown('> 引用')).toBe('<blockquote>\n<p>引用</p>\n</blockquote>')
    const html = renderMarkdown('> a\n> > b')
    expect(html.match(/<blockquote>/g)).toHaveLength(2)
  })
  it('分隔线', () => {
    expect(renderMarkdown('---')).toBe('<hr>')
    expect(renderMarkdown('***')).toBe('<hr>')
    expect(renderMarkdown('a\n\n---\n\nb')).toBe('<p>a</p>\n<hr>\n<p>b</p>')
    expect(renderMarkdown('--')).toBe('<p>--</p>')
  })
})

describe('renderMarkdown 安全与转义', () => {
  it('原始 HTML 一律按字面转义', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(renderMarkdown('<b>粗</b>')).toBe('<p>&lt;b&gt;粗&lt;/b&gt;</p>')
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>'
    )
  })
  it('特殊字符转义且代码内不二次转义', () => {
    expect(renderMarkdown('a & b < c > d "e" \'f\'')).toBe(
      '<p>a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;</p>'
    )
    expect(renderMarkdown('`&`')).toBe('<p><code>&amp;</code></p>')
  })
  it('空输入', () => {
    expect(renderMarkdown('')).toBe('')
  })
})

describe('escapeHtml / safeUrl 单元', () => {
  it('escapeHtml 五类字符', () => {
    expect(escapeHtml('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
  it('safeUrl 白名单', () => {
    expect(safeUrl('https://a.com', 'link')).toBe('https://a.com')
    expect(safeUrl('JAVASCRIPT:x', 'link')).toBeNull()
    expect(safeUrl('vbscript:x', 'link')).toBeNull()
    expect(safeUrl('data:text/html;x', 'link')).toBeNull()
    expect(safeUrl('data:image/png;base64,A', 'image')).toBe('data:image/png;base64,A')
    expect(safeUrl('data:text/html;x', 'image')).toBeNull()
    expect(safeUrl('readme.md', 'link')).toBe('readme.md')
    expect(safeUrl('', 'link')).toBeNull()
  })
})
