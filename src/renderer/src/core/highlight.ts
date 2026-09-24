export interface HighlightSeg {
  text: string
  hit: boolean
}

/**
 * 字面子串命中才高亮（大小写不敏感）；拼音/首字母路径无字面对应，不给假高亮。
 * 纯函数，供 ResultList 模板分段渲染。
 */
export function highlightSegments(text: string, query: string): HighlightSeg[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [{ text, hit: false }]
  const idx = text.toLowerCase().indexOf(q)
  if (idx < 0) return [{ text, hit: false }]
  return [
    { text: text.slice(0, idx), hit: false },
    { text: text.slice(idx, idx + q.length), hit: true },
    { text: text.slice(idx + q.length), hit: false }
  ].filter((s) => s.text !== '')
}
