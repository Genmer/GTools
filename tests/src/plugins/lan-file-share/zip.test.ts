import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { buildZip, crc32, dosDateTime, type ZipInput } from '../../../../src/plugins/lan-file-share/backend/zip'
import { readZip } from './zip-reader'

describe('crc32 / dosDateTime', () => {
  it('CRC-32 标准测试向量', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
    expect(crc32(Buffer.alloc(0))).toBe(0)
  })
  it('DOS 时间编码，1980 前钳位', () => {
    expect(dosDateTime(new Date(2026, 8, 24, 23, 59, 58))).toEqual({ time: (23 << 11) | (59 << 5) | 29, date: ((2026 - 1980) << 9) | (9 << 5) | 24 })
    expect(dosDateTime(new Date(1970, 0, 1, 0, 0, 0)).date).toBe((0 << 9) | (1 << 5) | 1)
  })
})

describe('buildZip', () => {
  const text = Buffer.from('hello 局域网共享', 'utf8')
  const binary = Buffer.from([0, 1, 2, 250, 251, 255, 10, 13, 45, 45, 98, 111])

  it('deflate 条目可解压还原（含中文文件名）', () => {
    const zip = buildZip(
      [
        { path: '文档/hello.txt', data: text },
        { path: 'bin.dat', data: binary }
      ],
      { deflate: (b) => deflateRawSync(b), now: new Date(2026, 8, 24, 10, 0, 0) }
    )
    const files = readZip(zip)
    expect(files.get('文档/hello.txt')?.data.equals(text)).toBe(true)
    expect(files.get('bin.dat')?.data.equals(binary)).toBe(true)
  })

  it('不可压缩数据自动退回 STORE（method 0）也能还原', () => {
    const rand = Buffer.from(Array.from({ length: 1024 }, (_, i) => (i * 7 + 13) % 256))
    const zip = buildZip([{ path: 'rand.bin', data: rand }], { deflate: (b) => deflateRawSync(b) })
    const files = readZip(zip)
    expect(files.get('rand.bin')?.data.equals(rand)).toBe(true)
  })

  it('目录条目：路径以 / 结尾、内容为空、目录属性位', () => {
    const entries: ZipInput[] = [
      { path: 'dir/', data: Buffer.alloc(0) },
      { path: 'dir/a.txt', data: text }
    ]
    const zip = buildZip(entries, { deflate: (b) => deflateRawSync(b) })
    const files = readZip(zip)
    expect(files.get('dir/')?.isDir).toBe(true)
    expect(files.get('dir/')?.data.length).toBe(0)
    expect(files.get('dir/a.txt')?.isDir).toBe(false)
  })

  it('无 deflate 注入时全部 STORE，条目数为 0 时产出合法空 zip', () => {
    const zip = buildZip([{ path: 'a.txt', data: text }])
    expect(readZip(zip).get('a.txt')?.data.equals(text)).toBe(true)
    expect(readZip(buildZip([])).size).toBe(0)
  })
})
