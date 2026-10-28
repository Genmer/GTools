// JSON 纯文本轻量五彩高亮器：正则分词 + HTML 转义生成覆盖层，大文本逃逸只转义防主线程冻结。
// 搜索命中以 <mark> 叠进原文段（与分词解耦：逃逸路径同样能标命中）。

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

function tokenClass(token: string): string | null {
  if (token.startsWith('"')) return token.endsWith(':') ? 'hl-key' : 'hl-str'
  if (token === 'true' || token === 'false') return 'hl-bool'
  if (token === 'null') return 'hl-null'
  if (/^-?\d/.test(token)) return 'hl-num'
  if (/[{}[\]:,]/.test(token)) return 'hl-punct'
  return null
}

export interface MatchSpan {
  start: number
  end: number
}

interface HitRange extends MatchSpan {
  current: boolean
}

/** 命中区间裁剪到文本长度并按 start 排序（文本编辑后残留的旧区间不炸） */
function buildHits(json: string, matches: readonly MatchSpan[] | undefined, currentIdx: number): HitRange[] {
  if (matches === undefined || matches.length === 0) return []
  const hits: HitRange[] = []
  for (let i = 0; i < matches.length; i++) {
    const start = Math.max(0, Math.min(matches[i].start, json.length))
    const end = Math.max(start, Math.min(matches[i].end, json.length))
    if (end > start) hits.push({ start, end, current: i === currentIdx })
  }
  hits.sort((a, b) => a.start - b.start)
  return hits
}

/** 段内标记：命中与段落求交后转义；游标 h 随文档序推进，整体保持 O(n) */
function makeMarker(json: string, hits: readonly HitRange[]): (from: number, to: number) => string {
  let h = 0
  return (from, to) => {
    while (h < hits.length && hits[h].end <= from) h++
    let out = ''
    let i = from
    for (let g = h; g < hits.length && hits[g].start < to; g++) {
      const s = Math.max(hits[g].start, i)
      const e = Math.min(hits[g].end, to)
      if (e <= s) continue
      if (s > i) out += escapeHtml(json.slice(i, s))
      out += `<mark class="${hits[g].current ? 'hl-hit-cur' : 'hl-hit'}">${escapeHtml(json.slice(s, e))}</mark>`
      i = e
    }
    if (i < to) out += escapeHtml(json.slice(i, to))
    return out
  }
}

export function highlightJson(json: string, matches?: readonly MatchSpan[], currentIdx = -1): string {
  const hits = buildHits(json, matches, currentIdx)
  if (json.length > MAX_HIGHLIGHT_LEN) {
    return hits.length === 0 ? escapeHtml(json) : makeMarker(json, hits)(0, json.length)
  }

  const mark = makeMarker(json, hits)
  let result = ''
  let lastIndex = 0
  const re = new RegExp(TOKEN_RE.source, 'g')
  let m: RegExpExecArray | null

  while ((m = re.exec(json)) !== null) {
    if (m.index > lastIndex) result += mark(lastIndex, m.index)
    const cls = tokenClass(m[0])
    const inner = mark(m.index, re.lastIndex)
    result += cls === null ? inner : `<span class="${cls}">${inner}</span>`
    lastIndex = re.lastIndex
  }

  if (lastIndex < json.length) result += mark(lastIndex, json.length)

  return result
}
