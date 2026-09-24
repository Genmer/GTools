import { describe, expect, it } from 'vitest'
import { formatLink, htmlEscape, markdownAlt, markdownUrl } from '../../../../src/plugins/image-bed/logic/formats'

describe('image-bed formats', () => {
  it('URL 格式原样返回', () => {
    expect(formatLink('url', 'https://a.com/x.png', 'x.png')).toBe('https://a.com/x.png')
  })

  it('Markdown：alt 取去扩展名文件名，中括号转义、路径分隔剥掉', () => {
    expect(formatLink('markdown', 'https://a.com/x.png', 'x.png')).toBe('![x](https://a.com/x.png)')
    expect(formatLink('markdown', 'https://a.com/a.png', '屏幕 [截图].png')).toBe('![屏幕 \\[截图\\]](https://a.com/a.png)')
    expect(markdownAlt('屏幕 [截图].png')).toBe('屏幕 \\[截图\\]')
    expect(markdownAlt('a.b.png')).toBe('a.b')
    expect(markdownAlt('dir/name.png')).toBe('name')
    expect(markdownAlt('C:\\pic\\win.png')).toBe('win')
    expect(markdownAlt('.png')).toBe('image')
  })

  it('Markdown 链接内的空格与圆括号百分号编码', () => {
    expect(markdownUrl('https://a.com/x y.png')).toBe('https://a.com/x%20y.png')
    expect(markdownUrl('https://a.com/(1).png')).toBe('https://a.com/%281%29.png')
    expect(formatLink('markdown', 'https://a.com/my pic (2).png', 'p.png')).toBe(
      '![p](https://a.com/my%20pic%20%282%29.png)'
    )
  })

  it('HTML：src 与 alt 属性转义', () => {
    expect(formatLink('html', 'https://a.com/x.png', 'x.png')).toBe('<img src="https://a.com/x.png" alt="x">')
    expect(htmlEscape('a&b<c>"d"')).toBe('a&amp;b&lt;c&gt;&quot;d&quot;')
    expect(formatLink('html', 'https://a.com/x.png?q="1"', 'a"b.png')).toBe(
      '<img src="https://a.com/x.png?q=&quot;1&quot;" alt="a&quot;b">'
    )
  })
})
