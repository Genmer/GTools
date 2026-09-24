import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import {
  base64ToBytes,
  bytesToBase64,
  deletePages,
  extractPages,
  imagesToPdf,
  mergePdfs,
  readPageCount,
  rotatePages
} from '../../../../src/plugins/pdf-tools/logic/pdf-ops'

// 每页宽度 = 100 + i*10，用尺寸当页身份，断言选择与顺序
async function samplePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) doc.addPage([100 + i * 10, 200])
  return doc.save()
}

async function widths(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => p.getWidth())
}

async function angles(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes)
  return doc.getPages().map((p) => p.getRotation().angle)
}

const PNG_1PX_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
// 本机 sips 生成的真实 1x1 JPEG（手拼 base64 常量会缺段导致 pdf-lib 判 Invalid JPEG）
const JPG_1PX_B64 =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8A+mKKKK/Kz/QA/9k='

describe('base64 编解码', () => {
  it('字节往返无损（含 >0x80 与全 256 值）', () => {
    const bytes = new Uint8Array(512)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff
    const round = base64ToBytes(bytesToBase64(bytes))
    expect([...round]).toEqual([...bytes])
  })
})

describe('readPageCount', () => {
  it('读取页数', async () => {
    expect(await readPageCount(await samplePdf(5))).toBe(5)
  })
})

describe('mergePdfs', () => {
  it('按入参顺序拼接，页数累加', async () => {
    const out = await mergePdfs([await samplePdf(3), await samplePdf(2)])
    expect(await readPageCount(out)).toBe(5)
    expect(await widths(out)).toEqual([100, 110, 120, 100, 110])
  })

  it('单文件合并等于原样复制', async () => {
    const out = await mergePdfs([await samplePdf(2)])
    expect(await widths(out)).toEqual([100, 110])
  })
})

describe('extractPages', () => {
  it('按给定顺序提取（可乱序、可重复）', async () => {
    const out = await extractPages(await samplePdf(5), [4, 2, 2])
    expect(await widths(out)).toEqual([130, 110, 110])
  })

  it('越界页码拒绝', async () => {
    await expect(extractPages(await samplePdf(3), [4])).rejects.toThrow('超出范围')
  })
})

describe('deletePages', () => {
  it('删除指定页，其余保持原顺序', async () => {
    const out = await deletePages(await samplePdf(5), [1, 3])
    expect(await widths(out)).toEqual([110, 130, 140])
  })

  it('重复页码只删一次，越界拒绝', async () => {
    const out = await deletePages(await samplePdf(3), [2, 2])
    expect(await widths(out)).toEqual([100, 120])
    await expect(deletePages(await samplePdf(3), [0])).rejects.toThrow('超出范围')
  })
})

describe('rotatePages', () => {
  it('全部页旋转 90', async () => {
    const out = await rotatePages(await samplePdf(3), 'all', 90)
    expect(await angles(out)).toEqual([90, 90, 90])
  })

  it('指定页左转 90 归一为 270，未指定页不动', async () => {
    const out = await rotatePages(await samplePdf(3), [1, 3], -90)
    expect(await angles(out)).toEqual([270, 0, 270])
  })

  it('在已有角度上叠加并归一（不溢出 360）', async () => {
    const once = await rotatePages(await samplePdf(1), 'all', 270)
    const twice = await rotatePages(once, 'all', 180)
    expect(await angles(twice)).toEqual([90])
  })
})

describe('imagesToPdf', () => {
  it('png 与 jpg 各成一页，页面尺寸随图片', async () => {
    const out = await imagesToPdf([
      { kind: 'png', bytes: base64ToBytes(PNG_1PX_B64) },
      { kind: 'jpg', bytes: base64ToBytes(JPG_1PX_B64) }
    ])
    const doc = await PDFDocument.load(out)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getWidth()).toBe(1)
    expect(doc.getPage(1).getWidth()).toBe(1)
  })

  it('空列表报错', async () => {
    await expect(imagesToPdf([])).rejects.toThrow('没有可转换的图片')
  })
})
