import { describe, expect, it } from 'vitest'
import {
  LARGE_FILE_BYTES,
  baseName,
  fileNameOf,
  formatBytes,
  isLargeFile,
  joinPath,
  normalizeAngle,
  parsePageRanges,
  parseRangeGroups
} from '../../../../src/plugins/pdf-tools/logic/pages'

describe('parsePageRanges', () => {
  it('基础语法：单页、区间、逗号混排', () => {
    expect(parsePageRanges('3', 10)).toEqual({ ok: true, data: [3] })
    expect(parsePageRanges('1-3', 10)).toEqual({ ok: true, data: [1, 2, 3] })
    expect(parsePageRanges('1-3,5', 10)).toEqual({ ok: true, data: [1, 2, 3, 5] })
  })

  it('空白容忍：空格与破折号两侧空格', () => {
    expect(parsePageRanges(' 2 , 4 ', 10)).toEqual({ ok: true, data: [2, 4] })
    expect(parsePageRanges('1 - 3, 5', 10)).toEqual({ ok: true, data: [1, 2, 3, 5] })
  })

  it('去重并升序输出', () => {
    expect(parsePageRanges('5,1-3,2', 10)).toEqual({ ok: true, data: [1, 2, 3, 5] })
  })

  it('空输入报可读错误', () => {
    const r = parsePageRanges('   ', 10)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('页码范围')
  })

  it('非法 token、倒置区间、越界、0 起始都拒绝', () => {
    expect(parsePageRanges('abc', 10).ok).toBe(false)
    expect(parsePageRanges('1,3-1', 10).ok).toBe(false)
    expect(parsePageRanges('11', 10).ok).toBe(false)
    expect(parsePageRanges('1-11', 10).ok).toBe(false)
    expect(parsePageRanges('0', 10).ok).toBe(false)
    expect(parsePageRanges('1-3,x', 10).ok).toBe(false)
  })

  it('页数为 0（异常防御）时任何页码都越界', () => {
    expect(parsePageRanges('1', 0).ok).toBe(false)
  })

  it('单位区间与跨 token 重复页合并', () => {
    expect(parsePageRanges('1-1', 5)).toEqual({ ok: true, data: [1] })
    expect(parsePageRanges('3,3-3', 5)).toEqual({ ok: true, data: [3] })
    expect(parsePageRanges('1-2,2-3', 5)).toEqual({ ok: true, data: [1, 2, 3] })
  })
})

describe('parseRangeGroups', () => {
  it('按逗号分组，每组保留输入顺序的页码', () => {
    expect(parseRangeGroups('1-3,5', 10)).toEqual({
      ok: true,
      data: [
        { label: '1-3', pages: [1, 2, 3] },
        { label: '5', pages: [5] }
      ]
    })
  })

  it('label 去掉所有空白便于拼文件名', () => {
    expect(parseRangeGroups('1 - 3 , 8-10', 12)).toEqual({
      ok: true,
      data: [
        { label: '1-3', pages: [1, 2, 3] },
        { label: '8-10', pages: [8, 9, 10] }
      ]
    })
  })

  it('组间重叠允许（用户自担重复页），非法输入整体拒绝', () => {
    expect(parseRangeGroups('1-3,2', 10).ok).toBe(true)
    const bad = parseRangeGroups('1-3,,5', 10)
    expect(bad.ok).toBe(false)
    expect(parseRangeGroups('1-99', 10).ok).toBe(false)
  })

  it('乱序输入组序按输入保留（组内页码仍升序）', () => {
    expect(parseRangeGroups('5,1-3', 10)).toEqual({
      ok: true,
      data: [
        { label: '5', pages: [5] },
        { label: '1-3', pages: [1, 2, 3] }
      ]
    })
  })
})

describe('文件与角度工具', () => {
  it('formatBytes 三档', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(2_411_520)).toBe('2.3 MB')
  })

  it('formatBytes 非法与非正值回 0 B，KB 档下限 1', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(1500)).toBe('1 KB')
  })

  it('isLargeFile 以 20MB 为界（> 判大）', () => {
    expect(isLargeFile(LARGE_FILE_BYTES)).toBe(false)
    expect(isLargeFile(LARGE_FILE_BYTES + 1)).toBe(true)
  })

  it('fileNameOf / baseName 兼容 / 与 \\，无名回退原名', () => {
    expect(fileNameOf('/a/b/c.pdf')).toBe('c.pdf')
    expect(fileNameOf('C:\\x\\y.png')).toBe('y.png')
    expect(fileNameOf('c.pdf')).toBe('c.pdf')
    expect(baseName('/a/b/产品说明书.pdf')).toBe('产品说明书')
    expect(baseName('C:\\x\\y.tar.gz')).toBe('y.tar')
    expect(baseName('.hidden')).toBe('.hidden')
    expect(baseName('a.')).toBe('a')
  })

  it('joinPath 处理尾分隔符', () => {
    expect(joinPath('/tmp', 'a.pdf')).toBe('/tmp/a.pdf')
    expect(joinPath('/tmp/', 'a.pdf')).toBe('/tmp/a.pdf')
    expect(joinPath('C:\\tmp', 'a.pdf')).toBe('C:\\tmp/a.pdf')
  })

  it('normalizeAngle 归一到 [0,360)', () => {
    expect(normalizeAngle(90)).toBe(90)
    expect(normalizeAngle(-90)).toBe(270)
    expect(normalizeAngle(360)).toBe(0)
    expect(normalizeAngle(450)).toBe(90)
    expect(normalizeAngle(-360)).toBe(0)
  })
})
