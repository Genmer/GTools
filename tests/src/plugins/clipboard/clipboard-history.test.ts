import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_RECORDS,
  IMAGE_DATA_BUDGET,
  MAX_MAX_RECORDS,
  MAX_TEXT_CHARS,
  MIN_MAX_RECORDS,
  appendRecord,
  clampMaxRecords,
  enforceCap,
  enforceImageBudget,
  filterRecords,
  parsePersistedState,
  previewOf,
  sameRecordContent,
  toPersisted,
  type ClipboardImageRecord,
  type ClipboardRecord,
  type ClipboardTextRecord
} from '../../../../src/plugins/clipboard/logic/history'
import { dataUrlBytes, fnv1a32, imageFingerprint } from '../../../../src/plugins/clipboard/logic/image-hash'
import manifest from '../../../../src/plugins/clipboard/manifest'
import { validateManifest } from '@sdk/manifest'

let idSeq = 0
const textRec = (over: Partial<ClipboardTextRecord> = {}): ClipboardTextRecord => ({
  id: `t${++idSeq}`,
  kind: 'text',
  ts: 1000,
  text: 'hello',
  ...over
})
const imgRec = (over: Partial<ClipboardImageRecord> = {}): ClipboardImageRecord => ({
  id: `i${++idSeq}`,
  kind: 'image',
  ts: 1000,
  hash: 'h',
  width: 10,
  height: 10,
  bytes: 100,
  dataUrl: 'data:image/png;base64,AAAA',
  ...over
})

describe('history appendRecord 去重', () => {
  it('新内容插到最前（头新尾旧）', () => {
    const old = textRec({ text: 'a' })
    const next = appendRecord([old], textRec({ text: 'b', ts: 2000 }), 2000, 500)
    expect(next.map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['b', 'a'])
  })

  it('与最新一条内容相同只刷新时间戳，不新增条目', () => {
    const newest = textRec({ text: 'a', ts: 1000 })
    const result = appendRecord([newest, textRec({ text: 'b' })], textRec({ text: 'a', ts: 9999 }), 12345, 500)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe(newest.id)
    expect(result[0]?.ts).toBe(12345)
  })

  it('相同内容但不是最新一条时重新记录（A→B→A）', () => {
    const a1 = textRec({ text: 'a' })
    const result = appendRecord([textRec({ text: 'b' }), a1], textRec({ text: 'a', ts: 3000 }), 3000, 500)
    expect(result).toHaveLength(3)
    expect(result[0]?.id).not.toBe(a1.id)
  })

  it('图片按 hash 判同：hash 相同刷时间戳，不同则新记录', () => {
    const bumped = appendRecord([imgRec({ hash: 'x' })], imgRec({ hash: 'x' }), 777, 500)
    expect(bumped).toHaveLength(1)
    expect(bumped[0]?.ts).toBe(777)
    const added = appendRecord([imgRec({ hash: 'x' })], imgRec({ hash: 'y' }), 777, 500)
    expect(added).toHaveLength(2)
  })

  it('文本与图片内容永不判同', () => {
    expect(sameRecordContent(textRec(), imgRec())).toBe(false)
    expect(sameRecordContent(imgRec(), textRec())).toBe(false)
  })
})

describe('history 容量与图片预算', () => {
  it('超容量淘汰最旧；未超返回原引用', () => {
    const base = [textRec({ ts: 3 }), textRec({ ts: 2 }), textRec({ ts: 1 })]
    const capped = enforceCap(base, 2)
    expect(capped).toHaveLength(2)
    expect(capped.map((r) => r.ts)).toEqual([3, 2])
    expect(enforceCap(base, 10)).toBe(base)
    expect(enforceCap(base, Number.NaN)).toBe(base)
  })

  it('maxRecords 非法值收敛到边界（入库点职责）', () => {
    expect(clampMaxRecords(3)).toBe(MIN_MAX_RECORDS)
    expect(clampMaxRecords(99999)).toBe(MAX_MAX_RECORDS)
    expect(clampMaxRecords(Number.NaN)).toBe(DEFAULT_MAX_RECORDS)
    expect(DEFAULT_MAX_RECORDS).toBe(500)
  })

  it('appendRecord 集成容量上限', () => {
    let records: ClipboardRecord[] = []
    for (let i = 0; i < 11; i++) records = appendRecord(records, textRec({ text: `t${i}` }), i, 10)
    expect(records).toHaveLength(10)
    expect(records.map((r) => (r.kind === 'text' ? r.text : ''))).not.toContain('t0')
    expect(records[0]).toMatchObject({ kind: 'text', text: 't10' })
  })

  it('图片预算从最旧开始清 dataUrl，文本不受影响（头新尾旧）', () => {
    const records = [
      imgRec({ dataUrl: 'v'.repeat(50) }),
      textRec({ text: 'keep' }),
      imgRec({ dataUrl: 'u'.repeat(100) })
    ]
    const next = enforceImageBudget(records, 60)
    expect(next[0]).toMatchObject({ kind: 'image', dataUrl: 'v'.repeat(50) })
    expect(next[1]).toMatchObject({ kind: 'text', text: 'keep' })
    expect(next[2]).toMatchObject({ kind: 'image', dataUrl: null })
  })

  it('预算内原样返回；已清空的条目不重复计量', () => {
    const records = [imgRec({ dataUrl: null }), imgRec({ dataUrl: 'x'.repeat(10) })]
    expect(enforceImageBudget(records, 100)).toBe(records)
    const next = enforceImageBudget(records, 0)
    expect(next.every((r) => r.kind !== 'image' || r.dataUrl === null)).toBe(true)
  })

  it('appendRecord 走真实图片预算：超预算的旧图丢 dataUrl 但条目保留', () => {
    const bigA = 'a'.repeat(Math.ceil(IMAGE_DATA_BUDGET / 2) + 10)
    const bigB = 'b'.repeat(Math.ceil(IMAGE_DATA_BUDGET / 2) + 10)
    let records = appendRecord([], imgRec({ hash: 'h1', dataUrl: bigA }), 1, 500)
    records = appendRecord(records, imgRec({ hash: 'h2', dataUrl: bigB }), 2, 500)
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ kind: 'image', hash: 'h2', dataUrl: bigB })
    expect(records[1]).toMatchObject({ kind: 'image', hash: 'h1', dataUrl: null })
  })
})

describe('history 搜索与预览', () => {
  const records = [
    textRec({ text: 'Hello World' }),
    textRec({ text: '中文 内容\n第二行' }),
    imgRec({ width: 800, height: 600, bytes: 12345 })
  ]

  it('空查询返回全部；大小写不敏感；支持中文子串', () => {
    expect(filterRecords(records, '  ')).toHaveLength(3)
    expect(filterRecords(records, 'HELLO')).toHaveLength(1)
    expect(filterRecords(records, '内容')).toHaveLength(1)
    expect(filterRecords(records, '不存在')).toHaveLength(0)
  })

  it('图片按「图片」与尺寸文本匹配', () => {
    expect(filterRecords(records, '图片')).toEqual([records[2]])
    expect(filterRecords(records, '800x600')).toEqual([records[2]])
  })

  it('预览折叠空白并截断，图片给尺寸', () => {
    expect(previewOf(textRec({ text: 'a \n b\tc  d' }))).toBe('a b c d')
    expect(previewOf(textRec({ text: 'x'.repeat(300) }))).toBe(`${'x'.repeat(120)}…`)
    expect(previewOf(imgRec({ width: 12, height: 34 }))).toBe('图片 12×34')
  })
})

describe('history 持久化', () => {
  it('toPersisted → parsePersistedState 往返一致', () => {
    const state = toPersisted(
      { maxRecords: 50, clearOnExit: true },
      [textRec({ text: 'a', ts: 2 }), imgRec({ hash: 'h', ts: 1 })]
    )
    const parsed = parsePersistedState(JSON.parse(JSON.stringify(state)))
    expect(parsed).not.toBeNull()
    expect(parsed?.settings).toEqual({ maxRecords: 50, clearOnExit: true })
    expect(parsed?.records).toHaveLength(2)
    expect(parsed?.records[0]).toMatchObject({ kind: 'text', text: 'a' })
    expect(parsed?.records[1]).toMatchObject({ kind: 'image', hash: 'h' })
  })

  it('非对象 / 版本不符返回 null', () => {
    expect(parsePersistedState(null)).toBeNull()
    expect(parsePersistedState(42)).toBeNull()
    expect(parsePersistedState('x')).toBeNull()
    expect(parsePersistedState({ v: 2, records: [] })).toBeNull()
  })

  it('坏条目丢弃、好条目保留，并按 ts 降序', () => {
    const raw = {
      v: 1,
      settings: { maxRecords: 100, clearOnExit: false },
      records: [
        { id: 'ok1', kind: 'text', ts: 1, text: 'a' },
        { id: 'bad-text', kind: 'text', ts: 2 },
        { id: 'bad-img', kind: 'image', ts: 3, hash: 'h', width: 1 },
        'junk',
        null,
        { id: 'ok2', kind: 'text', ts: 9, text: 'b' }
      ]
    }
    const parsed = parsePersistedState(raw)
    expect(parsed?.records.map((r) => r.id)).toEqual(['ok2', 'ok1'])
  })

  it('加载即收敛：非法 settings 收敛，容量超限截到收敛后的上限', () => {
    const mkRaw = (maxRecords: number): unknown => ({
      v: 1,
      settings: { maxRecords, clearOnExit: 'yes' },
      records: Array.from({ length: 15 }, (_, i) => ({ id: `r${i}`, kind: 'text', ts: i, text: `t${i}` }))
    })
    const tooBig = parsePersistedState(mkRaw(99999))
    expect(tooBig?.settings).toEqual({ maxRecords: MAX_MAX_RECORDS, clearOnExit: false })
    expect(tooBig?.records).toHaveLength(15)
    const tooSmall = parsePersistedState(mkRaw(5))
    expect(tooSmall?.settings).toEqual({ maxRecords: MIN_MAX_RECORDS, clearOnExit: false })
    expect(tooSmall?.records).toHaveLength(MIN_MAX_RECORDS)
  })
})

describe('image-hash', () => {
  it('fnv1a32 命中标准测试向量', () => {
    expect(fnv1a32(new Uint8Array([]))).toBe('811c9dc5')
    expect(fnv1a32(new Uint8Array([0x61]))).toBe('e40c292c')
    expect(fnv1a32(new TextEncoder().encode('foobar'))).toBe('bf9cf968')
  })

  it('dataUrlBytes 与 node Buffer 解码一致，并剥离 data: 前缀', () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`
    expect(Array.from(dataUrlBytes(dataUrl))).toEqual(Array.from(bytes))
  })

  it('指纹：同图同值；宽高/长度/头部不同则不同；4KB 后差异不敏感（设计取舍）', () => {
    const mk = (seed: string, size: number): string => {
      const body = Buffer.concat([Buffer.from(seed), Buffer.alloc(size, 0x7f)])
      return `data:image/png;base64,${body.toString('base64')}`
    }
    // 头 4KB 相同、总长相同、仅尾部不同的两张图
    const sameHead = (tail: number): string => {
      const body = Buffer.concat([Buffer.alloc(4096, 0x7f), Buffer.alloc(16, tail)])
      return `data:image/png;base64,${body.toString('base64')}`
    }
    const img = { width: 100, height: 200, dataUrl: mk('same', 8) }
    expect(imageFingerprint(img)).toEqual(imageFingerprint({ ...img }))
    expect(imageFingerprint(img).hash).not.toBe(imageFingerprint({ ...img, width: 101 }).hash)
    expect(imageFingerprint(img).hash).not.toBe(imageFingerprint({ ...img, dataUrl: mk('other', 8) }).hash)
    expect(imageFingerprint(img).hash).not.toBe(imageFingerprint({ ...img, dataUrl: mk('same', 16) }).hash)
    expect(imageFingerprint({ ...img, dataUrl: sameHead(1) }).hash).toBe(imageFingerprint({ ...img, dataUrl: sameHead(2) }).hash)
    expect(imageFingerprint({ ...img, dataUrl: sameHead(1) }).bytes).toBe(4096 + 16)
  })

  it('MAX_TEXT_CHARS 有值（超大文本由 backend 拦截）', () => {
    expect(MAX_TEXT_CHARS).toBeGreaterThan(0)
  })
})

describe('clipboard-history manifest', () => {
  it('通过协议校验，resident 且声明 backend 与所需权限', () => {
    const errors = validateManifest(manifest, { existingIds: new Set(), activeKeywords: new Map() })
    expect(errors).toEqual([])
    expect(manifest.activation).toBe('resident')
    expect(typeof manifest.backend).toBe('string')
    expect([...manifest.permissions].sort()).toEqual(['clipboard:read', 'clipboard:write', 'storage'])
  })

  it('keyword 与已启用插件冲突时被校验拒绝', () => {
    const errors = validateManifest(manifest, {
      existingIds: new Set(),
      activeKeywords: new Map([['cb', 'other-plugin']])
    })
    expect(errors.some((e) => e.field === 'keywords' && e.message.includes('冲突'))).toBe(true)
  })
})
