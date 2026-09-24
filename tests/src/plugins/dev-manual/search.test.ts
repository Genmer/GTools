import { describe, expect, it } from 'vitest'
import { ALL_ENTRIES } from '../../../../src/plugins/dev-manual/data'
import { searchEntries } from '../../../../src/plugins/dev-manual/logic/search'

// 数据全集搜出来的期望值均先按实际数据核对（linux cat 的 keyword「查看文件」、mkdir 的「创建目录」等）
describe('dev-manual searchEntries', () => {
  it('空查询返回全部条目且保持数据顺序', () => {
    const all = searchEntries('', ALL_ENTRIES)
    expect(all).toHaveLength(ALL_ENTRIES.length)
    expect(all[0].entry.id).toBe('linux:ls')
  })

  it('名字精确匹配排最前（大小写不敏感）', () => {
    const r = searchEntries('GREP', ALL_ENTRIES)
    expect(r[0].entry.name).toBe('grep')
  })

  it('名字前缀与子串可命中', () => {
    expect(searchEntries('gre', ALL_ENTRIES)[0].entry.name).toBe('grep')
    expect(searchEntries('stash', ALL_ENTRIES).map((x) => x.entry.name)).toContain('git stash')
  })

  it('关键词字面命中且排序先于摘要命中：断点续传 → 206 先于 wget', () => {
    const r = searchEntries('断点续传', ALL_ENTRIES)
    expect(r.map((x) => x.entry.name)).toContain('206')
    expect(r[0].entry.name).toBe('206')
  })

  it('拼音音节对齐：chakan → cat（关键词「查看文件」）', () => {
    const r = searchEntries('chakan', ALL_ENTRIES)
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].entry.name).toBe('cat')
  })

  it('拼音首字母子序列：cjml → mkdir（关键词「创建目录」）', () => {
    const r = searchEntries('cjml', ALL_ENTRIES)
    expect(r.map((x) => x.entry.name)).toContain('mkdir')
  })

  it('摘要子串兜底：愚人节 → 418', () => {
    const r = searchEntries('愚人节', ALL_ENTRIES)
    expect(r.map((x) => x.entry.name)).toContain('418')
  })

  it('跨手册检索：git 前缀的前 10 条全部来自 Git 手册', () => {
    const r = searchEntries('git', ALL_ENTRIES)
    expect(r.length).toBeGreaterThanOrEqual(10)
    for (const x of r.slice(0, 10)) expect(x.entry.manualId).toBe('git')
  })

  it('无匹配返回空数组', () => {
    expect(searchEntries('zzzzqqq', ALL_ENTRIES)).toEqual([])
  })
})
