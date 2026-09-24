import { describe, expect, it } from 'vitest'
import { buildClipboardHtml, sanitizeFilename, withMdExtension } from '../../../../src/plugins/markdown-notes/logic/richtext'

describe('buildClipboardHtml', () => {
  it('输出带 meta charset 的完整文档', () => {
    const html = buildClipboardHtml('<p>中文</p>')
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('<body>\n<p>中文</p>\n</body>')
  })
})

describe('sanitizeFilename', () => {
  it('剥 Windows 非法字符并折叠空白', () => {
    expect(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('a b c d e f g h i j')
  })
  it('去掉结尾点与空格', () => {
    expect(sanitizeFilename('name.. ')).toBe('name')
  })
  it('空名回退默认值', () => {
    expect(sanitizeFilename('')).toBe('note')
    expect(sanitizeFilename('///', 'fallback')).toBe('fallback')
  })
  it('Windows 保留名加前缀（真机行为未实测，按已知规则保守处理）', () => {
    expect(sanitizeFilename('CON')).toBe('_CON')
    expect(sanitizeFilename('con.md')).toBe('_con.md')
  })
  it('超长截断到 80', () => {
    expect(sanitizeFilename('x'.repeat(100))).toHaveLength(80)
  })
})

describe('withMdExtension', () => {
  it('补 .md 且不重复', () => {
    expect(withMdExtension('笔记')).toBe('笔记.md')
    expect(withMdExtension('a.md')).toBe('a.md')
    expect(withMdExtension('A.MD')).toBe('A.MD')
  })
})
