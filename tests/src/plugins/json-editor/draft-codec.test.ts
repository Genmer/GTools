import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_MAX_SAVE, decodeDraft, encodeDraft } from '../../../../src/plugins/json-editor/logic/draft-codec'

// 300KB 量级的可压缩 JSON（json-editor 的典型负载：重复键名的数组）
function largeJson(lines: number): string {
  const rows: string[] = []
  for (let i = 0; i < lines; i++) {
    rows.push(`{"id":${i},"name":"item-${i}","tags":["alpha","beta"],"description":"重复内容填充以构成大草稿负载"}`)
  }
  return `[\n  ${rows.join(',\n  ')}\n]`
}

describe('draft-codec 小串与边界', () => {
  it('限内小串原样存取（不压缩）', async () => {
    const r = await encodeDraft('{"a":1}')
    expect(r).toEqual({ stored: '{"a":1}', truncated: false })
    await expect(decodeDraft('{"a":1}')).resolves.toBe('{"a":1}')
  })

  it('恰等于 DRAFT_MAX_SAVE 仍原样；超 1 字符即转压缩形态', async () => {
    const atLimit = 'x'.repeat(DRAFT_MAX_SAVE)
    const atR = await encodeDraft(atLimit)
    expect(atR.stored).toBe(atLimit)
    expect(atR.truncated).toBe(false)

    const overR = await encodeDraft(atLimit + 'x')
    expect(overR.stored.startsWith('gz:')).toBe(true)
    expect(overR.stored.length).toBeLessThanOrEqual(DRAFT_MAX_SAVE)
    expect(overR.truncated).toBe(false)
    await expect(decodeDraft(overR.stored)).resolves.toBe(atLimit + 'x')
  })

  // 前缀判定防误吞：正文里出现 'gz:' 字样的小草稿必须按明文原样读回
  it("非 'gz:' 开头的明文（含中缀 gz: 字样）原样返回，不当压缩串解", async () => {
    await expect(decodeDraft('{"note":"内文出现 gz: 字样"}')).resolves.toBe('{"note":"内文出现 gz: 字样"}')
    await expect(decodeDraft('gzip: 不是本协议前缀')).resolves.toBe('gzip: 不是本协议前缀')
  })
})

describe('draft-codec 大草稿压缩往返', () => {
  it('300KB 大串压缩落盘且往返内容等值（体积回到限内）', async () => {
    const big = largeJson(4000)
    expect(big.length).toBeGreaterThan(300 * 1024)
    expect(big.length).toBeGreaterThan(DRAFT_MAX_SAVE)
    const r = await encodeDraft(big)
    expect(r.truncated).toBe(false)
    expect(r.stored.startsWith('gz:')).toBe(true)
    expect(r.stored.length).toBeLessThanOrEqual(DRAFT_MAX_SAVE)
    await expect(decodeDraft(r.stored)).resolves.toBe(big)
  })
})

describe('draft-codec 老环境与损坏草稿', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('无 CompressionStream 的老环境：超限截断并标记 truncated', async () => {
    vi.stubGlobal('CompressionStream', undefined)
    const big = largeJson(4000)
    const r = await encodeDraft(big)
    expect(r.truncated).toBe(true)
    expect(r.stored.startsWith('gz:')).toBe(false)
    expect(r.stored.length).toBe(DRAFT_MAX_SAVE)
    // 截断串是明文前缀，读取按原样返回
    await expect(decodeDraft(r.stored)).resolves.toBe(r.stored)
  })

  it("'gz:' 开头但解不开的串回退原文，不清空（明文恰以 gz: 开头不被误毁）", async () => {
    await expect(decodeDraft('gz:@@@@非法!!!!')).resolves.toBe('gz:@@@@非法!!!!')
    await expect(decodeDraft(`gz:${btoa('hello')}`)).resolves.toBe(`gz:${btoa('hello')}`)
  })

  it('非字符串载荷一律当无草稿', async () => {
    await expect(decodeDraft(null)).resolves.toBe('')
    await expect(decodeDraft(undefined)).resolves.toBe('')
    await expect(decodeDraft(42)).resolves.toBe('')
    await expect(decodeDraft('')).resolves.toBe('')
  })
})
