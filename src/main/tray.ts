import { Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'node:path'
import { showSearchWindow } from './window'

let tray: Tray | null = null

function resolveIconPath(fileName: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, fileName)
    : join(app.getAppPath(), 'resources', fileName)
}

/** 无 Dock/任务栏常驻时，托盘是唯一显式退出入口 */
export function createTray(onOpenSettings: () => void): Tray {
  // 彩色渐变 logo 不适合 Template 化（16px 剪影糊成团），全平台统一彩色托盘
  let image = nativeImage.createFromPath(resolveIconPath('tray.png'))
  if (image.isEmpty()) {
    image = nativeImage.createFromPath(resolveIconPath('tray@2x.png'))
  }
  if (image.isEmpty()) {
    image = nativeImage.createEmpty()
  }

  tray = new Tray(image)
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

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
