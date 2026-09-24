import { clipboard, ClipboardItem, dialog as electronDialog, nativeImage, net, Notification, screen, shell } from 'electron'
import { BrowserWindow } from 'electron'
import { networkInterfaces, tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
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
import { extractIcnsPngForSize } from './native-apps'
import type { ApiCenterService } from './api-center'

export { PluginStorageService }

// ESM 主进程无 __dirname，preload 相对 bundle 产物定位（out/main → out/preload）
const floatPreloadPath = fileURLToPath(new URL('../preload/float.cjs', import.meta.url))

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

/**
 * 本机应用图标解码器：nativeImage.createFromPath 实测解不了 icns（恒 isEmpty），
 * 快路径用纯函数从 icns 容器抽 PNG 条目；老式非 PNG 条目（JPEG2000 等）走系统 sips 转换兜底，
 * 仍失败才返回 undefined（渲染层字母块兜底）。
 */
export function createNativeAppsIconDecoder(size = 64): (iconPath: string) => Promise<string | undefined> {
  return async (iconPath) => {
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
      writeImage: async (dataUrl) => {
        const png = nativeImage.createFromDataURL(dataUrl).toPNG()
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })])
      }
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
