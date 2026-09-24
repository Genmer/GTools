import { describe, expect, it } from 'vitest'
import {
  DEMO_APPS,
  DEMO_PINNED_IDS,
  DEMO_RECENT_COUNT,
  parseAppsSnapshot,
  parsePinnedIds,
  reorderApps,
  tileColorClass,
  type NativeAppItem
} from '../src/renderer/src/shell/app-grid'

// ---------- 快照校验：宿主 apps:list 返回值进渲染层的第一道关 ----------

describe('parseAppsSnapshot', () => {
  it('整体坏形状返回 null（触发错误提示与兜底网格）', () => {
    expect(parseAppsSnapshot(null)).toBeNull()
    expect(parseAppsSnapshot('x')).toBeNull()
    expect(parseAppsSnapshot(42)).toBeNull()
    expect(parseAppsSnapshot([])).toBeNull()
    expect(parseAppsSnapshot({ apps: 'no' })).toBeNull()
    expect(parseAppsSnapshot({ apps: {} })).toBeNull()
    expect(parseAppsSnapshot({ scannedAt: 1 })).toBeNull() // 缺 apps
  })

  it('单条坏数据跳过，好数据完整保留；空串可选字段归一为 undefined', () => {
    const snap = parseAppsSnapshot({
      apps: [
        { id: 'a', name: 'A', path: '/Applications/A.app', bundleId: 'com.a', iconPath: '/i.icns', icon: 'data:image/png;base64,QQ==' },
        3,
        null,
        { id: '', name: 'X', path: '/x.app' },
        { id: 'b', name: '', path: '/b.app' },
        { id: 'c', name: 'C', path: 1 },
        { id: 'd', name: 'D', path: '/d.app', bundleId: '', iconPath: '', icon: 'https://cdn/x.png', extra: '多余字段丢弃' }
      ],
      scannedAt: 123,
      fromCache: true,
      pinned: ['a']
    })!
    expect(snap.scannedAt).toBe(123)
    expect(snap.fromCache).toBe(true)
    expect(snap.pinned).toEqual(['a'])
    expect(snap.apps).toEqual([
      { id: 'a', name: 'A', path: '/Applications/A.app', bundleId: 'com.a', iconPath: '/i.icns', icon: 'data:image/png;base64,QQ==' },
      { id: 'd', name: 'D', path: '/d.app', bundleId: undefined, iconPath: undefined, icon: undefined }
    ])
  })

  it('icon 只认 data:image 前缀；scannedAt/fromCache 宽松归一', () => {
    const snap = parseAppsSnapshot({
      apps: [
        { id: 'a', name: 'A', path: '/a.app', icon: 'data:image/png;base64,x' },
        { id: 'b', name: 'B', path: '/b.app', icon: 'data:text/plain,x' },
        { id: 'c', name: 'C', path: '/c.app', icon: 9 }
      ],
      scannedAt: 'now',
      fromCache: 'true',
      pinned: 'nope'
    })!
    expect(snap.apps[0].icon).toBe('data:image/png;base64,x')
    expect(snap.apps[1].icon).toBeUndefined()
    expect(snap.apps[2].icon).toBeUndefined()
    expect(snap.scannedAt).toBe(0)
    expect(snap.fromCache).toBe(false)
    expect(snap.pinned).toEqual([])
  })

  it('空 apps 是合法快照（触发旧网格兜底而非报错）', () => {
    const snap = parseAppsSnapshot({ apps: [], scannedAt: 1, fromCache: false, pinned: [] })!
    expect(snap.apps).toEqual([])
    expect(snap.pinned).toEqual([])
  })
})

// ---------- 置顶 id 解析（apps:pin/unpin 返回值与快照 pinned 共用） ----------

describe('parsePinnedIds', () => {
  it('非数组返回 null', () => {
    expect(parsePinnedIds(undefined)).toBeNull()
    expect(parsePinnedIds(null)).toBeNull()
    expect(parsePinnedIds('a')).toBeNull()
    expect(parsePinnedIds({})).toBeNull()
  })

  it('过滤非字符串与空串，保留顺序', () => {
    expect(parsePinnedIds(['a', '', 2, null, undefined, 'b'])).toEqual(['a', 'b'])
    expect(parsePinnedIds([])).toEqual([])
  })
})

// ---------- pin/unpin 后的本地重排 ----------

describe('reorderApps', () => {
  // 乱序 fixture：证明非置顶只保持原相对序，不按名称/字母重排
  const apps = [
    { id: 'm', name: 'MM' },
    { id: 'z', name: 'ZZ' },
    { id: 'a', name: 'AA' },
    { id: 'q', name: 'QQ' }
  ]

  it('置顶按置顶顺序排最前，其余保持原相对序', () => {
    expect(reorderApps(apps, ['a', 'z']).map((x) => x.id)).toEqual(['a', 'z', 'm', 'q'])
  })

  it('未知置顶 id 忽略；空置顶等于原序', () => {
    expect(reorderApps(apps, ['ghost', 'q']).map((x) => x.id)).toEqual(['q', 'm', 'z', 'a'])
    expect(reorderApps(apps, []).map((x) => x.id)).toEqual(['m', 'z', 'a', 'q'])
  })

  it('不修改入参数组（返回新数组）', () => {
    const orig = apps.map((x) => ({ ...x }))
    const out = reorderApps(apps, ['q'])
    expect(out).not.toBe(apps)
    expect(apps).toEqual(orig)
    expect(out).toHaveLength(apps.length)
  })
})

// ---------- 字母块配色 ----------

describe('tileColorClass', () => {
  it('稳定且落在六色集合内', () => {
    for (const seed of ['com.a.B', '微信', 'x']) {
      const c1 = tileColorClass(seed)
      expect(c1).toBe(tileColorClass(seed))
      expect(c1).toMatch(/^t-(blue|green|amber|rose|violet|teal)$/)
    }
  })

  it('空 seed 归位首色；不同 seed 覆盖多个色（演示数据 12 个 id 实测 ≥3 色）', () => {
    expect(tileColorClass('')).toBe('t-blue')
    const colors = new Set(DEMO_APPS.map((a) => tileColorClass(a.id)))
    expect(colors.size).toBeGreaterThanOrEqual(3)
  })
})

// ---------- demo 示例数据不变量（#demo=1 截图态依赖） ----------

describe('DEMO_* 不变量', () => {
  it('DEMO_APPS id 唯一、必填字段完整', () => {
    const ids = DEMO_APPS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of DEMO_APPS as NativeAppItem[]) {
      expect(typeof a.id).toBe('string')
      expect(a.id).not.toBe('')
      expect(typeof a.name).toBe('string')
      expect(a.name).not.toBe('')
      expect(typeof a.path).toBe('string')
      expect(a.path).not.toBe('')
    }
  })

  it('DEMO_PINNED_IDS 唯一且都在 DEMO_APPS 中；DEMO_RECENT_COUNT 不超过应用数', () => {
    expect(new Set(DEMO_PINNED_IDS).size).toBe(DEMO_PINNED_IDS.length)
    for (const id of DEMO_PINNED_IDS) expect(DEMO_APPS.some((a) => a.id === id)).toBe(true)
    expect(DEMO_RECENT_COUNT).toBeLessThanOrEqual(DEMO_APPS.length)
  })

  it('demo 预置置顶重排：置顶两位到最前，其余保持原相对序且无丢失', () => {
    const ordered = reorderApps(DEMO_APPS, DEMO_PINNED_IDS)
    expect(ordered.slice(0, DEMO_PINNED_IDS.length).map((a) => a.id)).toEqual(DEMO_PINNED_IDS)
    expect(ordered.slice(DEMO_PINNED_IDS.length).map((a) => a.id)).toEqual(
      DEMO_APPS.filter((a) => !DEMO_PINNED_IDS.includes(a.id)).map((a) => a.id)
    )
  })
})
