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

/** 一处查找匹配的原文区间与是否当前条；offset 为 UTF-16 code unit，与 findMatches 的 indexOf 同坐标系 */
export interface FindMark {
  start: number
  end: number
  current: boolean
}

// token 与 gap 统一为 segment；bool/null/数字/标点 token 不含 HTML 特殊字符，统一 escapeHtml 后输出与旧逐 token formatToken 逐字节一致
interface Segment {
  text: string
  cls: string | null
  start: number
}

function tokenClass(token: string): string | null {
  if (token.startsWith('"')) {
    return token.endsWith(':') ? 'key' : 'str'
  }
  if (token === 'true' || token === 'false') return 'bool'
  if (token === 'null') return 'null'
  if (/^-?\d/.test(token)) return 'num'
  if (/[{}[\]:,]/.test(token)) return 'punct'
  return null
}

function tokenizeSegments(json: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0
  const re = new RegExp(TOKEN_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(json)) !== null) {
    if (m.index > lastIndex) segments.push({ text: json.slice(lastIndex, m.index), cls: null, start: lastIndex })
    segments.push({ text: m[0], cls: tokenClass(m[0]), start: m.index })
    lastIndex = re.lastIndex
  }
  if (lastIndex < json.length) segments.push({ text: json.slice(lastIndex), cls: null, start: lastIndex })
  return segments
}

// 越界/乱序/重叠条目跳过不抛错，返回合法且升序不重叠的子集
function validMarks(json: string, marks: readonly FindMark[]): FindMark[] {
  const out: FindMark[] = []
  let cursor = 0
  for (const m of marks) {
    if (!Number.isFinite(m.start) || !Number.isFinite(m.end)) continue
    if (m.start < 0 || m.end > json.length || m.start >= m.end || m.start < cursor) continue
    out.push(m)
    cursor = m.end
  }
  return out
}

function plainSegment(seg: Segment): string {
  return seg.cls !== null ? `<span class="hl-${seg.cls}">${escapeHtml(seg.text)}</span>` : escapeHtml(seg.text)
}

interface Piece {
  text: string
  marked: 'no' | 'all' | 'cur'
}

// cls span 包整段、find-all span 嵌其内：匹配跨 token 边界时背景连续且语法色保留
function renderSegment(seg: Segment, marks: readonly FindMark[], from: number, to: number): string {
  if (from >= to) return plainSegment(seg)
  const segEnd = seg.start + seg.text.length
  const pieces: Piece[] = []
  let pos = seg.start
  for (let k = from; k < to; k++) {
    const m = marks[k]
    const s = Math.max(m.start, seg.start)
    const e = Math.min(m.end, segEnd)
    if (s > pos) pieces.push({ text: seg.text.slice(pos - seg.start, s - seg.start), marked: 'no' })
    pieces.push({ text: seg.text.slice(s - seg.start, e - seg.start), marked: m.current ? 'cur' : 'all' })
    pos = e
  }
  if (pos < segEnd) pieces.push({ text: seg.text.slice(pos - seg.start), marked: 'no' })

  let out = seg.cls !== null ? `<span class="hl-${seg.cls}">` : ''
  for (const p of pieces) {
    if (p.marked === 'no') {
      out += escapeHtml(p.text)
    } else {
      out += `<span class="find-all${p.marked === 'cur' ? ' cur' : ''}">${escapeHtml(p.text)}</span>`
    }
  }
  if (seg.cls !== null) out += '</span>'
  return out
}

// marks 与 segments 均按位置有序，双指针摊还线性；大文本下避免每段全量过滤 marks
function renderHtml(segments: readonly Segment[], marks: readonly FindMark[]): string {
  let result = ''
  let mi = 0
  for (const seg of segments) {
    while (mi < marks.length && marks[mi].end <= seg.start) mi++
    let j = mi
    while (j < marks.length && marks[j].start < seg.start + seg.text.length) j++
    result += renderSegment(seg, marks, mi, j)
  }
  return result
}

export function highlightJson(json: string): string {
  return highlightJsonWithFinds(json, [])
}

/** highlightJson 的全标记版：marks 升序不重叠，非法条目跳过；marks=[] 输出与 highlightJson 逐字节一致 */
export function highlightJsonWithFinds(json: string, marks: readonly FindMark[]): string {
  const valid = validMarks(json, marks)
  if (json.length > MAX_HIGHLIGHT_LEN) {
    return renderSegment({ text: json, cls: null, start: 0 }, valid, 0, valid.length)
  }
  return renderHtml(tokenizeSegments(json), valid)
}

/** starts 升序不重叠（findMatches 产出即满足）；len≤0 或 cap≤0 返 []；只取前 cap 条，i===currentIndex 标 current */
export function buildFindMarks(starts: readonly number[], len: number, currentIndex: number, cap: number): FindMark[] {
  if (len <= 0 || cap <= 0) return []
  const out: FindMark[] = []
  const n = Math.min(starts.length, cap)
  for (let i = 0; i < n; i++) {
    out.push({ start: starts[i], end: starts[i] + len, current: i === currentIndex })
  }
  return out
}
