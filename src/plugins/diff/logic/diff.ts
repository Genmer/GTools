// 纯逻辑 diff（无 vue/electron 依赖）：Myers 行级 diff + 词级行内 diff + 统计 + unified 文本导出

export interface DiffOptions {
  ignoreCase: boolean
  ignoreWhitespace: boolean
}

export interface DiffSegment {
  text: string
  changed: boolean
}

export interface DiffSideCell {
  /** 1-based 原始行号 */
  lineNo: number
  /** 原文（比较用归一化 key，展示永远用原文） */
  text: string
  segments: DiffSegment[]
}

export type DiffRowType = 'equal' | 'insert' | 'delete' | 'modify'

export interface DiffRow {
  type: DiffRowType
  left: DiffSideCell | null
  right: DiffSideCell | null
}

export interface DiffStats {
  added: number
  removed: number
  modified: number
}

export interface DiffResult {
  rows: DiffRow[]
  stats: DiffStats
}

export interface EditOp {
  type: 'equal' | 'delete' | 'insert'
  /** 操作涉及的 a 序列下标，insert 时为 -1 */
  aIdx: number
  /** 操作涉及的 b 序列下标，delete 时为 -1 */
  bIdx: number
}

export function splitLines(text: string): string[] {
  if (text === '') return []
  // Windows CRLF/孤立 \r 均按行断开（Windows 真机行为未实测，按方案处理）
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > 0 && lines[lines.length - 1] === '' && (text.endsWith('\n') || text.endsWith('\r'))) {
    lines.pop()
  }
  return lines
}

export function lineKey(line: string, options: DiffOptions): string {
  let k = line
  if (options.ignoreWhitespace) k = k.trim().replace(/\s+/g, ' ')
  if (options.ignoreCase) k = k.toLowerCase()
  return k
}

/**
 * 序列 diff（公共前后缀裁剪 + Myers 追踪回溯）。
 * 输入为「比较 key」数组；返回操作序列，equal 保证两元素相等。
 */
export function diffSequences(a: readonly string[], b: readonly string[]): EditOp[] {
  const ops: EditOp[] = []
  let start = 0
  let endA = a.length
  let endB = b.length
  while (start < endA && start < endB && a[start] === b[start]) start++
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  for (let i = 0; i < start; i++) ops.push({ type: 'equal', aIdx: i, bIdx: i })
  diffMiddle(a, start, endA, b, start, endB, ops)
  for (let i = endA; i < a.length; i++) {
    ops.push({ type: 'equal', aIdx: i, bIdx: endB + (i - endA) })
  }
  return ops
}

// Myers 追踪版规模上限：快照内存 ~ (D+1)² 个 int32；超限降级为整块删+增（保序、统计正确，放弃行级最优对齐）
const MAX_MYERS_N_PLUS_M = 3000

function diffMiddle(
  a: readonly string[],
  aLo: number,
  aHi: number,
  b: readonly string[],
  bLo: number,
  bHi: number,
  out: EditOp[]
): void {
  const n = aHi - aLo
  const m = bHi - bLo
  if (n === 0 && m === 0) return
  if (n + m > MAX_MYERS_N_PLUS_M) {
    for (let i = aLo; i < aHi; i++) out.push({ type: 'delete', aIdx: i, bIdx: -1 })
    for (let j = bLo; j < bHi; j++) out.push({ type: 'insert', aIdx: -1, bIdx: j })
    return
  }
  const offset = n + m
  const v = new Int32Array(2 * offset + 1).fill(-1)
  v[offset + 1] = 0
  // trace[d] 为第 d 轮处理前的 k∈[-d,d] 窗口快照（下标 k+d）
  const trace: Int32Array[] = []
  for (let d = 0; d <= offset; d++) {
    trace.push(v.slice(offset - d, offset + d + 1))
    let done = false
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1]
      else x = v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++
        y++
      }
      v[offset + k] = x
      if (x >= n && y >= m) {
        done = true
        break
      }
    }
    if (done) break
  }
  // 回溯：从 (n,m) 逆向收集蛇与编辑步
  const rev: EditOp[] = []
  let x = n
  let y = m
  for (let d = trace.length - 1; d >= 0; d--) {
    let prevX: number
    let prevY: number
    if (d === 0) {
      prevX = 0
      prevY = -1
    } else {
      const snap = trace[d]
      const k = x - y
      const prevK =
        k === -d || (k !== d && snap[k - 1 + d] < snap[k + 1 + d]) ? k + 1 : k - 1
      prevX = snap[prevK + d]
      prevY = prevX - prevK
    }
    while (x > prevX && y > prevY) {
      rev.push({ type: 'equal', aIdx: aLo + x - 1, bIdx: bLo + y - 1 })
      x--
      y--
    }
    if (d > 0) {
      if (x === prevX) rev.push({ type: 'insert', aIdx: -1, bIdx: bLo + y - 1 })
      else rev.push({ type: 'delete', aIdx: aLo + x - 1, bIdx: -1 })
    }
    x = prevX
    y = prevY
  }
  rev.reverse()
  // 不用 spread push：降级场景 rev 可达数万项，超出参数上限
  for (const op of rev) out.push(op)
}

const TOKEN_RE = /\w+|\s+|[^\w\s]/g

export function tokenize(line: string): string[] {
  return line.match(TOKEN_RE) ?? []
}

function tokenKey(token: string, options: DiffOptions): string {
  let k = token
  // 忽略空白时任何空白 token 视为等价单空格（行内多空格差异不标红）
  if (options.ignoreWhitespace && /^\s+$/.test(token)) k = ' '
  if (options.ignoreCase) k = k.toLowerCase()
  return k
}

function pushSeg(list: DiffSegment[], text: string, changed: boolean): void {
  if (text !== '') list.push({ text, changed })
}

function mergeSegments(segs: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = []
  for (const s of segs) {
    const last = out[out.length - 1]
    if (last !== undefined && last.changed === s.changed) last.text += s.text
    else out.push({ text: s.text, changed: s.changed })
  }
  return out
}

/** 行内词级差异：对两侧 token 序列再做一次 diff，输出左右两列的高亮分段 */
export function wordSegments(
  oldLine: string,
  newLine: string,
  options: DiffOptions
): { left: DiffSegment[]; right: DiffSegment[] } {
  const ta = tokenize(oldLine)
  const tb = tokenize(newLine)
  const ops = diffSequences(
    ta.map((t) => tokenKey(t, options)),
    tb.map((t) => tokenKey(t, options))
  )
  const left: DiffSegment[] = []
  const right: DiffSegment[] = []
  for (const op of ops) {
    if (op.type === 'equal') {
      pushSeg(left, ta[op.aIdx], false)
      pushSeg(right, tb[op.bIdx], false)
    } else if (op.type === 'delete') {
      pushSeg(left, ta[op.aIdx], true)
    } else {
      pushSeg(right, tb[op.bIdx], true)
    }
  }
  return { left: mergeSegments(left), right: mergeSegments(right) }
}

// 配对门槛：两侧行至少共享一个 token（按比较 key）才算「修改」，否则按纯增/纯删展示（随机大文件降级时不会全部误判为修改）
function sharesToken(oldLine: string, newLine: string, options: DiffOptions): boolean {
  const ka = new Set(tokenize(oldLine).map((t) => tokenKey(t, options)))
  if (ka.size === 0) return false
  for (const t of tokenize(newLine)) {
    if (ka.has(tokenKey(t, options))) return true
  }
  return false
}

function plainCell(lineNo: number, text: string): DiffSideCell {
  return { lineNo, text, segments: [{ text, changed: false }] }
}

export function computeLineDiff(textA: string, textB: string, options: DiffOptions): DiffResult {
  const a = splitLines(textA)
  const b = splitLines(textB)
  const ka = a.map((l) => lineKey(l, options))
  const kb = b.map((l) => lineKey(l, options))
  const ops = diffSequences(ka, kb)

  const rows: DiffRow[] = []
  const stats: DiffStats = { added: 0, removed: 0, modified: 0 }
  let i = 0
  while (i < ops.length) {
    if (ops[i].type === 'equal') {
      const op = ops[i]
      rows.push({
        type: 'equal',
        left: plainCell(op.aIdx + 1, a[op.aIdx]),
        right: plainCell(op.bIdx + 1, b[op.bIdx])
      })
      i++
      continue
    }
    // 连续非 equal 为一个差异块；块内按同下标配对（共享 token 才算修改行，其余按纯删/纯增成对输出）
    const dels: number[] = []
    const ins: number[] = []
    while (i < ops.length && ops[i].type !== 'equal') {
      if (ops[i].type === 'delete') dels.push(ops[i].aIdx)
      else ins.push(ops[i].bIdx)
      i++
    }
    const pairs = Math.min(dels.length, ins.length)
    for (let p = 0; p < pairs; p++) {
      const oldLine = a[dels[p]]
      const newLine = b[ins[p]]
      if (sharesToken(oldLine, newLine, options)) {
        const segs = wordSegments(oldLine, newLine, options)
        rows.push({
          type: 'modify',
          left: { lineNo: dels[p] + 1, text: oldLine, segments: segs.left },
          right: { lineNo: ins[p] + 1, text: newLine, segments: segs.right }
        })
        stats.modified++
      } else {
        rows.push({ type: 'delete', left: plainCell(dels[p] + 1, oldLine), right: null })
        rows.push({ type: 'insert', left: null, right: plainCell(ins[p] + 1, newLine) })
        stats.removed++
        stats.added++
      }
    }
    for (let p = pairs; p < dels.length; p++) {
      rows.push({ type: 'delete', left: plainCell(dels[p] + 1, a[dels[p]]), right: null })
      stats.removed++
    }
    for (let p = pairs; p < ins.length; p++) {
      rows.push({ type: 'insert', left: null, right: plainCell(ins[p] + 1, b[ins[p]]) })
      stats.added++
    }
  }
  return { rows, stats }
}

/** 复制用 unified diff 文本（3 行上下文，GNU patch 头格式）；无差异返回 '' */
export function formatUnified(result: DiffResult, labelLeft: string, labelRight: string): string {
  const { rows } = result
  const changedIdx: number[] = []
  rows.forEach((r, idx) => {
    if (r.type !== 'equal') changedIdx.push(idx)
  })
  if (changedIdx.length === 0) return ''
  const CTX = 3
  const ranges: Array<[number, number]> = []
  for (const idx of changedIdx) {
    const s = Math.max(0, idx - CTX)
    const e = Math.min(rows.length - 1, idx + CTX)
    const last = ranges[ranges.length - 1]
    if (last !== undefined && s <= last[1] + 1) last[1] = Math.max(last[1], e)
    else ranges.push([s, e])
  }
  const parts: string[] = [`--- ${labelLeft}`, `+++ ${labelRight}`]
  for (const [s, e] of ranges) {
    let leftStart = -1
    let leftCount = 0
    let rightStart = -1
    let rightCount = 0
    for (let i = s; i <= e; i++) {
      const r = rows[i]
      if (r.left !== null) {
        if (leftStart < 0) leftStart = r.left.lineNo
        leftCount++
      }
      if (r.right !== null) {
        if (rightStart < 0) rightStart = r.right.lineNo
        rightCount++
      }
    }
    const ls = leftCount === 0 ? 0 : leftStart
    const rs = rightCount === 0 ? 0 : rightStart
    parts.push(
      `@@ -${ls}${leftCount === 1 ? '' : `,${leftCount}`} +${rs}${rightCount === 1 ? '' : `,${rightCount}`} @@`
    )
    for (let i = s; i <= e; i++) {
      const r = rows[i]
      if (r.type === 'equal') {
        parts.push(` ${(r.left ?? r.right)?.text ?? ''}`)
      } else {
        if (r.left !== null) parts.push(`-${r.left.text}`)
        if (r.right !== null) parts.push(`+${r.right.text}`)
      }
    }
  }
  return `${parts.join('\n')}\n`
}
