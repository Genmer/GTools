import { PDFDocument, degrees } from 'pdf-lib'
import { normalizeAngle } from './pages'

// pdf-lib 全部本地内存操作：字节（Uint8Array）进出，不触碰 fs/IPC，node 环境可直接单测

export async function readPageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount()
}

export async function mergePdfs(docs: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  for (const bytes of docs) {
    const src = await PDFDocument.load(bytes)
    const copied = await out.copyPages(src, src.getPageIndices())
    for (const page of copied) out.addPage(page)
  }
  return out.save()
}

function assertInRange(pages: number[], pageCount: number): void {
  for (const p of pages) {
    if (!Number.isInteger(p) || p < 1 || p > pageCount) {
      throw new Error(`页码超出范围：${p}（共 ${pageCount} 页）`)
    }
  }
}

/** pages 为 1 起始页码，按给定顺序复制到新文档 */
export async function extractPages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes)
  assertInRange(pages, src.getPageCount())
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, pages.map((p) => p - 1))
  for (const page of copied) out.addPage(page)
  return out.save()
}

export async function deletePages(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  assertInRange(pages, doc.getPageCount())
  // 倒序删：先删前面的页会让后续索引位移
  for (const p of [...new Set(pages)].sort((a, b) => b - a)) doc.removePage(p - 1)
  return doc.save()
}

/** delta 为角度增量（如 90 / -90 / 180）；pages='all' 或 1 起始页码列表 */
export async function rotatePages(
  bytes: Uint8Array,
  pages: number[] | 'all',
  delta: number
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const pageCount = doc.getPageCount()
  const indices =
    pages === 'all'
      ? Array.from({ length: pageCount }, (_, i) => i)
      : [...new Set(pages)].map((p) => p - 1)
  assertInRange(
    indices.map((i) => i + 1),
    pageCount
  )
  for (const i of indices) {
    const page = doc.getPage(i)
    page.setRotation(degrees(normalizeAngle(page.getRotation().angle + delta)))
  }
  return doc.save()
}

export type ImageKind = 'png' | 'jpg'

export interface ImageInput {
  kind: ImageKind
  bytes: Uint8Array
}

/** 每张图一页，页面尺寸 = 图片原始尺寸 */
export async function imagesToPdf(images: ImageInput[]): Promise<Uint8Array> {
  if (images.length === 0) throw new Error('没有可转换的图片')
  const out = await PDFDocument.create()
  for (const img of images) {
    const embedded = img.kind === 'png' ? await out.embedPng(img.bytes) : await out.embedJpg(img.bytes)
    const page = out.addPage([embedded.width, embedded.height])
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height })
  }
  return out.save()
}

// fs 通道二进制只走 base64；分块拼接避免大文件撑爆调用栈
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
