/** 测试用极简 zip 读取器：EOCD → 中央目录 → 本地区块解出内容（与 zip.ts 的写入互为校验） */
import { expect } from 'vitest'
import { inflateRawSync } from 'node:zlib'
import { crc32 } from '../../../../src/plugins/lan-file-share/backend/zip'

export function readZip(buf: Buffer): Map<string, { isDir: boolean; data: Buffer }> {
  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 66_000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  expect(eocd).toBeGreaterThanOrEqual(0)
  const count = buf.readUInt16LE(eocd + 10)
  let off = buf.readUInt32LE(eocd + 16)

  const out = new Map<string, { isDir: boolean; data: Buffer }>()
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(off)).toBe(0x02014b50)
    const method = buf.readUInt16LE(off + 10)
    const crc = buf.readUInt32LE(off + 16)
    const compSize = buf.readUInt32LE(off + 20)
    const uncompSize = buf.readUInt32LE(off + 24)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const isDir = (buf.readUInt32LE(off + 38) & 0x10) !== 0
    const lfhOff = buf.readUInt32LE(off + 42)
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8')

    expect(buf.readUInt32LE(lfhOff)).toBe(0x04034b50)
    const lfhNameLen = buf.readUInt16LE(lfhOff + 26)
    const lfhExtraLen = buf.readUInt16LE(lfhOff + 28)
    const dataStart = lfhOff + 30 + lfhNameLen + lfhExtraLen
    const comp = buf.subarray(dataStart, dataStart + compSize)
    const data = method === 8 ? inflateRawSync(comp) : comp
    expect(data.length).toBe(uncompSize)
    expect(crc32(data)).toBe(crc)
    out.set(name, { isDir, data })
    off += 46 + nameLen + extraLen + commentLen
  }
  return out
}
