import { join } from 'node:path'

/** 壁纸铺法（渲染层据此映射 background-size/position 与桌面逐像素对齐） */
export type WallpaperStyleName = 'fill' | 'stretch' | 'fit' | 'center' | 'tile' | 'span'

export interface WallpaperSnapshot {
  dataUrl: string
  path: string
  mtimeMs: number
  style: WallpaperStyleName
  imgW: number
  imgH: number
}

/** 构造注入（仓库测试规约）：本模块不顶层 import electron，fs/exec 全部由调用方传入 */
export interface WallpaperFs {
  readFile(path: string): Promise<Buffer>
  stat(path: string): Promise<{ mtimeMs: number }>
}

export type WallpaperExec = (file: string, args: string[]) => Promise<{ stdout: string }>

const SPI_GETDESKWALLPAPER = 0x0073
const PATH_TTL_MS = 5000

// SPI 取原图路径（实测返回原图而非转码文件）；失败再走 reg / TranscodedWallpaper
const SPI_SCRIPT =
  "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
  'Add-Type -Namespace GTools -Name Native -MemberDefinition \'[DllImport("user32.dll")]public static extern bool SystemParametersInfoW(uint a,uint b,System.Text.StringBuilder c,uint d);\';' +
  '$sb=New-Object System.Text.StringBuilder 1024;' +
  `if([GTools.Native]::SystemParametersInfoW(${SPI_GETDESKWALLPAPER},1024,$sb,0)){$sb.ToString()}`

export function sniffImageMime(buf: Buffer): 'image/png' | 'image/jpeg' | 'image/bmp' | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg'
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) return 'image/bmp'
  return null
}

/** 头部解析取原图尺寸（渲染层按显示区精确缩放壁纸用）；解析不出返回 null */
export function readImageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
  }
  if (buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return { width: Math.abs(buf.readInt32LE(18)), height: Math.abs(buf.readInt32LE(22)) }
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let pos = 2
    while (pos + 9 < buf.length) {
      if (buf[pos] !== 0xff) {
        pos++
        continue
      }
      const marker = buf[pos + 1]
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        pos += 2
        continue
      }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(pos + 5), width: buf.readUInt16BE(pos + 7) }
      }
      pos += 2 + buf.readUInt16BE(pos + 2)
    }
  }
  return null
}

/** reg query 输出行形如 "    WallpaperStyle    REG_SZ    10"（DWORD 为 0xa），取末段 */
export function parseRegStringValue(output: string, valueName: string): string | null {
  for (const line of output.split(/\r?\n/)) {
    const t = line.trim()
    if (!t.startsWith(valueName)) continue
    const parts = t.split(/\s{2,}/)
    if (parts.length >= 3) return parts[parts.length - 1].trim()
  }
  return null
}

export function parseRegInt(raw: string | null): number | null {
  if (raw === null) return null
  const t = raw.trim()
  const n = t.toLowerCase().startsWith('0x') ? Number.parseInt(t.slice(2), 16) : Number.parseInt(t, 10)
  return Number.isFinite(n) ? n : null
}

/** WallpaperStyle/TileWallpaper 注册表值 → 铺法（实测 10=fill；2=stretch/6=fit/0=center/22=span；Tile=1 时 tile） */
export function mapWallpaperStyle(raw: { wallpaperStyle: string | null; tileWallpaper: string | null }): WallpaperStyleName {
  if (parseRegInt(raw.tileWallpaper) === 1) return 'tile'
  switch (parseRegInt(raw.wallpaperStyle)) {
    case 0:
      return 'center'
    case 2:
      return 'stretch'
    case 6:
      return 'fit'
    case 22:
      return 'span'
    default:
      return 'fill'
  }
}

export function createWallpaperService(deps: { platform: NodeJS.Platform; exec: WallpaperExec; fs: WallpaperFs; appData?: string }) {
  interface Cache {
    path: string
    mtimeMs: number
    style: WallpaperStyleName
    dataUrl: string
    imgW: number
    imgH: number
  }
  let cache: Cache | null = null
  let resolved: { path: string | null; at: number } | null = null

  async function resolvePathWin(): Promise<string | null> {
    try {
      const spi = await deps.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SPI_SCRIPT])
      const p = spi.stdout.trim().split(/\r?\n/)[0]?.trim() ?? ''
      if (p.includes('\\') || p.includes('/')) return p
    } catch {
      // SPI 不可用时走注册表
    }
    try {
      const reg = await deps.exec('reg.exe', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'Wallpaper'])
      const p = parseRegStringValue(reg.stdout, 'Wallpaper')
      if (p) return p
    } catch {
      // 注册表也不可用
    }
    // 固定位置转码文件（幻灯片当前张）；不存在由 readFile 失败兜底
    return deps.appData ? join(deps.appData, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper') : null
  }

  async function resolvePathMac(): Promise<string | null> {
    try {
      // TCC 拒绝时 osascript 以 -1743 退出 → exec reject → null
      const r = await deps.exec('osascript', ['-e', 'tell application "System Events" to get picture of every desktop'])
      const first = r.stdout.trim().split(',')[0]?.trim()
      return first || null
    } catch {
      return null
    }
  }

  async function resolvePathCached(): Promise<string | null> {
    const now = Date.now()
    if (resolved && now - resolved.at < PATH_TTL_MS) return resolved.path
    const path = deps.platform === 'darwin' ? await resolvePathMac() : deps.platform === 'win32' ? await resolvePathWin() : null
    resolved = { path, at: now }
    return path
  }

  async function resolveStyle(): Promise<WallpaperStyleName> {
    if (deps.platform !== 'win32') return 'fill'
    const read = async (name: string): Promise<string | null> => {
      try {
        const r = await deps.exec('reg.exe', ['query', 'HKCU\\Control Panel\\Desktop', '/v', name])
        return parseRegStringValue(r.stdout, name)
      } catch {
        return null
      }
    }
    const [style, tile] = await Promise.all([read('WallpaperStyle'), read('TileWallpaper')])
    return mapWallpaperStyle({ wallpaperStyle: style, tileWallpaper: tile })
  }

  /** 读当前壁纸（原图 dataURL + 铺法 + 原始尺寸）；按 path+mtime 缓存，未变更不重读不重编 */
  async function snapshot(): Promise<WallpaperSnapshot | null> {
    const path = await resolvePathCached()
    if (!path) return null
    let mtimeMs: number
    try {
      mtimeMs = (await deps.fs.stat(path)).mtimeMs
    } catch {
      return null
    }
    if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache
    const buf = await deps.fs.readFile(path)
    const mime = sniffImageMime(buf)
    const size = readImageSize(buf)
    if (!mime || !size) return cache // 坏文件保旧值
    cache = {
      path,
      mtimeMs,
      style: await resolveStyle(),
      dataUrl: `data:${mime};base64,${buf.toString('base64')}`,
      imgW: size.width,
      imgH: size.height
    }
    return cache
  }

  /** 焦点/唤醒时廉价复查（stat+注册表），有变返回 true 由调用方推送渲染层 */
  async function refreshIfChanged(): Promise<boolean> {
    const prev = cache
    await snapshot().catch(() => null)
    return cache !== prev
  }

  return { snapshot, refreshIfChanged }
}
