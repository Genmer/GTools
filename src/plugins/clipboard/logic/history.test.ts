// 剪贴板历史纯逻辑单测（与 backend/渲染层共用同一份代码，禁 node API）。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_RECORDS,
  DEFAULT_SETTINGS,
  IMAGE_DATA_BUDGET,
  MAX_MAX_RECORDS,
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
} from './history'

let seq = 0
const textRec = (over: Partial<ClipboardTextRecord> = {}): ClipboardTextRecord => ({
  id: `t${++seq}`,
  kind: 'text',
  ts: 100,
  text: 'x',
  ...over
})
const imgRec = (over: Partial<ClipboardImageRecord> = {}): ClipboardImageRecord => ({
  id: `i${++seq}`,
  kind: 'image',
  ts: 100,
  hash: 'h',
  width: 8,
  height: 8,
  bytes: 8,
  dataUrl: 'data:image/png;base64,AAAA',
  ...over
})

describe('clampMaxRecords 收敛规则', () => {
  it('四舍五入后再夹到 [10, 2000]；非有限数回落默认值', () => {
    expect(clampMaxRecords(10.4)).toBe(10)
    expect(clampMaxRecords(10.5)).toBe(11)
    expect(clampMaxRecords(-100)).toBe(MIN_MAX_RECORDS)
    expect(clampMaxRecords(Number.POSITIVE_INFINITY)).toBe(DEFAULT_MAX_RECORDS)
    expect(clampMaxRecords(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_MAX_RECORDS)
    expect(clampMaxRecords(Number.NaN)).toBe(DEFAULT_MAX_RECORDS)
  })

  it('默认常量关系成立', () => {
    expect(MIN_MAX_RECORDS).toBeLessThan(DEFAULT_MAX_RECORDS)
    expect(DEFAULT_MAX_RECORDS).toBeLessThan(MAX_MAX_RECORDS)
    expect(DEFAULT_SETTINGS).toEqual({ maxRecords: DEFAULT_MAX_RECORDS, clearOnExit: false })
  })
})

describe('enforceCap / sameRecordContent', () => {
  it('小数容量向下取整；0/负数/NaN 返回原引用不裁剪', () => {
    const records = [textRec(), textRec(), textRec()]
    expect(enforceCap(records, 2.9)).toHaveLength(2)
    expect(enforceCap(records, 0)).toBe(records)
    expect(enforceCap(records, -3)).toBe(records)
  })

  it('sameRecordContent：文本比值、图片比 hash', () => {
    expect(sameRecordContent(textRec({ text: 'a' }), textRec({ text: 'a' }))).toBe(true)
    expect(sameRecordContent(textRec({ text: 'a' }), textRec({ text: 'b' }))).toBe(false)
    expect(sameRecordContent(imgRec({ hash: 'x' }), imgRec({ hash: 'x', dataUrl: null }))).toBe(true)
    expect(sameRecordContent(imgRec({ hash: 'x' }), imgRec({ hash: 'y' }))).toBe(false)
  })

  it('appendRecord 去重只看最新一条且刷新用 now 参数', () => {
    const old = textRec({ id: 'keep', text: 'a', ts: 1 })
    const next = appendRecord([old], textRec({ text: 'a', ts: 99999 }), 4242, 500)
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: 'keep', ts: 4242 })
  })

  it('appendRecord 后图片预算内不丢 dataUrl（引用不变判据）', () => {
    const small = imgRec({ dataUrl: 'd'.repeat(100) })
    const next = appendRecord([small], textRec({ text: 't' }), 200, 500)
    expect(next[0]).toMatchObject({ kind: 'text', text: 't' })
    expect(next[1]).toMatchObject({ kind: 'image', dataUrl: 'd'.repeat(100) })
  })
})

describe('enforceImageBudget 预算行为', () => {
  it('恰好等于预算不清；多轮已清空的不再计量', () => {
    const records = [imgRec({ dataUrl: 'a'.repeat(50) }), imgRec({ dataUrl: null }), textRec()]
    expect(enforceImageBudget(records, 50)).toBe(records)
  })

  it('预算收紧时从最旧图片逐个清到落入预算为止', () => {
    const records = [imgRec({ dataUrl: 'a'.repeat(30) }), imgRec({ dataUrl: 'b'.repeat(30) }), imgRec({ dataUrl: 'c'.repeat(30) })]
    const next = enforceImageBudget(records, 45)
    expect(next[0]).toMatchObject({ dataUrl: 'a'.repeat(30) })
    expect(next[1]).toMatchObject({ dataUrl: null })
    expect(next[2]).toMatchObject({ dataUrl: null })
  })

  it('IMAGE_DATA_BUDGET 为正且 appendRecord 实际生效', () => {
    expect(IMAGE_DATA_BUDGET).toBeGreaterThan(0)
    let records = appendRecord([], imgRec({ dataUrl: 'x'.repeat(IMAGE_DATA_BUDGET + 1) }), 1, 500)
    expect(records[0]).toMatchObject({ kind: 'image', dataUrl: null })
  })
})

describe('filterRecords 搜索', () => {
  const records = [
    textRec({ text: 'Git commit --amend' }),
    textRec({ text: '图片说明文字' }),
    imgRec({ width: 640, height: 480, bytes: 98765 })
  ]

  it('大小写不敏感与中间词匹配', () => {
    expect(filterRecords(records, 'AMEND')).toHaveLength(1)
    expect(filterRecords(records, 'commit')).toHaveLength(1)
    expect(filterRecords(records, '说明')).toHaveLength(1)
  })

  it('图片 haystack 覆盖 image/尺寸/字节数（任意子串）', () => {
    expect(filterRecords(records, 'image')).toEqual([records[2]])
    expect(filterRecords(records, '640x480')).toEqual([records[2]])
    expect(filterRecords(records, '98765')).toEqual([records[2]])
    expect(filterRecords(records, '640x')).toEqual([records[2]])
  })

  it('空串与纯空白查询返回全部', () => {
    expect(filterRecords(records, '')).toHaveLength(3)
    expect(filterRecords(records, ' \t ')).toHaveLength(3)
  })
})

describe('previewOf 预览', () => {
  it('自定义截断长度与省略号', () => {
    expect(previewOf(textRec({ text: 'abcdefghij' }), 5)).toBe('abcde…')
    expect(previewOf(textRec({ text: 'abc' }), 5)).toBe('abc')
  })

  it('空白折叠先于截断；纯空白文本预览为空串', () => {
    expect(previewOf(textRec({ text: ' a\r\n b ' }), 10)).toBe('a b')
    expect(previewOf(textRec({ text: '   \n\t ' }))).toBe('')
  })

  it('图片预览用全角 ×', () => {
    expect(previewOf(imgRec({ width: 3, height: 45 }))).toBe('图片 3×45')
  })
})

describe('持久化解析与独立性', () => {
  it('toPersisted 是深拷贝：后续改原件不影响落盘快照', () => {
    const rec = textRec({ text: 'a' })
    const settings = { maxRecords: 20, clearOnExit: false }
    const persisted = toPersisted(settings, [rec])
    rec.text = 'changed'
    settings.maxRecords = 999
    expect(persisted.records[0]).toMatchObject({ kind: 'text', text: 'a' })
    expect(persisted.settings.maxRecords).toBe(20)
  })

  it('image 条目 dataUrl 非字符串落为 null；缺宽度整条丢弃', () => {
    const parsed = parsePersistedState({
      v: 1,
      settings: {},
      records: [
        { id: 'i1', kind: 'image', ts: 5, hash: 'h', width: 1, height: 1, bytes: 1, dataUrl: 123 },
        { id: 'i2', kind: 'image', ts: 4, hash: 'h', height: 1, bytes: 1, dataUrl: 'd' },
        { id: 't1', kind: 'text', ts: 3, text: 'ok' }
      ]
    })
    expect(parsed?.records).toHaveLength(2)
    expect(parsed?.records[0]).toMatchObject({ id: 'i1', dataUrl: null }) // ts 5 > 3 排前
    expect(parsed?.records[1]).toMatchObject({ id: 't1' })
  })

  it('records 非数组按空处理；ts 非有限数丢弃；settings 缺省回落默认', () => {
    const parsed = parsePersistedState({ v: 1, settings: undefined, records: 'nope' })
    expect(parsed?.records).toEqual([])
    expect(parsed?.settings).toEqual({ maxRecords: DEFAULT_MAX_RECORDS, clearOnExit: false })

    const badTs = parsePersistedState({ v: 1, records: [{ id: 'x', kind: 'text', ts: Number.NaN, text: 'a' }] })
    expect(badTs?.records).toEqual([])
  })

  it('顶层非对象/版本不符返回 null', () => {
    expect(parsePersistedState(undefined)).toBeNull()
    expect(parsePersistedState([])).toBeNull()
    expect(parsePersistedState({ v: '1', records: [] })).toBeNull()
  })

  it('加载时按 ts 降序重排（存储乱序也能恢复头新尾旧）', () => {
    const parsed = parsePersistedState({
      v: 1,
      records: [
        { id: 'old', kind: 'text', ts: 1, text: 'a' },
        { id: 'new', kind: 'text', ts: 9, text: 'b' },
        { id: 'mid', kind: 'text', ts: 5, text: 'c' }
      ]
    })
    expect(parsed?.records.map((r) => r.id)).toEqual(['new', 'mid', 'old'])
  })
})

describe('记录数组的类型收窄', () => {
  it('ClipboardRecord 联合类型按 kind 判别（编译期 + 运行期一致）', () => {
    const all: ClipboardRecord[] = [textRec(), imgRec()]
    expect(all.filter((r) => r.kind === 'text')).toHaveLength(1)
    expect(all.filter((r) => r.kind === 'image')).toHaveLength(1)
  })
})
