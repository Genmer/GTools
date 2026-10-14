import { BrowserWindow, app, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { utimes } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppLogoSkin } from '@sdk/settings'

let currentSkin: AppLogoSkin = 'black'

function resolveLogoPath(fileName: string): string {
  return app.isPackaged
    ? join(process.resourcesPath, fileName)
    : join(app.getAppPath(), 'resources', fileName)
}

/** win32 建窗时的 icon 参数；资产缺失返回 null 走 Electron 默认图标 */
export function logoIconPath(): string | null {
  const p = resolveLogoPath(currentSkin === 'white' ? 'logo-white.png' : 'logo-black.png')
  return nativeImage.createFromPath(p).isEmpty() ? null : p
}

/** 获取当前应用对应的 macOS .app 目录路径（打包态从可执行路径反推，开发态兜底系统安装路径） */
export function resolveAppBundlePath(): string | null {
  if (process.platform !== 'darwin') return null
  if (app.isPackaged) {
    const bundle = dirname(dirname(dirname(process.execPath)))
    if (bundle.endsWith('.app')) return bundle
  }
  const defaultInstalled = '/Applications/GTools.app'
  if (existsSync(defaultInstalled)) return defaultInstalled
  return null
}

export type MacBundleIconRunner = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>

const defaultRunner: MacBundleIconRunner = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, args, (err, stdout, stderr) => {
      if (err) reject(err)
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })

/**
 * macOS 访达与启动台应用包（.app）图标切换：
 * - white：写入白底高精度 icns 资产（或降级 png），设置 kHasCustomIcon 与 Icon\r 文件
 * - black：传入 nil 清除自定义图标，自动恢复 Info.plist 声明的默认黑底 icon.icns
 */
export async function applyMacBundleIcon(
  skin: AppLogoSkin,
  opts?: { targetBundle?: string; runner?: MacBundleIconRunner }
): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const bundlePath = opts?.targetBundle ?? resolveAppBundlePath()
  if (!bundlePath || !existsSync(bundlePath)) return false

  const runner = opts?.runner ?? defaultRunner
  const icnsPath = resolveLogoPath('logo-white.icns')
  const pngPath = resolveLogoPath('logo-white.png')
  const iconPath =
    skin === 'white'
      ? existsSync(pngPath) && !existsSync(icnsPath)
        ? pngPath
        : icnsPath
      : null

  const imgExpr = iconPath
    ? `$.NSImage.alloc.initWithContentsOfFile(${JSON.stringify(iconPath)})`
    : '$.nil'

  const script = `
    ObjC.import("AppKit");
    const ws = $.NSWorkspace.sharedWorkspace;
    const target = ${JSON.stringify(bundlePath)};
    const img = ${imgExpr};
    const ok = ws.setIconForFileOptions(img, target, 0);
    if (ok) ws.noteFileSystemChanged(target);
    ok;
  `

  try {
    const { stdout } = await runner('osascript', ['-l', 'JavaScript', '-e', script])
    const ok = stdout.trim() === 'true'
    if (ok) {
      await utimes(bundlePath, new Date(), new Date()).catch(() => {})
    }
    return ok
  } catch {
    return false
  }
}

/** 运行时切换 logo 底色：win32 改全部窗口/任务栏图标，darwin 写 Dock 与 .app Bundle 图标 */
export function applyAppLogoSkin(skin: AppLogoSkin): void {
  currentSkin = skin
  const path = logoIconPath()
  if (path) {
    if (process.platform === 'darwin') {
      app.dock?.setIcon(path)
    } else if (process.platform === 'win32') {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.setIcon(path)
      }
    }
  }
  if (process.platform === 'darwin') {
    void applyMacBundleIcon(skin).catch(() => {})
  }
}
