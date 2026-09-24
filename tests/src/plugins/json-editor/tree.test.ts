import { describe, expect, it } from 'vitest'
import { parseJson } from '../../../../src/plugins/json-editor/logic/json'
import {
  TREE_ROW_HEIGHT,
  collectExpandAll,
  defaultExpanded,
  flattenTree,
  kindOf,
  nodeId,
  previewOf,
  valueAt,
  windowRange
} from '../../../../src/plugins/json-editor/logic/tree'
import { SAMPLE_JSON } from '../../../../src/plugins/json-editor/logic/sample'

const sample = JSON.parse(SAMPLE_JSON)

describe('nodeId', () => {
  it('路径拼接为 JSONPath 风格且键名转义后仍唯一', () => {
    expect(nodeId([])).toBe('$')
    expect(nodeId(['a', 'b'])).toBe('$["a"]["b"]')
    expect(nodeId(['list', 2])).toBe('$["list"][2]')
    const ids = new Set(['a.b', 'a', 'a"b', 'a\\b'].map((k) => nodeId([k])))
    expect(ids.size).toBe(4)
  })
})

describe('previewOf', () => {
  it('超长摘要截断加省略号', () => {
    expect(previewOf(1)).toBe('1')
    const long = { k: 'x'.repeat(100) }
    expect(previewOf(long).endsWith('…')).toBe(true)
    expect(previewOf(long).length).toBe(49)
  })
})

describe('kindOf 六类分派', () => {
  it('null 先于 object 判定，数组与普通对象区分', () => {
    expect(kindOf(null)).toBe('null')
    expect(kindOf([])).toBe('array')
    expect(kindOf([1, 2])).toBe('array')
    expect(kindOf({})).toBe('object')
    expect(kindOf('s')).toBe('string')
    expect(kindOf(1.5)).toBe('number')
    expect(kindOf(false)).toBe('boolean')
  })
})

describe('flattenTree', () => {
  it('折叠时根只有一行，带子项数徽标与摘要', () => {
    const rows = flattenTree(sample, new Set<string>())
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: '$', keyLabel: '$', kind: 'object', depth: 0, childCount: 7, hasChildren: true })
    expect(rows[0].preview).not.toBeNull()
  })

  it('展开后按序产出子行，深度与 path 正确', () => {
    const rows = flattenTree(sample, new Set(['$']))
    expect(rows).toHaveLength(8)
    expect(rows[1]).toMatchObject({ keyLabel: 'name', kind: 'string', depth: 1, text: '"GTools 发布清单"' })
    expect(rows[4]).toMatchObject({ keyLabel: 'tags', kind: 'array', childCount: 3, depth: 1 })
    const deep = flattenTree(sample, new Set(['$', nodeId(['tags'])]))
    expect(deep).toHaveLength(11)
    expect(deep[5]).toMatchObject({ keyLabel: '0', depth: 2, path: ['tags', 0], text: '"launcher"' })
  })

  it('只展开指定子树：折叠的分支不产出行', () => {
    const rows = flattenTree(sample, new Set(['$', nodeId(['stats'])]))
    const statsRow = rows.find((r) => r.keyLabel === 'stats')
    expect(statsRow).toMatchObject({ kind: 'object', childCount: 4 })
    expect(rows.some((r) => r.keyLabel === 'rating')).toBe(true)
    expect(rows.some((r) => r.keyLabel === 'changelog')).toBe(true) // 行本身在
    expect(rows.some((r) => r.keyLabel === '0' && r.depth === 2)).toBe(false) // 其子项不展开
  })

  it('大数组折叠时 O(1) 行数，展开才是 O(n)', () => {
    const big = Array.from({ length: 200000 }, (_, i) => i)
    expect(flattenTree(big, new Set<string>())).toHaveLength(1)
    expect(flattenTree(big, new Set(['$']))).toHaveLength(200001)
  })

  it('>1MB 输入端到端：可解析，折叠子树不产行，可视窗口只有几十行', () => {
    const items = Array.from({ length: 24000 }, (_, i) => ({ id: i, name: `item-${i}`, tags: ['alpha', 'beta'] }))
    const text = JSON.stringify(items)
    expect(text.length).toBeGreaterThan(1024 * 1024)
    const r = parseJson(text)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const rows = flattenTree(r.value, new Set(['$']))
      expect(rows).toHaveLength(items.length + 1)
      expect(rows.every((row) => row.depth <= 1)).toBe(true)
      const w = windowRange(rows.length, 240 * TREE_ROW_HEIGHT, 600, TREE_ROW_HEIGHT)
      expect(w.end - w.start).toBeLessThanOrEqual(Math.ceil(600 / TREE_ROW_HEIGHT) + 16)
    }
  })
})

describe('defaultExpanded', () => {
  it('默认展开根与第一层容器，叶子与更深层不进集合', () => {
    const ids = defaultExpanded(sample)
    expect(ids.has('$')).toBe(true)
    expect(ids.has(nodeId(['stats']))).toBe(true)
    expect(ids.has(nodeId(['changelog']))).toBe(true)
    expect(ids.has(nodeId(['name']))).toBe(false)
    expect(ids.has(nodeId(['changelog', 0]))).toBe(false)
    expect([...ids].every((id) => flattenTree(sample, ids).some((r) => r.id === id))).toBe(true)
  })
})

describe('valueAt', () => {
  it('按 path 取回节点值', () => {
    expect(valueAt(sample, ['name'])).toBe('GTools 发布清单')
    expect(valueAt(sample, ['changelog', 0, 'date'])).toBe('2026-09-01')
    expect(valueAt(sample, ['stats', 'openIssues'])).toBeNull()
    expect(valueAt(sample, [])).toBe(sample)
  })
})

describe('collectExpandAll', () => {
  it('未超上限时收集全部容器 id', () => {
    const { ids, total, overCap } = collectExpandAll(sample, 50000)
    expect(overCap).toBe(false)
    expect(total).toBeGreaterThan(10)
    expect(ids.has('$')).toBe(true)
    expect(ids.has(nodeId(['changelog', 0]))).toBe(true)
  })

  it('超过上限拒绝展开并回报总数', () => {
    const big = Array.from({ length: 60000 }, (_, i) => i)
    const { ids, total, overCap } = collectExpandAll(big, 50000)
    expect(overCap).toBe(true)
    expect(total).toBe(60001)
    expect(ids.size).toBe(0)
  })
})

describe('windowRange', () => {
  it('常规窗口含 overscan 缓冲', () => {
    expect(windowRange(1000, 0, 480, TREE_ROW_HEIGHT)).toEqual({ start: 0, end: 28 })
    expect(windowRange(1000, 24 * 100, 480, TREE_ROW_HEIGHT)).toEqual({ start: 92, end: 128 })
  })

  it('边界：滚过头/零视口/空列表钳制', () => {
    expect(windowRange(10, 99999, 480, TREE_ROW_HEIGHT)).toEqual({ start: 10, end: 10 })
    expect(windowRange(0, 100, 480, TREE_ROW_HEIGHT)).toEqual({ start: 0, end: 0 })
    expect(windowRange(100, -5, 0, TREE_ROW_HEIGHT)).toEqual({ start: 0, end: 8 })
  })
})
