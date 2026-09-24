// JSON 纯文本轻量五彩高亮器：利用正则与 HTML 转义生成 span 覆盖层，大文本逃逸避免主线程冻结。

const MAX_HIGHLIGHT_LEN = 200_000

const TOKEN_RE =
  /"(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\],:]/g

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatToken(token: string): string {
  if (token.startsWith('"')) {
    if (token.endsWith(':')) {
      return `<span class="hl-key">${escapeHtml(token)}</span>`
    }
    return `<span class="hl-str">${escapeHtml(token)}</span>`
  }
  if (token === 'true' || token === 'false') {
    return `<span class="hl-bool">${token}</span>`
  }
  if (token === 'null') {
    return `<span class="hl-null">${token}</span>`
  }
  if (/^-?\d/.test(token)) {
    return `<span class="hl-num">${token}</span>`
  }
  if (/[{}[\]:,]/.test(token)) {
    return `<span class="hl-punct">${token}</span>`
  }
  return escapeHtml(token)
}

export function highlightJson(json: string): string {
  if (json.length > MAX_HIGHLIGHT_LEN) {
    return escapeHtml(json)
  }

  let result = ''
  let lastIndex = 0
  const re = new RegExp(TOKEN_RE.source, 'g')
  let m: RegExpExecArray | null

  while ((m = re.exec(json)) !== null) {
    if (m.index > lastIndex) {
      result += escapeHtml(json.slice(lastIndex, m.index))
    }
    result += formatToken(m[0])
    lastIndex = re.lastIndex
  }

  if (lastIndex < json.length) {
    result += escapeHtml(json.slice(lastIndex))
  }

  return result
}
