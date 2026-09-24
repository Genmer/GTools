import { describe, expect, it } from 'vitest'
import { highlightSegments } from '../src/renderer/src/core/highlight'

describe('highlightSegments', () => {
  it('字面子串命中分三段并标记命中段', () => {
    expect(highlightSegments('Markdown 笔记', '笔记')).toEqual([
      { text: 'Markdown ', hit: false },
      { text: '笔记', hit: true },
      { text: '', hit: false }
    ].filter((s) => s.text !== ''))
  })

  it('大小写不敏感', () => {
    expect(highlightSegments('JSON 工具', 'json')).toEqual([{ text: '', hit: false }, { text: 'JSON', hit: true }, { text: ' 工具', hit: false }].filter((s) => s.text !== ''))
  })

  it('命中在开头/结尾不产生空段', () => {
    expect(highlightSegments('calc', 'ca')).toEqual([{ text: 'ca', hit: true }, { text: 'lc', hit: false }])
    expect(highlightSegments('calc', 'lc')).toEqual([{ text: 'ca', hit: false }, { text: 'lc', hit: true }])
  })

  it('无字面命中（拼音/首字母路径）整体不高亮，避免假高亮', () => {
    expect(highlightSegments('计算器', 'jsq')).toEqual([{ text: '计算器', hit: false }])
  })

  it('空 query 整段不高亮', () => {
    expect(highlightSegments('任意', '')).toEqual([{ text: '任意', hit: false }])
  })
})
