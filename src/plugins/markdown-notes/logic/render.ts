// 纯 JS Markdown 渲染器（无第三方依赖）：默认全转义，只输出白名单标签，
// 源文本里的原始 HTML 一律按字面显示，可安全用于 v-html。

export interface RenderOptions {
  /** 单个换行渲染为 <br>（速记场景默认 true），false 时为 CommonMark 软换行 */
  breaks?: boolean
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c])
}

const LINK_SCHEMES = new Set(['http', 'https', 'mailto'])
const IMAGE_SCHEMES = new Set(['http', 'https'])

/** href 白名单：http(s)/mailto/相对路径；图片额外放行 data:image/，其余（javascript: 等）拒绝 */
export function safeUrl(rawUrl: string, kind: 'link' | 'image'): string | null {
  const url = rawUrl.trim()
  if (url === '') return null
  if (kind === 'image' && /^data:image\/[a-z0-9.+-]+;/i.test(url)) return url
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url)
  if (m !== null) {
    const scheme = m[1].toLowerCase()
    return (kind === 'link' ? LINK_SCHEMES : IMAGE_SCHEMES).has(scheme) ? url : null
  }
  return url
}

// 行内 token 占位符（私用区字符），先摘出代码 span 与链接/图片再转义，避免标签被二次处理
const TOKEN = '\uE000'
const TOKEN_RE = /\uE000(\d+)\uE000/g

function formatSpans(s: string): string {
  let out = s
  out = out.replace(/\*\*\*(?=\S)([^*\n]*[^\s*])\*\*\*/g, '<strong><em>$1</em></strong>')
  out = out.replace(/\*\*(?=\S)([^*\n]*[^\s*])\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(?<!\w)__(?=\S)([^_\n]*[^\s_])__(?!\w)/g, '<strong>$1</strong>')
  out = out.replace(/\*(?=\S)([^*\n]*[^\s*])\*/g, '<em>$1</em>')
  // `_` 强调要求词边界，避免 snake_case_name 被误斜体
  out = out.replace(/(?<!\w)_(?=\S)([^_\n]*[^\s_])_(?!\w)/g, '<em>$1</em>')
  out = out.replace(/~~(?=\S)([^~\n]*[^\s~])~~/g, '<del>$1</del>')
  return out
}

interface LinkTarget {
  url: string
  title: string | null
}

function parseLinkTarget(raw: string): LinkTarget | null {
  let url = raw.trim()
  let title: string | null = null
  const m = /^(.*?)\s+("([^"]*)"|'([^']*)')\s*$/.exec(url)
  if (m !== null) {
    url = m[1].trim()
    title = m[3] !== undefined ? m[3] : (m[4] ?? null)
  }
  if (url === '') return null
  return { url, title }
}

function renderInline(text: string, breaks: boolean): string {
  const tokens: string[] = []
  const stash = (html: string): string => {
    tokens.push(html)
    return `${TOKEN}${tokens.length - 1}${TOKEN}`
  }

  // 1) 行内代码：内容按字面转义，不再参与任何后续替换
  let t = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_whole, _ticks: string, code: string) => {
    let c = code.replace(/\n/g, ' ')
    if (/^ .* .*$/.test(c) && c.trim() !== '') c = c.slice(1, -1)
    return stash(`<code>${escapeHtml(c)}</code>`)
  })

  // 2) 图片与链接：在转义前解析，URL 走白名单；非法目标原样保留（随后被转义显示）
  t = t.replace(/(!?)\[([^[\]\n]*)\]\(([^()\n]*)\)/g, (whole, bang: string, label: string, target: string) => {
    const parsed = parseLinkTarget(target)
    if (parsed === null) return whole
    const kind = bang === '!' ? 'image' : 'link'
    const url = safeUrl(parsed.url, kind)
    if (url === null) return whole
    const titleAttr = parsed.title !== null ? ` title="${escapeHtml(parsed.title)}"` : ''
    if (kind === 'image') {
      return stash(`<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}"${titleAttr}>`)
    }
    return stash(`<a href="${escapeHtml(url)}"${titleAttr}>${formatSpans(escapeHtml(label))}</a>`)
  })

  // 3) 转义 + 强调格式 + 换行处理 + 还原 token（token 内可嵌 token，如链接文本里的行内代码，需循环还原）
  let out = formatSpans(escapeHtml(t))
  if (breaks) out = out.replace(/\n/g, '<br>\n')
  for (let depth = 0; depth < 5 && out.includes(TOKEN); depth++) {
    out = out.replace(TOKEN_RE, (_m, idx: string) => tokens[Number(idx)] ?? '')
  }
  return out
}

// ---------- 块级解析 ----------

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const HEADING_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*#*[ \t]*$/
const HR_RE = /^ {0,3}((?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const QUOTE_RE = /^ {0,3}>/
const ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/
const TASK_RE = /^\[([ xX])\][ \t]+(.*)$/

interface ItemMatch {
  indent: number
  marker: string
  ordered: boolean
  text: string
}

function parseListItem(line: string): ItemMatch | null {
  const m = ITEM_RE.exec(line)
  if (m === null) return null
  const marker = m[2]
  return {
    indent: m[1].replace(/\t/g, '  ').length,
    marker,
    ordered: /\d/.test(marker),
    text: m[3] ?? ''
  }
}

function isBlockStart(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    parseListItem(line) !== null
  )
}

function isBlank(line: string): boolean {
  return line.trim() === ''
}

function indentOf(line: string): number {
  const m = /^(\s*)/.exec(line)
  return (m?.[1] ?? '').replace(/\t/g, '  ').length
}

function sameMarkerKind(a: ItemMatch, b: ItemMatch): boolean {
  if (a.ordered !== b.ordered) return false
  return a.ordered ? a.marker.slice(-1) === b.marker.slice(-1) : a.marker === b.marker
}

/** 列表项内容：前导普通行按行内渲染（紧凑 <li>a），其后的块级内容（嵌套列表等）递归块渲染 */
function renderListItemContent(lines: string[], breaks: boolean): string {
  const firstBlock = lines.findIndex((l) => isBlank(l) || isBlockStart(l))
  if (firstBlock === -1) return renderInline(lines.join('\n'), breaks)
  const head = lines.slice(0, firstBlock)
  const tailHtml = renderBlocks(lines.slice(firstBlock), breaks)
  if (head.length === 0) return tailHtml
  return `${renderInline(head.join('\n'), breaks)}\n${tailHtml}`
}

function parseList(lines: string[], i: number, breaks: boolean): { html: string; next: number } {
  const first = parseListItem(lines[i])
  if (first === null) throw new Error('unreachable: caller must ensure list item')
  const baseIndent = first.indent
  const items: Array<{ lines: string[]; contentIndent: number }> = []
  let cur: { lines: string[]; contentIndent: number } | null = null
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      // 空行后仍是本列表的条目/缩进内容才继续，否则列表结束
      let j = i + 1
      while (j < lines.length && isBlank(lines[j])) j++
      if (j >= lines.length) {
        i = j
        break
      }
      const nm = parseListItem(lines[j])
      const continues =
        (nm !== null && nm.indent === baseIndent && sameMarkerKind(nm, first)) ||
        indentOf(lines[j]) >= (cur !== null ? cur.contentIndent : baseIndent + 2)
      if (!continues) break
      i = j
      continue
    }
    const m = parseListItem(line)
    if (m !== null && m.indent === baseIndent && sameMarkerKind(m, first)) {
      if (cur !== null) items.push(cur)
      cur = { lines: [m.text], contentIndent: baseIndent + m.marker.length + 1 }
      i++
      continue
    }
    const lazyText = m === null && !isBlockStart(line)
    if (cur !== null && (indentOf(line) >= cur.contentIndent || lazyText)) {
      cur.lines.push(line)
      i++
      continue
    }
    break
  }
  if (cur !== null) items.push(cur)

  const lis = items.map((item) => {
    const dedented: string[] = []
    for (let k = 0; k < item.lines.length; k++) {
      if (k === 0) {
        dedented.push(item.lines[k])
        continue
      }
      let n = 0
      const l = item.lines[k]
      while (n < item.contentIndent && n < l.length && l[n] === ' ') n++
      dedented.push(l.slice(n))
    }
    const task = TASK_RE.exec(dedented[0] ?? '')
    const inner =
      task !== null ? [task[2], ...dedented.slice(1)] : dedented
    const body = renderListItemContent(inner, breaks)
    if (task !== null) {
      const checked = task[1] === ' ' ? '' : ' checked'
      return `<li class="task"><input type="checkbox" disabled${checked}> ${body}</li>`
    }
    return `<li>${body}</li>`
  })

  const tag = first.ordered ? 'ol' : 'ul'
  const startNum = first.ordered ? parseInt(first.marker, 10) : NaN
  const startAttr = first.ordered && startNum !== 1 ? ` start="${startNum}"` : ''
  return { html: `<${tag}${startAttr}>\n${lis.join('\n')}\n</${tag}>`, next: i }
}

function isSeparatorRow(line: string): boolean {
  const t = line.trim()
  if (!t.includes('|') || !t.includes('-')) return false
  return /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/.test(t)
}

function splitTableRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  for (let k = 0; k < t.length; k++) {
    const ch = t[k]
    if (ch === '\\' && t[k + 1] === '|') {
      cur += '|'
      k++
    } else if (ch === '|') {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function isTableStart(lines: string[], i: number): boolean {
  if (!lines[i].includes('|')) return false
  if (i + 1 >= lines.length) return false
  if (!isSeparatorRow(lines[i + 1])) return false
  return splitTableRow(lines[i]).length === splitTableRow(lines[i + 1]).length
}

function alignAttr(sep: string): string {
  if (/^:-+:$/.test(sep)) return ' style="text-align:center"'
  if (/^-+:$/.test(sep)) return ' style="text-align:right"'
  if (/^:-+$/.test(sep)) return ' style="text-align:left"'
  return ''
}

function parseTable(lines: string[], i: number): { html: string; next: number } {
  const headers = splitTableRow(lines[i])
  const aligns = splitTableRow(lines[i + 1]).map(alignAttr)
  i += 2
  const rows: string[][] = []
  while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
    const cells = splitTableRow(lines[i])
    while (cells.length < headers.length) cells.push('')
    rows.push(cells.slice(0, headers.length))
    i++
  }
  const head = headers.map((c, k) => `<th${aligns[k] ?? ''}>${renderInline(c, false)}</th>`).join('')
  const body = rows
    .map((r) => `<tr>${r.map((c, k) => `<td${aligns[k] ?? ''}>${renderInline(c, false)}</td>`).join('')}</tr>`)
    .join('\n')
  return {
    html: `<table>\n<thead>\n<tr>${head}</tr>\n</thead>\n<tbody>\n${body}\n</tbody>\n</table>`,
    next: i
  }
}

function renderBlocks(lines: string[], breaks: boolean): string {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (isBlank(line)) {
      i++
      continue
    }

    const fence = FENCE_RE.exec(line)
    if (fence !== null) {
      const openChar = fence[1][0]
      const openLen = fence[1].length
      const info = fence[2].trim().split(/\s+/)[0] ?? ''
      const lang = /^[A-Za-z0-9_+#.-]+$/.test(info) ? ` class="language-${info}"` : ''
      const body: string[] = []
      i++
      let closed = false
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i])
        if (close !== null && close[1][0] === openChar && close[1].length >= openLen) {
          closed = true
          i++
          break
        }
        body.push(lines[i])
        i++
      }
      // 未闭合的围栏渲染到结尾，不抛错
      out.push(`<pre><code${lang}>${escapeHtml(body.join('\n'))}</code></pre>`)
      if (!closed) break
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2] ?? '', false)}</h${level}>`)
      i++
      continue
    }

    if (HR_RE.test(line)) {
      out.push('<hr>')
      i++
      continue
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE_RE.test(lines[i])) {
        quoted.push(lines[i].replace(/^ {0,3}> ?/, ''))
        i++
      }
      out.push(`<blockquote>\n${renderBlocks(quoted, breaks)}\n</blockquote>`)
      continue
    }

    if (isTableStart(lines, i)) {
      const { html, next } = parseTable(lines, i)
      out.push(html)
      i = next
      continue
    }

    if (parseListItem(line) !== null) {
      const { html, next } = parseList(lines, i, breaks)
      out.push(html)
      i = next
      continue
    }

    const para: string[] = [line]
    i++
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !isBlockStart(lines[i]) &&
      !isTableStart(lines, i)
    ) {
      para.push(lines[i])
      i++
    }
    out.push(`<p>${renderInline(para.join('\n'), breaks)}</p>`)
  }
  return out.join('\n')
}

/** Markdown → HTML 片段（仅白名单标签，文本全转义）；输入为空返回 '' */
export function renderMarkdown(src: string, opts: RenderOptions = {}): string {
  const breaks = opts.breaks !== false
  if (typeof src !== 'string' || src === '') return ''
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  return renderBlocks(lines, breaks)
}
