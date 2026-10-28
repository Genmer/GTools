import { describe, expect, it, vi } from 'vitest'
import {
  BACKGROUND_FILE_NAME,
  BackgroundService,
  type BackgroundDecodedImage,
  type BackgroundFs,
  type BackgroundImageCodec
} from '../src/main/services/background'

function fakeImage(width: number, height: number, jpeg?: ReturnType<typeof vi.fn>): BackgroundDecodedImage {
  // resize 返回的克隆共享同一 toJPEG mock：断言「缩放后产物」仍可观察
  const toJPEG = jpeg ?? vi.fn(() => Buffer.from('jpeg-bytes'))
  return {
    isEmpty: vi.fn(() => false),
    getSize: vi.fn(() => ({ width, height })),
    resize: vi.fn((opts: { width?: number }) => fakeImage(opts.width ?? width, height, toJPEG)),
    toJPEG
  } as unknown as BackgroundDecodedImage
}

function makeDeps(over: {
  img?: BackgroundDecodedImage
  files?: Map<string, Buffer>
  createFromPathThrows?: boolean
} = {}): {
  svc: BackgroundService
  fs: BackgroundFs & { files: Map<string, Buffer>; removed: string[] }
  image: BackgroundImageCodec
  img: BackgroundDecodedImage & { isEmpty: () => boolean; resize: ReturnType<typeof vi.fn>; toJPEG: ReturnType<typeof vi.fn> }
} {
  const img = (over.img ?? fakeImage(2400, 1600)) as never
  const files = over.files ?? new Map()
  const removed: string[] = []
  const fs = {
    files,
    removed,
    readFile: async (p: string) => {
      const v = files.get(p)
      if (v === undefined) throw new Error('ENOENT')
      return v
    },
    writeFile: async (p: string, data: Buffer) => {
      files.set(p, data)
    },
    rm: async (p: string) => {
      removed.push(p)
      files.delete(p)
    },
    mkdir: async () => undefined
  } as BackgroundFs & { files: Map<string, Buffer>; removed: string[] }
  const image: BackgroundImageCodec = {
    createFromPath: vi.fn(() => {
      if (over.createFromPathThrows) throw new Error('bad decode')
      return img as BackgroundDecodedImage
    }),
    createFromBuffer: vi.fn((buf: Buffer) => {
      const decoded = fakeImage(1, 1)
      // 空 buffer 模拟损坏内容
      ;(decoded.isEmpty as ReturnType<typeof vi.fn>) = vi.fn(() => buf.length === 0)
      return decoded
    })
  }
  return { svc: new BackgroundService('/ud/backgrounds', fs, image), fs, image, img }
}

describe('BackgroundService chooseAndStore（题5 数据链）', () => {
  it('拷贝重编码写 current.jpg；宽 >1600 先缩宽；成功后失效缓存（F4）', async () => {
    const { svc, fs, img } = makeDeps()
    await svc.chooseAndStore('/pics/a.png')
    expect(fs.files.get(`/ud/backgrounds/${BACKGROUND_FILE_NAME}`)?.toString()).toBe('jpeg-bytes')
    expect(img.resize).toHaveBeenCalledWith({ width: 1600 })
    expect(BACKGROUND_FILE_NAME).toBe('current.jpg')

    // 换图：旧 dataUrl 进缓存后再 choose 同名文件，resolve 必须读到新图（缓存已失效）
    const { svc: svc2, fs: fs2, img: img2 } = makeDeps()
    await svc2.chooseAndStore('/pics/old.png')
    const first = await svc2.resolveDataUrl(BACKGROUND_FILE_NAME)
    expect(first).toBe(`data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`)
    ;(img2.toJPEG as ReturnType<typeof vi.fn>).mockReturnValue(Buffer.from('new-jpeg'))
    await svc2.chooseAndStore('/pics/new.png')
    expect(fs2.files.get(`/ud/backgrounds/${BACKGROUND_FILE_NAME}`)?.toString()).toBe('new-jpeg')
    const second = await svc2.resolveDataUrl(BACKGROUND_FILE_NAME)
    expect(second).toBe(`data:image/jpeg;base64,${Buffer.from('new-jpeg').toString('base64')}`)
  })

  it('宽 ≤1600 不 resize，直接重编码', async () => {
    const img = fakeImage(1200, 800)
    const { svc, img: codecImg } = makeDeps({ img })
    await svc.chooseAndStore('/pics/a.jpg')
    expect((codecImg as unknown as { resize: ReturnType<typeof vi.fn> }).resize).not.toHaveBeenCalled()
  })

  it('坏图（isEmpty/解码异常）throw，不写文件零副作用', async () => {
    const bad = fakeImage(100, 100)
    ;(bad.isEmpty as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => true)
    const { svc, fs } = makeDeps({ img: bad as never })
    await expect(svc.chooseAndStore('/pics/broken.png')).rejects.toThrow('无法读取所选图片')
    expect(fs.files.size).toBe(0)

    const { svc: svc2, fs: fs2 } = makeDeps({ createFromPathThrows: true })
    await expect(svc2.chooseAndStore('/pics/broken.png')).rejects.toThrow('无法读取所选图片')
    expect(fs2.files.size).toBe(0)
  })
})

describe('BackgroundService resolveDataUrl / clear', () => {
  it('缺失文件 → null；空内容与损坏内容 → null；正常内容缓存按名命中', async () => {
    const { svc } = makeDeps({ files: new Map([[`/ud/backgrounds/${BACKGROUND_FILE_NAME}`, Buffer.from('jpeg-ok')]]) })
    expect(await svc.resolveDataUrl('ghost.jpg')).toBeNull()
    const { svc: svc2 } = makeDeps({ files: new Map([[`/ud/backgrounds/${BACKGROUND_FILE_NAME}`, Buffer.from('')]]) })
    expect(await svc2.resolveDataUrl(BACKGROUND_FILE_NAME)).toBeNull()
    const { svc: svc3, image } = makeDeps({ files: new Map([[`/ud/backgrounds/${BACKGROUND_FILE_NAME}`, Buffer.from('good')]]) })
    ;(image.createFromBuffer as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const d = fakeImage(1, 1)
      ;(d.isEmpty as unknown as ReturnType<typeof vi.fn>) = vi.fn(() => true)
      return d
    })
    expect(await svc3.resolveDataUrl(BACKGROUND_FILE_NAME)).toBeNull()
    const { svc: svc4 } = makeDeps({ files: new Map([[`/ud/backgrounds/${BACKGROUND_FILE_NAME}`, Buffer.from('jpeg-ok')]]) })
    const u1 = await svc4.resolveDataUrl(BACKGROUND_FILE_NAME)
    const u2 = await svc4.resolveDataUrl(BACKGROUND_FILE_NAME)
    expect(u1).toBe(u2)
    expect(u1).toContain('data:image/jpeg;base64,')
  })

  it('clear 删文件 + 失效缓存：clear 后 resolve 返回 null', async () => {
    const { svc, fs } = makeDeps()
    await svc.chooseAndStore('/pics/a.png')
    expect(await svc.resolveDataUrl(BACKGROUND_FILE_NAME)).not.toBeNull()
    await svc.clear()
    expect(fs.removed).toEqual([`/ud/backgrounds/${BACKGROUND_FILE_NAME}`])
    expect(await svc.resolveDataUrl(BACKGROUND_FILE_NAME)).toBeNull()
  })
})
