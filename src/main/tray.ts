import { Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'node:path'
import type { AppLogoSkin } from '@sdk/settings'
import { showSearchWindow } from './window'

let tray: Tray | null = null

function resolveIconPath(fileName: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, fileName)
    : join(app.getAppPath(), 'resources', fileName)
}

/** 黑底=现状透明彩色 G（用户认可的观感）；白底=白底方块版 logo（菜单栏深浅底均清晰） */
function trayImageFor(skin: AppLogoSkin): Electron.NativeImage {
  const base = skin === 'white' ? 'tray-white' : 'tray'
  let image = nativeImage.createFromPath(resolveIconPath(`${base}.png`))
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(resolveIconPath(`${base}@2x.png`))
  }
  return image.isEmpty() ? nativeImage.createEmpty() : image
}

/** 无 Dock/任务栏常驻时，托盘是唯一显式退出入口 */
export function createTray(onOpenSettings: () => void, skin: AppLogoSkin = 'black'): Tray {
  // 彩色渐变 logo 不适合 Template 化（16px 剪影糊成团），全平台统一彩色托盘
  tray = new Tray(trayImageFor(skin))
  tray.setToolTip('GTools')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示 GTools', click: () => showSearchWindow() },
      { label: '设置', click: () => onOpenSettings() },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ])
  )
  return tray
}

/** 设置切换 appLogoSkin 时托盘即时换图（托盘未建/已销毁时跳过，下次 createTray 按皮肤取图） */
export function applyTraySkin(skin: AppLogoSkin): void {
  if (!tray || tray.isDestroyed()) return
  const image = trayImageFor(skin)
  if (!image.isEmpty()) tray.setImage(image)
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
