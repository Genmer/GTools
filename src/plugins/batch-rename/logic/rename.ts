// 批量重命名纯逻辑：路径拆合、规则链编译与应用、目标名校验、冲突检测、执行排序与撤销。
// 不 import 任何运行时依赖（渲染层与单测共用同一份代码）。

export type TargetPlatform = 'darwin' | 'win32' | 'linux'

export function normalizePlatform(p: string): TargetPlatform {
  if (p === 'win32' || p.startsWith('win')) return 'win32'
  if (p === 'darwin') return 'darwin'
  return 'linux'
}

// ---------- 路径与文件名拆合（兼容 / 与 \，拖入路径分隔符随平台而来） ----------

export function baseNameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? p : p.slice(i + 1)
}

export function dirNameOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? '' : p.slice(0, i)
}

export function joinPath(dir: string, name: string): string {
  if (dir === '') return name
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + sep + name
}

export function splitFileName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.')
  // dot<=0：无扩展名，或 .gitignore 这类点文件整体视作主名
  if (dot <= 0) return { base: name, ext: '' }
  return { base: name.slice(0, dot), ext: name.slice(dot) }
}

export function joinBaseExt(base: string, ext: string): string {
  if (ext === '') return base
  return base + (ext.startsWith('.') ? ext : '.' + ext)
}

// ---------- 规则模型 ----------

export const RULE_TYPES = [
  { type: 'replace', label: '查找替换' },
  { type: 'insert', label: '插入字符' },
  { type: 'delete', label: '删除字符' },
  { type: 'sequence', label: '序号' },
  { type: 'case', label: '大小写' },
  { type: 'ext', label: '扩展名' }
] as const

export type RuleType = (typeof RULE_TYPES)[number]['type']

export type ReplaceScope = 'name' | 'full'
export type PositionMode = 'start' | 'end' | 'index'
export type CaseMode = 'upper' | 'lower' | 'title'

export interface ReplaceRule {
  type: 'replace'
  find: string
  replaceWith: string
  useRegex: boolean
  caseSensitive: boolean
  /** name=只作用于主名（不含扩展名）；full=整个文件名 */
  scope: ReplaceScope
}
export interface InsertRule {
  type: 'insert'
  text: string
  at: number | 'start' | 'end'
}
export interface DeleteRule {
  type: 'delete'
  at: number | 'start' | 'end'
  count: number
}
export interface SequenceRule {
  type: 'sequence'
  start: number
  step: number
  /** 序号最小位数，不足补零 */
  digits: number
  position: 'prefix' | 'suffix' | number
}
export interface CaseRule {
  type: 'case'
  mode: CaseMode
}
export interface ExtRule {
  type: 'ext'
  /** 不含点；空串=去掉扩展名；写入时归一（去 * 与前导点） */
  value: string
}

export type RenameRule = ReplaceRule | InsertRule | DeleteRule | SequenceRule | CaseRule | ExtRule

/** UI 编辑态：平铺全部字段（v-model 无判别式窄化负担），draftToRule 折叠成 RenameRule */
export interface RuleDraft {
  uid: number
  type: RuleType
  // replace
  find: string
  replaceWith: string
  useRegex: boolean
  caseSensitive: boolean
  scope: ReplaceScope
  // insert / delete
  text: string
  atMode: PositionMode
  at: number
  count: number
  // sequence
  start: number
  step: number
  digits: number
  seqMode: 'prefix' | 'suffix' | 'index'
  // case
  caseMode: CaseMode
  // ext
  extValue: string
}

export function makeDraft(type: RuleType): RuleDraft {
  return {
    uid: 0,
    type,
    find: '',
    replaceWith: '',
    useRegex: false,
    caseSensitive: true,
    scope: 'name',
    text: '',
    atMode: 'end',
    at: 0,
    count: 1,
    start: 1,
    step: 1,
    digits: 3,
    seqMode: 'prefix',
    caseMode: 'lower',
    extValue: ''
  }
}

function atValue(d: RuleDraft): number | 'start' | 'end' {
  return d.atMode === 'index' ? d.at : d.atMode
}

export function draftToRule(d: RuleDraft): RenameRule {
  switch (d.type) {
    case 'replace':
      return {
        type: 'replace',
        find: d.find,
        replaceWith: d.replaceWith,
        useRegex: d.useRegex,
        caseSensitive: d.caseSensitive,
        scope: d.scope
      }
    case 'insert':
      return { type: 'insert', text: d.text, at: atValue(d) }
    case 'delete':
      return { type: 'delete', at: atValue(d), count: d.count }
    case 'sequence':
      return {
        type: 'sequence',
        start: d.start,
        step: d.step,
        digits: d.digits,
        position: d.seqMode === 'index' ? d.at : d.seqMode
      }
    case 'case':
      return { type: 'case', mode: d.caseMode }
    case 'ext':
      return { type: 'ext', value: d.extValue }
  }
}

// ---------- 规则编译（参数合法性前置，坏规则不进执行期） ----------

export interface CompiledReplace extends ReplaceRule {
  re: RegExp | null
}
export type CompiledRule =
  | CompiledReplace
  | InsertRule
  | DeleteRule
  | SequenceRule
  | CaseRule
  | { type: 'ext'; ext: string }

export type CompileResult = { ok: true; chain: CompiledRule[] } | { ok: false; message: string }

function toInt(v: unknown, dflt: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : dflt
}

/** 扩展名归一：去空白、去通配 * 与前导点；空串表示移除扩展名 */
export function normalizeExt(value: string): string {
  const core = value.trim().replace(/^\*+/, '').replace(/^\.+/, '').trim()
  return core === '' ? '' : '.' + core
}

export function compileRules(rules: readonly RenameRule[]): CompileResult {
  const chain: CompiledRule[] = []
  for (const r of rules) {
    switch (r.type) {
      case 'replace': {
        if (r.find === '') return { ok: false, message: '查找替换：查找内容为空' }
        let re: RegExp | null = null
        if (r.useRegex) {
          try {
            re = new RegExp(r.find, r.caseSensitive ? 'g' : 'gi')
          } catch (err) {
            return { ok: false, message: `正则无效：${err instanceof Error ? err.message : String(err)}` }
          }
        }
        chain.push({ ...r, re })
        break
      }
      case 'insert':
        chain.push({ type: 'insert', text: r.text, at: r.at })
        break
      case 'delete':
        chain.push({ type: 'delete', at: r.at, count: Math.max(0, toInt(r.count, 0)) })
        break
      case 'sequence':
        chain.push({
          type: 'sequence',
          start: toInt(r.start, 1),
          step: toInt(r.step, 1),
          digits: Math.min(10, Math.max(0, toInt(r.digits, 0))),
          position: r.position
        })
        break
      case 'case':
        chain.push({ type: 'case', mode: r.mode })
        break
      case 'ext':
        chain.push({ type: 'ext', ext: normalizeExt(r.value) })
        break
    }
  }
  return { ok: true, chain }
}

// ---------- 规则应用 ----------

function resolvePos(at: number | 'start' | 'end', len: number): number {
  if (at === 'start') return 0
  if (at === 'end') return len
  if (!Number.isFinite(at)) return 0
  const n = Math.trunc(at)
  // 负数 = 从末尾数（-1 为最后一个字符前）
  return n < 0 ? Math.max(0, len + n) : Math.min(len, n)
}

export function padNumber(n: number, digits: number): string {
  const s = Math.abs(Math.trunc(n)).toString()
  return (n < 0 ? '-' : '') + s.padStart(Math.max(digits, s.length), '0')
}

function applyCase(base: string, mode: CaseMode): string {
  if (mode === 'upper') return base.toUpperCase()
  if (mode === 'lower') return base.toLowerCase()
  let out = ''
  let cap = true
  for (const ch of base.toLowerCase()) {
    const isWord = /\p{L}|\p{N}/u.test(ch)
    out += isWord && cap ? ch.toUpperCase() : ch
    if (isWord) cap = false
    else cap = true
  }
  return out
}

function replacePlain(s: string, find: string, repl: string, caseSensitive: boolean): string {
  if (caseSensitive) return s.split(find).join(repl)
  const lower = s.toLowerCase()
  const lf = find.toLowerCase()
  let out = ''
  let i = 0
  for (;;) {
    const at = lower.indexOf(lf, i)
    if (at < 0) {
      out += s.slice(i)
      break
    }
    out += s.slice(i, at) + repl
    i = at + find.length
  }
  return out
}

/** index = 文件在列表中的序号（序号规则的计数基准） */
export function applyChain(fileName: string, chain: readonly CompiledRule[], index: number): string {
  let { base, ext } = splitFileName(fileName)
  for (const r of chain) {
    switch (r.type) {
      case 'replace': {
        if (r.scope === 'full') {
          const next = r.re
            ? joinBaseExt(base, ext).replace(r.re, r.replaceWith)
            : replacePlain(joinBaseExt(base, ext), r.find, r.replaceWith, r.caseSensitive)
          const sp = splitFileName(next)
          base = sp.base
          ext = sp.ext
        } else {
          base = r.re ? base.replace(r.re, r.replaceWith) : replacePlain(base, r.find, r.replaceWith, r.caseSensitive)
        }
        break
      }
      case 'insert': {
        const at = resolvePos(r.at, base.length)
        base = base.slice(0, at) + r.text + base.slice(at)
        break
      }
      case 'delete': {
        const at = resolvePos(r.at, base.length)
        const end = Math.min(base.length, at + r.count)
        base = base.slice(0, at) + base.slice(end)
        break
      }
      case 'sequence': {
        const token = padNumber(r.start + index * r.step, r.digits)
        if (r.position === 'prefix') base = token + base
        else if (r.position === 'suffix') base = base + token
        else {
          const at = resolvePos(r.position, base.length)
          base = base.slice(0, at) + token + base.slice(at)
        }
        break
      }
      case 'case':
        base = applyCase(base, r.mode)
        break
      case 'ext':
        ext = r.ext
        break
    }
  }
  return joinBaseExt(base, ext)
}

// ---------- 目标名校验 ----------

const WIN_INVALID_RE = /[<>:"|?*\u0000-\u001f]/
const WIN_RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** 返回错误文案；null = 合法。win32 分支按方案实现，本机 macOS 无法真机实测。 */
export function validateTargetName(name: string, platform: TargetPlatform): string | null {
  if (name === '') return '文件名为空'
  if (name === '.' || name === '..') return '不能为 . 或 ..'
  if (name.includes('/')) return '不能包含 /'
  if (name.includes('\u0000')) return '包含非法字符'
  if (platform === 'win32') {
    if (WIN_INVALID_RE.test(name)) return 'Windows 不允许 < > : " | ? * 及控制字符'
    const firstSeg = name.split('.')[0] ?? name
    if (WIN_RESERVED_RE.test(firstSeg)) return 'Windows 保留设备名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）'
    if (/[. ]$/.test(name)) return 'Windows 文件名不能以点或空格结尾'
  } else if (name.includes(':')) {
    // POSIX 名字里允许 ':'，但 Finder 会把它当路径分隔符显示，改名工具应拦下
    return 'macOS 下文件名不建议包含 :'
  }
  return null
}

// ---------- 列表与预览 ----------

export interface FileItem {
  id: string
  path: string
  dir: string
  name: string
}

let fileSeq = 0

/** 去重（路径忽略大小写——win/mac 文件系统均不区分）后构造列表项，保持传入顺序 */
export function makeFileItems(paths: readonly string[], existingItems: readonly FileItem[] = []): FileItem[] {
  const seen = new Set(existingItems.map((f) => f.path.toLowerCase()))
  const out: FileItem[] = []
  for (const p of paths) {
    const key = p.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: `f${++fileSeq}`, path: p, dir: dirNameOf(p), name: baseNameOf(p) })
  }
  return out
}

export type ConflictKind = '重名' | '与现存文件冲突'

export interface PreviewRow {
  id: string
  path: string
  dir: string
  oldName: string
  newName: string
  changed: boolean
  conflict: ConflictKind | null
  invalid: string | null
}

export interface PreviewResult {
  ok: boolean
  message: string
  rows: PreviewRow[]
  changedCount: number
  conflictCount: number
  invalidCount: number
}

/**
 * 冲突判定（同目录、文件名忽略大小写——NTFS 与默认 APFS 均如此）：
 * 1) 批内最终名重复 → 全部标「重名」；
 * 2) 目标名与盘上现存文件相撞 → 标「与现存文件冲突」，但若现存者恰是批内将被改走的文件（腾位链）则放行，
 *    由 orderOps 保证先腾后占；纯大小写调整（同名换大小写）不算冲突。
 */
export function buildPreview(
  items: readonly FileItem[],
  rules: readonly RenameRule[],
  existingByDir: ReadonlyMap<string, ReadonlySet<string>>,
  platform: TargetPlatform
): PreviewResult {
  const compiled = compileRules(rules)
  if (!compiled.ok) {
    return {
      ok: false,
      message: compiled.message,
      rows: items.map((it) => ({
        id: it.id,
        path: it.path,
        dir: it.dir,
        oldName: it.name,
        newName: it.name,
        changed: false,
        conflict: null,
        invalid: null
      })),
      changedCount: 0,
      conflictCount: 0,
      invalidCount: 0
    }
  }
  const rows: PreviewRow[] = items.map((it, i) => {
    const newName = applyChain(it.name, compiled.chain, i)
    return {
      id: it.id,
      path: it.path,
      dir: it.dir,
      oldName: it.name,
      newName,
      changed: newName !== it.name,
      conflict: null,
      invalid: newName === it.name ? null : validateTargetName(newName, platform)
    }
  })

  const groups = new Map<string, PreviewRow[]>()
  for (const r of rows) {
    if (!r.changed) continue
    const key = r.dir.toLowerCase() + '\u0000' + r.newName.toLowerCase()
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  for (const g of groups.values()) {
    if (g.length > 1) for (const r of g) r.conflict = '重名'
  }

  for (const r of rows) {
    if (!r.changed || r.conflict !== null || r.invalid !== null) continue
    const existing = existingByDir.get(r.dir.toLowerCase())
    if (!existing || !existing.has(r.newName.toLowerCase())) continue
    if (r.newName.toLowerCase() === r.oldName.toLowerCase()) continue
    const vacated = rows.some(
      (o) =>
        o !== r &&
        o.changed &&
        o.conflict === null &&
        o.invalid === null &&
        o.dir.toLowerCase() === r.dir.toLowerCase() &&
        o.oldName.toLowerCase() === r.newName.toLowerCase()
    )
    if (!vacated) r.conflict = '与现存文件冲突'
  }

  return {
    ok: true,
    message: '',
    rows,
    changedCount: rows.filter((r) => r.changed).length,
    conflictCount: rows.filter((r) => r.conflict !== null).length,
    invalidCount: rows.filter((r) => r.invalid !== null).length
  }
}

// ---------- 执行与撤销 ----------

export interface RenameOp {
  id: string
  from: string
  to: string
}

export function planExecution(rows: readonly PreviewRow[]): RenameOp[] {
  return rows
    .filter((r) => r.changed && r.conflict === null && r.invalid === null)
    .map((r) => ({ id: r.id, from: r.path, to: joinPath(r.dir, r.newName) }))
}

export type OrderResult = { ok: true; ordered: RenameOp[] } | { ok: false; message: string }

/**
 * 执行排序：若 A 的目标名正被批内 B 占用（忽略大小写），B 必须先改名腾位。
 * Kahn 拓扑排序；成环（如两文件互换名）报错要求分两步执行。
 */
export function orderOps(ops: readonly RenameOp[]): OrderResult {
  if (ops.length === 0) return { ok: true, ordered: [] }
  const byFrom = new Map<string, RenameOp>()
  for (const op of ops) {
    const k = op.from.toLowerCase()
    if (byFrom.has(k)) return { ok: false, message: `列表中存在重复文件：${op.from}` }
    byFrom.set(k, op)
  }
  const indeg = new Map<string, number>()
  const adjs = new Map<string, string[]>()
  for (const op of ops) {
    indeg.set(op.from.toLowerCase(), 0)
    adjs.set(op.from.toLowerCase(), [])
  }
  for (const op of ops) {
    const occ = byFrom.get(op.to.toLowerCase())
    if (occ === undefined || occ === op) continue // 后者=纯大小写调整，无自依赖
    adjs.get(occ.from.toLowerCase())!.push(op.from.toLowerCase())
    indeg.set(op.from.toLowerCase(), (indeg.get(op.from.toLowerCase()) ?? 0) + 1)
  }
  const queue = [...indeg.entries()].filter(([, d]) => d === 0).map(([k]) => k)
  const ordered: RenameOp[] = []
  while (queue.length > 0) {
    const k = queue.shift()!
    ordered.push(byFrom.get(k)!)
    for (const nxt of adjs.get(k) ?? []) {
      const d = (indeg.get(nxt) ?? 0) - 1
      indeg.set(nxt, d)
      if (d === 0) queue.push(nxt)
    }
  }
  if (ordered.length !== ops.length) return { ok: false, message: '存在循环命名（如两文件互换名），请分两步执行' }
  return { ok: true, ordered }
}

export interface ExecuteFailure {
  op: RenameOp
  message: string
}

export interface ExecuteReport {
  executed: RenameOp[]
  failures: ExecuteFailure[]
}

/** 顺序执行（含腾位排序），单个失败不中断，失败明细逐条带回 */
export async function executeBatch(
  ops: readonly RenameOp[],
  renamer: (from: string, to: string) => Promise<void>
): Promise<ExecuteReport> {
  const order = orderOps(ops)
  if (!order.ok) return { executed: [], failures: ops.map((op) => ({ op, message: order.message })) }
  const executed: RenameOp[] = []
  const failures: ExecuteFailure[] = []
  for (const op of order.ordered) {
    try {
      await renamer(op.from, op.to)
      executed.push(op)
    } catch (err) {
      failures.push({ op, message: err instanceof Error ? err.message : String(err) })
    }
  }
  return { executed, failures }
}

/** 撤销 = 逆序执行 to→from（逆序天然还原腾位链） */
export function buildUndoOps(executed: readonly RenameOp[]): RenameOp[] {
  return executed.slice().reverse().map((op) => ({ id: op.id, from: op.to, to: op.from }))
}

export interface UndoLog {
  executedAt: number
  ops: RenameOp[]
}

export const UNDO_STORAGE_KEY = 'last-undo'
