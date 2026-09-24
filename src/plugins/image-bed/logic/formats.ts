// 上传链接三格式输出（纯函数）：URL / Markdown / HTML。
import { nameWithoutExt } from './imagefile'
import type { LinkFormat } from './settings'

/** Markdown alt 文本：中括号转义，空/纯点文件名给 image 占位（路径分隔已由 baseNameSafe 剥掉） */
export function markdownAlt(filename: string): string {
  const name = nameWithoutExt(baseNameSafe(filename))
  if (name === '' || name.startsWith('.')) return 'image'
  return name.replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function baseNameSafe(filename: string): string {
  const idx = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
  return idx === -1 ? filename : filename.slice(idx + 1)
}

/** Markdown 链接目标里的空白与圆括号必须百分号编码，否则链接被截断 */
export function markdownUrl(url: string): string {
  return url.replace(/([ ()])/g, (ch) => {
    switch (ch) {
      case ' ':
        return '%20'
      case '(':
        return '%28'
      default:
        return '%29'
    }
  })
}

/** HTML 属性值转义（& < > "） */
export function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function formatLink(format: LinkFormat, url: string, filename: string): string {
  if (format === 'markdown') return `![${markdownAlt(filename)}](${markdownUrl(url)})`
  if (format === 'html') return `<img src="${htmlEscape(url)}" alt="${htmlEscape(markdownAlt(filename))}">`
  return url
}

export const FORMAT_LABELS: Record<LinkFormat, string> = {
  url: 'URL',
  markdown: 'Markdown',
  html: 'HTML'
}
