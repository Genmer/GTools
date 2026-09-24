// 树视图模型：flatten 只遍历「已展开」的容器，折叠子树既不产出行也不进内存；
// 滚动只按 windowRange 切可视窗口，大 JSON 的成本花在真实可见的行上。

export type TreeKind = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'

/** 树行高（px）：虚拟滚动的行定位与 CSS .node 高度必须同源 */
export const TREE_ROW_HEIGHT = 24

export interface TreeRow {
  /** JSONPath 风格节点 id（$["a"][0]），键名经 JSON.stringify 转义保证唯一 */
  id: string
  keyLabel: string
  kind: TreeKind
  depth: number
  /** 基本类型的展示文本；容器行为 null */
  text: string | null
  /** 容器直接子项数（对象键数 / 数组长度），徽标用 */
  childCount: number
  hasChildren: boolean
  /** 容器折叠时的单行摘要 */
  preview: string | null
  path: (string | number)[]
}

export function nodeId(path: (string | number)[]): string {
  let id = '$'
  for (const seg of path) id += typeof seg === 'number' ? `[${seg}]` : `[${JSON.stringify(seg)}]`
  return id
}

export function kindOf(value: unknown): TreeKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'object') return 'object'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  return 'boolean'
}

const PREVIEW_MAX = 48

export function previewOf(value: unknown, maxLen = PREVIEW_MAX): string {
  const s = JSON.stringify(value) ?? 'null'
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s
}

export function valueAt(root: unknown, path: (string | number)[]): unknown {
  let cur: unknown = root
  for (const seg of path) {
    cur = typeof seg === 'number' ? (cur as unknown[])[seg] : (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** 只走展开路径的扁平化；根行 keyLabel 固定 '$' */
export function flattenTree(root: unknown, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = []
  const emit = (value: unknown, keyLabel: string, path: (string | number)[], depth: number): void => {
    const id = nodeId(path)
    const kind = kindOf(value)
    if (kind === 'array') {
      const arr = value as unknown[]
      rows.push({
        id,
        keyLabel,
        kind,
        depth,
        text: null,
        childCount: arr.length,
        hasChildren: arr.length > 0,
        preview: previewOf(arr),
        path
      })
      if (expanded.has(id)) {
        for (let j = 0; j < arr.length; j++) emit(arr[j], String(j), [...path, j], depth + 1)
      }
      return
    }
    if (kind === 'object') {
      const obj = value as Record<string, unknown>
      const keys = Object.keys(obj)
      rows.push({
        id,
        keyLabel,
        kind,
        depth,
        text: null,
        childCount: keys.length,
        hasChildren: keys.length > 0,
        preview: previewOf(obj),
        path
      })
      if (expanded.has(id)) {
        for (const k of keys) emit(obj[k], k, [...path, k], depth + 1)
      }
      return
    }
    rows.push({
      id,
      keyLabel,
      kind,
      depth,
      text: typeof value === 'string' ? JSON.stringify(value) : String(value),
      childCount: 0,
      hasChildren: false,
      preview: null,
      path
    })
  }
  emit(root, '$', [], 0)
  return rows
}

/** 默认展开：根与其直接容器子项（深度 1），demo/首屏观感 */
export function defaultExpanded(root: unknown): Set<string> {
  const ids = new Set<string>()
  const walk = (value: unknown, path: (string | number)[], depth: number): void => {
    const kind = kindOf(value)
    if (kind !== 'array' && kind !== 'object') return
    ids.add(nodeId(path))
    if (depth >= 1) return
    if (kind === 'array') {
      const arr = value as unknown[]
      for (let j = 0; j < arr.length; j++) walk(arr[j], [...path, j], depth + 1)
    } else {
      for (const k of Object.keys(value as Record<string, unknown>)) walk((value as Record<string, unknown>)[k], [...path, k], depth + 1)
    }
  }
  walk(root, [], 0)
  return ids
}

export interface ExpandAllResult {
  ids: Set<string>
  /** 全树节点总数（含折叠），超上限时不展开 */
  total: number
  overCap: boolean
}

/** 全部展开前先数总节点：超 maxNodes 直接放弃，避免百万级行一下进内存 */
export function collectExpandAll(root: unknown, maxNodes: number): ExpandAllResult {
  let total = 0
  let over = false
  const count = (v: unknown): void => {
    total++
    if (total > maxNodes) {
      over = true
      return
    }
    const kind = kindOf(v)
    if (kind === 'array') (v as unknown[]).forEach(count)
    else if (kind === 'object') Object.values(v as Record<string, unknown>).forEach(count)
  }
  count(root)
  if (over) return { ids: new Set<string>(), total, overCap: true }

  const ids = new Set<string>()
  const walk = (v: unknown, path: (string | number)[]): void => {
    const kind = kindOf(v)
    if (kind !== 'array' && kind !== 'object') return
    ids.add(nodeId(path))
    if (kind === 'array') {
      const arr = v as unknown[]
      for (let j = 0; j < arr.length; j++) walk(arr[j], [...path, j])
    } else {
      for (const k of Object.keys(v as Record<string, unknown>)) walk((v as Record<string, unknown>)[k], [...path, k])
    }
  }
  walk(root, [])
  return { ids, total, overCap: false }
}

/** 虚拟滚动可视窗口：start/end 为行下标区间 [start, end)，含 overscan 缓冲 */
export function windowRange(
  totalRows: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 8
): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight)
  const start = Math.min(totalRows, Math.max(0, first - overscan))
  const end = Math.min(totalRows, first + visible + overscan)
  return { start, end: Math.max(start, end) }
}
