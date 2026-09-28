import { describe, expect, it } from 'vitest'
import {
  createWallpaperService,
  mapWallpaperStyle,
  parseRegInt,
  parseRegStringValue,
  readImageSize,
  sniffImageMime,
  type WallpaperExec,
  type WallpaperFs
} from '../src/main/services/wallpaper'

const PNG_1X1 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]),
  ((): Buffer => {
    const b = Buffer.alloc(8)
    b.writeUInt32BE(1920, 0)
    b.writeUInt32BE(1080, 4)
    return b
  })()
])

const JPEG_SOF = ((): Buffer => {
  // 最小 JPEG：SOI + APP0(段长 0x10 含长度字节，后随 14 字节载荷) + SOF0(高 1080 宽 1920) + EOI
  const sof = Buffer.alloc(19)
  sof[0] = 0xff
  sof[1] = 0xc0
  sof.writeUInt16BE(17, 2)
  sof.writeUInt16BE(1080, 5)
  sof.writeUInt16BE(1920, 7)
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, ...new Array<number>(14).fill(0)]),
    sof,
    Buffer.from([0xff, 0xd9])
  ])
})()

describe('sniffImageMime', () => {
  it('识别 png/jpeg/bmp 魔数', () => {
    expect(sniffImageMime(PNG_1X1)).toBe('image/png')
    expect(sniffImageMime(JPEG_SOF)).toBe('image/jpeg')
    expect(sniffImageMime(Buffer.from('BM\x00\x00'))).toBe('image/bmp')
    expect(sniffImageMime(Buffer.from('not-an-image'))).toBeNull()
  })
})

describe('readImageSize', () => {
  it('PNG 取 IHDR 宽高', () => {
    expect(readImageSize(PNG_1X1)).toEqual({ width: 1920, height: 1080 })
  })
  it('JPEG 扫 SOF 段取宽高', () => {
    expect(readImageSize(JPEG_SOF)).toEqual({ width: 1920, height: 1080 })
  })
  it('未知格式返回 null', () => {
    expect(readImageSize(Buffer.from('garbage data!!'))).toBeNull()
  })
})

describe('mapWallpaperStyle + reg 解析', () => {
  const regLine = (name: string, type: string, value: string): string => `    ${name}    ${type}    ${value}\r\n`

  it('注册表值按实测映射', () => {
    expect(mapWallpaperStyle({ wallpaperStyle: '10', tileWallpaper: '0' })).toBe('fill')
    expect(mapWallpaperStyle({ wallpaperStyle: '2', tileWallpaper: '0' })).toBe('stretch')
    expect(mapWallpaperStyle({ wallpaperStyle: '6', tileWallpaper: '0' })).toBe('fit')
    expect(mapWallpaperStyle({ wallpaperStyle: '0', tileWallpaper: '0' })).toBe('center')
    expect(mapWallpaperStyle({ wallpaperStyle: '22', tileWallpaper: '0' })).toBe('span')
    expect(mapWallpaperStyle({ wallpaperStyle: '0', tileWallpaper: '1' })).toBe('tile')
    expect(mapWallpaperStyle({ wallpaperStyle: null, tileWallpaper: null })).toBe('fill')
  })

  it('reg query 输出取末段（含 0x 十六进制）', () => {
    expect(parseRegStringValue(regLine('WallpaperStyle', 'REG_SZ', '10'), 'WallpaperStyle')).toBe('10')
    expect(parseRegStringValue(regLine('TileWallpaper', 'REG_DWORD', '0x0'), 'TileWallpaper')).toBe('0x0')
    expect(parseRegInt('0xa')).toBe(10)
    expect(parseRegInt(null)).toBeNull()
  })
})

describe('createWallpaperService', () => {
  const regLine = (name: string, type: string, value: string): string => `    ${name}    ${type}    ${value}\r\n`
  const win = { platform: 'win32' as NodeJS.Platform, appData: 'C:\\Users\\u\\AppData\\Roaming' }
  const defaultExec: WallpaperExec = async (file, args) => {
    if (file.startsWith('powershell')) return { stdout: 'C:\\Wall\\photo.jpg\r\n' }
    if (args.includes('WallpaperStyle')) return { stdout: regLine('WallpaperStyle', 'REG_SZ', '10') }
    if (args.includes('TileWallpaper')) return { stdout: regLine('TileWallpaper', 'REG_DWORD', '0x0') }
    return { stdout: regLine('Wallpaper', 'REG_SZ', 'C:\\Wall\\photo.jpg') }
  }
  const defaultFs: WallpaperFs = {
    readFile: async () => JPEG_SOF,
    stat: async () => ({ mtimeMs: 100 })
  }

  it('SPI 路径 + 读文件 + base64 + 尺寸一条龙', async () => {
    const svc = createWallpaperService({ ...win, exec: defaultExec, fs: defaultFs })
    const snap = await svc.snapshot()
    expect(snap?.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(snap?.style).toBe('fill')
    expect(snap?.imgW).toBe(1920)
    expect(snap?.imgH).toBe(1080)
  })

  it('path+mtime 未变不重读；变更才重读', async () => {
    let reads = 0
    let mtime = 100
    const svc = createWallpaperService({
      ...win,
      exec: async (file) => (file.startsWith('powershell') ? { stdout: 'C:\\Wall\\photo.jpg\r\n' } : { stdout: '' }),
      fs: {
        readFile: async () => {
          reads++
          return PNG_1X1
        },
        stat: async () => ({ mtimeMs: mtime })
      }
    })
    await svc.snapshot()
    expect(reads).toBe(1)
    await svc.snapshot()
    expect(reads).toBe(1)
    mtime = 200
    expect(await svc.refreshIfChanged()).toBe(true)
    expect(reads).toBe(2)
  })

  it('SPI 失败回退注册表，注册表失败回退 TranscodedWallpaper 固定路径', async () => {
    let powershellTried = 0
    let regTried = 0
    const svc = createWallpaperService({
      ...win,
      exec: async (file, args) => {
        if (file.startsWith('powershell')) {
          powershellTried++
          throw new Error('no powershell')
        }
        if (args.includes('Wallpaper')) {
          regTried++
          throw new Error('no reg')
        }
        return { stdout: '' }
      },
      fs: {
        readFile: async (p) => {
          expect(p.endsWith('TranscodedWallpaper')).toBe(true)
          return JPEG_SOF
        },
        stat: async () => ({ mtimeMs: 1 })
      }
    })
    const snap = await svc.snapshot()
    expect(powershellTried).toBeGreaterThan(0)
    expect(regTried).toBeGreaterThan(0)
    expect(snap?.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
  })

  it('macOS 走 osascript，多桌面取第一张；exec 失败（TCC -1743）返回 null', async () => {
    const mac = { platform: 'darwin' as NodeJS.Platform }
    const ok = createWallpaperService({
      ...mac,
      exec: async () => ({ stdout: '/Users/u/Pic/a.jpg, /Users/u/Pic/b.jpg\n' }),
      fs: { readFile: async () => PNG_1X1, stat: async () => ({ mtimeMs: 1 }) }
    })
    expect((await ok.snapshot())?.path).toBe('/Users/u/Pic/a.jpg')
    const denied = createWallpaperService({
      ...mac,
      exec: async () => {
        throw new Error('exit -1743')
      },
      fs: { readFile: async () => PNG_1X1, stat: async () => ({ mtimeMs: 1 }) }
    })
    expect(await denied.snapshot()).toBeNull()
  })
})
