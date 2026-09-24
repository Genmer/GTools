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
  const isDarwin = process.platform === 'darwin'
  const primaryName = isDarwin ? 'trayTemplate.png' : 'tray.png'
  let image = nativeImage.createFromPath(resolveIconPath(primaryName))

  // macOS 容错降级至彩色托盘，双重缺失回退空图保证不阻塞启动
  if (image.isEmpty() && isDarwin) {
    image = nativeImage.createFromPath(resolveIconPath('tray.png'))
  }
  if (image.isEmpty()) {
    image = nativeImage.createEmpty()
  } else if (isDarwin) {
    image.setTemplateImage(true)
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
