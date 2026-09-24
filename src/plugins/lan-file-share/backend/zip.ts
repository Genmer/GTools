/** 极简 ZIP 构建器（无需三方依赖）：STORE/DEFLATE 单文件条目 + 目录条目 + 中央目录 */

export interface ZipInput {
  /** zip 内路径；目录条目以 '/' 结尾且 data 须为空 */
  path: string
  data: Buffer
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** DOS 时间（本地时区，1980 前钳到 1980） */
export function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(d.getFullYear(), 1980)
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time: time & 0xffff, date: date & 0xffff }
}

export interface ZipBuildOptions {
  /** 注入 zlib.deflateRawSync；压缩结果不小于原文时自动退回 STORE */
  deflate?: (b: Buffer) => Buffer
  now?: Date
}

export function buildZip(entries: readonly ZipInput[], opts: ZipBuildOptions = {}): Buffer {
  const { time, date } = dosDateTime(opts.now ?? new Date())
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const name = Buffer.from(e.path, 'utf8')
    const isDir = e.path.endsWith('/')
    const data = isDir ? Buffer.alloc(0) : e.data
    const crc = crc32(data)
    let method = 0
    let comp = data
    if (!isDir && opts.deflate && data.length > 0) {
      const z = opts.deflate(data)
      if (z.length < data.length) {
        method = 8
        comp = z
      }
    }

    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0)
    lfh.writeUInt16LE(20, 4) // version needed
    lfh.writeUInt16LE(0x0800, 6) // bit11: 文件名 UTF-8
    lfh.writeUInt16LE(method, 8)
    lfh.writeUInt16LE(time, 10)
    lfh.writeUInt16LE(date, 12)
    lfh.writeUInt32LE(crc, 14)
    lfh.writeUInt32LE(comp.length, 18)
    lfh.writeUInt32LE(data.length, 22)
    lfh.writeUInt16LE(name.length, 26)
    lfh.writeUInt16LE(0, 28) // extra len
    locals.push(lfh, name, comp)

    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0)
    cdh.writeUInt16LE(20, 4) // version made by
    cdh.writeUInt16LE(20, 6) // version needed
    cdh.writeUInt16LE(0x0800, 8)
    cdh.writeUInt16LE(method, 10)
    cdh.writeUInt16LE(time, 12)
    cdh.writeUInt16LE(date, 14)
    cdh.writeUInt32LE(crc, 16)
    cdh.writeUInt32LE(comp.length, 20)
    cdh.writeUInt32LE(data.length, 24)
    cdh.writeUInt16LE(name.length, 28)
    cdh.writeUInt16LE(0, 30) // extra
    cdh.writeUInt16LE(0, 32) // comment
    cdh.writeUInt16LE(0, 34) // disk start
    cdh.writeUInt16LE(0, 36) // internal attrs
    cdh.writeUInt32LE(isDir ? 0x10 : 0, 38) // external attrs（目录位）
    cdh.writeUInt32LE(offset, 42)
    centrals.push(cdh, name)

    offset += 30 + name.length + comp.length
  }

  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}
