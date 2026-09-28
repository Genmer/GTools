import { app, clipboard, ClipboardItem, desktopCapturer, dialog as electronDialog, nativeImage, net, Notification, screen, shell } from 'electron'
import { BrowserWindow } from 'electron'
import { networkInterfaces, tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as nodeFs from 'node:fs/promises'
import type { ServiceBag } from './dispatch'
import type {
  DialogFileFilter,
  DialogOpenOptions,
  DialogSaveOptions,
  HostFetchInit,
  HostFetchResult
} from '@sdk/api'
import { PluginStorageService } from './storage'
import { assertHttpUrl, resolveFetchBody } from './net-guard'
import { lanIPv4Addresses } from './lan'
import { FloatWindowManager, type FloatWindowHostOptions, type FloatWindowLike } from './float-window'
import { FileAccessService, type FileAccessFs } from './file-access'
import { createScreenshotService, type CapturedFrame, type OverlayHandle } from './screenshot'
import { extractIcnsPngForSize, lnkIconCandidates } from './native-apps'
import type { ApiCenterService } from './api-center'

export { PluginStorageService }

// ESM 主进程无 __dirname，preload 相对 bundle 产物定位（out/main → out/preload）
const floatPreloadPath = fileURLToPath(new URL('../preload/float.cjs', import.meta.url))
// 截图遮罩页复用主 preload（gtools host 桥）回传选区事件
const overlayPreloadPath = fileURLToPath(new URL('../preload/index.cjs', import.meta.url))

/** 唯一网络出口（http(s) 白名单 + 超时）；API 中心执行器复用同一出口 */
export async function fetchViaNet(url: string, init?: HostFetchInit): Promise<HostFetchResult> {
  assertHttpUrl(url)
  const timeoutMs = init?.timeoutMs ?? 10_000
  const res = await net.fetch(url, {
    method: init?.method,
    headers: init?.headers,
    ...resolveFetchBody(init?.body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  return { ok: res.ok, status: res.status, body: await res.text() }
}

function toElectronFilters(filters?: DialogFileFilter[]) {
  return filters?.filter((f) => Array.isArray(f.extensions) && f.extensions.length > 0).map((f) => ({ name: f.name, extensions: f.extensions }))
}

/** Electron 44 clipboard W3C 异步形态：图片经 ClipboardItem+Blob 写入（剪贴板与截图服务共用） */
async function writeImageToClipboard(dataUrl: string): Promise<void> {
  const png = nativeImage.createFromDataURL(dataUrl).toPNG()
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
}

/** desktopCapturer 冻结帧 → CapturedFrame；isBlank 采样位图（DRM/独占全屏偶发全黑帧在服务层重试） */
function wrapNativeImage(img: Electron.NativeImage): CapturedFrame {
  const size = img.getSize()
  return {
    width: size.width,
    height: size.height,
    crop: (r) => {
      const c = img.crop(r)
      return { png: c.toPNG(), width: r.width, height: r.height }
    },
    isBlank: () => {
      try {
        const b = img.toBitmap()
        const stride = Math.max(4, Math.floor(b.length / 4096 / 4) * 4)
        for (let i = 0; i + 2 < b.length; i += stride) {
          if (b[i] > 12 || b[i + 1] > 12 || b[i + 2] > 12) return false
        }
        return true
      } catch {
        return false
      }
    },
    toJpegDataUrl: (q) => `data:image/jpeg;base64,${img.toJPEG(q).toString('base64')}`
  }
}

/** 读 .lnk 结构，坏快捷方式/非文件目标抛错由调用方兜底（ShortcutDetails.icon 即 .lnk 自带图标源） */
function tryReadShortcut(lnkPath: string): { target?: string; iconPath?: string } {
  try {
    const lnk = shell.readShortcutLink(lnkPath)
    return { target: lnk.target, iconPath: lnk.icon }
  } catch {
    return {}
  }
}

/** lnk 图标字段里的 %VAR%（如 %SystemRoot%）getFileIcon 不认，按进程环境展开 */
function expandEnvVars(p: string): string {
  return p.replace(/%([^%]+)%/g, (m, v) => process.env[v] ?? m)
}

/**
 * 本机应用图标解码器：nativeImage.createFromPath 实测解不了 icns（恒 isEmpty），
 * 快路径用纯函数从 icns 容器抽 PNG 条目；老式非 PNG 条目（JPEG2000 等）走系统 sips 转换兜底，
 * 仍失败才返回 undefined（渲染层字母块兜底）。
 * win32：getFileIcon 对 .lnk 本体返回默认白板图标（含快捷方式箭头），先解析快捷方式逐候选取真图标；
 * 单候选带超时——个别 .lnk（如 MSI 广告式快捷方式）会让 getFileIcon 挂死并卡住整个应用列表。
 */
export function createNativeAppsIconDecoder(size = 64): (iconPath: string) => Promise<string | undefined> {
  return async (iconPath) => {
    if (process.platform === 'win32') {
      const candidates = iconPath.toLowerCase().endsWith('.lnk')
        ? lnkIconCandidates(tryReadShortcut(iconPath), iconPath, isAbsolute, expandEnvVars)
        : [iconPath]
      for (const candidate of candidates) {
        try {
          const img = await Promise.race([
            app.getFileIcon(candidate, { size: size <= 32 ? 'normal' : 'large' }),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('getFileIcon timeout')), 3000))
          ])
          if (img && !img.isEmpty()) {
            // 源已是目标尺寸（large=32px）时不放大，避免插值发虚
            return img.getSize().width > size ? img.resize({ width: size, height: size }).toDataURL() : img.toDataURL()
          }
        } catch {
          // 候选不可读/挂起超时（已卸载/系统命名空间），试下一个
        }
      }
      return undefined
    }
    const png = extractIcnsPngForSize(await nodeFs.readFile(iconPath), size)
    const buffer = png ?? (await convertIcnsViaSips(iconPath))
    if (buffer === null) return undefined
    const img = nativeImage.createFromBuffer(buffer)
    if (img.isEmpty()) return undefined
    return img.resize({ width: size, height: size }).toDataURL()
  }
}

/** sips 能解码 icns 全部条目格式，作为非 PNG 条目的兜底；失败返回 null */
async function convertIcnsViaSips(iconPath: string): Promise<Buffer | null> {
  if (!iconPath.endsWith('.icns')) return null
  const out = join(tmpdir(), `gtools-icon-${randomBytes(6).toString('hex')}.png`)
  try {
    await new Promise<void>((resolve, reject) => {
      execFile('sips', ['-s', 'format', 'png', iconPath, '--out', out], (err) => (err ? reject(err) : resolve()))
    })
    return await nodeFs.readFile(out)
  } catch {
    return null
  } finally {
    await nodeFs.rm(out, { force: true }).catch(() => {})
  }
}

export function createElectronServices(opts: {
  storageRoot: string
  appVersion: string
  getWindow: () => BrowserWindow | null
  apiCenter: ApiCenterService
}): ServiceBag {
  const storage = new PluginStorageService(opts.storageRoot)
  const fileAccess = new FileAccessService(nodeFs as unknown as FileAccessFs)

  const events = {
    emitToRenderer: (pluginId: string, event: string, payload: unknown): void => {
      opts.getWindow()?.webContents.send(`plugin-event:${pluginId}`, { event, payload })
    }
  }

  const float = new FloatWindowManager({
    createWindow: (o: FloatWindowHostOptions): FloatWindowLike => {
      const win = new BrowserWindow({
        width: o.width,
        height: o.height,
        x: o.x,
        y: o.y,
        title: o.title,
        frame: false,
        // 透明浮窗直透桌面（外形由 html 自画）；不透明浮窗显式白底，不依赖平台默认值
        backgroundColor: o.transparent ? '#00000000' : '#ffffff',
        transparent: o.transparent,
        resizable: o.resizable,
        alwaysOnTop: o.alwaysOnTop,
        skipTaskbar: true,
        show: false, // 统一走下方显式 show/showInactive，避免抢焦点路径分叉
        webPreferences: {
          preload: floatPreloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false
        }
      })
      if (o.alwaysOnTop) win.setAlwaysOnTop(true, 'floating')
      if (o.show) {
        if (o.focus) win.show()
        else win.showInactive()
      }
      return {
        webContentsId: win.webContents.id,
        loadURL: (u) => void win.loadURL(u),
        setBounds: (b) => win.setBounds(b),
        setAlwaysOnTop: (v, level) => win.setAlwaysOnTop(v, level ?? 'floating'),
        setResizable: (v) => win.setResizable(v),
        setOpacity: (v) => win.setOpacity(v),
        focus: () => win.focus(),
        close: () => win.close(),
        destroy: () => win.destroy(),
        isDestroyed: () => win.isDestroyed(),
        on: (ev, cb) => {
          win.on(ev, cb)
        }
      }
    },
    getWorkArea: () => {
      try {
        return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
      } catch {
        return screen.getPrimaryDisplay().workArea
      }
    },
    onFloatEvent: (pluginId, payload) => events.emitToRenderer(pluginId, 'float-event', payload)
  })

  const screenshot = createScreenshotService({
    hideLauncher: () => opts.getWindow()?.hide(),
    getTargetDisplay: () => {
      let d
      try {
        d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      } catch {
        d = screen.getPrimaryDisplay()
      }
      return { id: String(d.id), x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, scaleFactor: d.scaleFactor }
    },
    capture: async (display) => {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: display.width * display.scaleFactor, height: display.height * display.scaleFactor }
      })
      const src = sources.find((s) => s.display_id === display.id) ?? sources[0]
      if (!src || src.thumbnail.isEmpty()) return null
      return wrapNativeImage(src.thumbnail)
    },
    createOverlay: (bounds, url) => {
      const win = new BrowserWindow({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        show: false,
        backgroundColor: '#000000',
        webPreferences: {
          preload: overlayPreloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false
        }
      })
      // screen-saver 级压住任务栏；注入冻结帧完成后再 show，避免闪黑
      win.setAlwaysOnTop(true, 'screen-saver')
      void win.loadURL(url)
      const handle: OverlayHandle = {
        webContentsId: win.webContents.id,
        show: () => win.show(),
        focus: () => win.focus(),
        destroy: () => {
          if (!win.isDestroyed()) win.destroy()
        },
        isDestroyed: () => win.isDestroyed(),
        injectImage: (dataUrl) =>
          win.webContents.executeJavaScript(`window.__gtShot(${JSON.stringify(dataUrl)})`, true).then(() => undefined),
        onClosed: (cb) => win.on('closed', () => cb())
      }
      return handle
    },
    writeClipboardImage: writeImageToClipboard,
    askSavePath: async (defaultName) => {
      const r = await electronDialog.showSaveDialog({
        title: '保存截图',
        defaultPath: defaultName,
        filters: [{ name: 'PNG 图片', extensions: ['png'] }]
      })
      return r.canceled || !r.filePath ? null : r.filePath
    },
    writeFileBase64: (path, base64) => nodeFs.writeFile(path, Buffer.from(base64, 'base64')),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now()
  })

  // 对话框父窗口：宿主窗可见才挂 modal，隐藏时独立弹出（避免隐藏父窗吞焦点）
  const parentIfVisible = (): BrowserWindow | undefined => {
    const w = opts.getWindow()
    return w && w.isVisible() ? w : undefined
  }

  return {
    clipboard: {
      // Electron 44 clipboard 已 W3C 异步化（无同步 readImage/writeImage），图片走 ClipboardItem + Blob
      readText: () => clipboard.readText(),
      writeText: (t) => clipboard.writeText(t),
      readImage: async () => {
        const items = await clipboard.read()
        for (const item of items) {
          if (!item.types.includes('image/png')) continue
          const blob = (await item.getType('image/png')) as Blob
          const img = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
          if (!img.isEmpty()) {
            const size = img.getSize()
            return { width: size.width, height: size.height, dataUrl: img.toDataURL() }
          }
        }
        return null
      },
      writeImage: writeImageToClipboard
    },
    storage,
    net: {
      fetch: fetchViaNet,
      lanAddresses: async () => lanIPv4Addresses(networkInterfaces() as never)
    },
    notification: {
      show: (title, body) => {
        new Notification({ title, body }).show()
        return Promise.resolve()
      }
    },
    shell: {
      // openApp 限定应用入口扩展名（.app/.lnk/.exe），其余一律走 openPath；实现同走 shell.openPath
      openApp: async (target) => {
        if (!/\.(app|lnk|exe)$/i.test(target)) {
          throw new Error(`openApp 仅接受 .app/.lnk/.exe 应用路径：${target}`)
        }
        await shell.openPath(target)
      },
      openPath: async (p) => {
        await shell.openPath(p)
      },
      openExternal: async (url) => {
        assertHttpUrl(url)
        await shell.openExternal(url)
      }
    },
    window: {
      hide: () => {
        opts.getWindow()?.hide()
        return Promise.resolve()
      },
      float
    },
    screenshot,
    dialog: {
      openFile: async (pluginId: string, o?: DialogOpenOptions) => {
        const properties: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'createDirectory'> = o?.directory
          ? ['openDirectory', 'createDirectory']
          : ['openFile']
        if (o?.multiple && o?.directory) properties.push('multiSelections')
        else if (o?.multiple) properties.push('multiSelections')
        const parent = parentIfVisible()
        const r = parent
          ? await electronDialog.showOpenDialog(parent, {
              title: o?.title,
              defaultPath: o?.defaultPath,
              filters: toElectronFilters(o?.filters),
              properties
            })
          : await electronDialog.showOpenDialog({
              title: o?.title,
              defaultPath: o?.defaultPath,
              filters: toElectronFilters(o?.filters),
              properties
            })
        if (r.canceled || r.filePaths.length === 0) return []
        await fileAccess.grant(pluginId, r.filePaths)
        return r.filePaths
      },
      saveFile: async (pluginId: string, o?: DialogSaveOptions) => {
        const parent = parentIfVisible()
        const opts = {
          title: o?.title,
          defaultPath: o?.defaultPath,
          filters: toElectronFilters(o?.filters)
        }
        const r = parent ? await electronDialog.showSaveDialog(parent, opts) : await electronDialog.showSaveDialog(opts)
        if (r.canceled || !r.filePath) return null
        await fileAccess.grant(pluginId, [r.filePath])
        return r.filePath
      }
    },
    fs: {
      grant: (pluginId, paths) => fileAccess.grant(pluginId, paths),
      read: (pluginId, path, o) => fileAccess.read(pluginId, path, o),
      write: (pluginId, path, data, o) => fileAccess.write(pluginId, path, data, o),
      rename: (pluginId, from, to) => fileAccess.rename(pluginId, from, to),
      remove: (pluginId, path) => fileAccess.remove(pluginId, path),
      stat: (pluginId, path) => fileAccess.stat(pluginId, path),
      list: (pluginId, dir, o) => fileAccess.list(pluginId, dir, o),
      mkdir: (pluginId, path) => fileAccess.mkdir(pluginId, path)
    },
    app: { platform: process.platform, version: opts.appVersion },
    apis: {
      translate: (req) => opts.apiCenter.translate(req),
      status: (service) => opts.apiCenter.status(service)
    },
    events
  }
}
