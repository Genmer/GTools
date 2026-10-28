import { execFileSync } from 'node:child_process'

/** electron.App 的最小结构面，测试可直接注入；OS 写入异常不在此吞掉，由调用方决定如何呈现 */
export interface LoginItemApp {
  isPackaged: boolean
  getLoginItemSettings(): { openAtLogin: boolean }
  setLoginItemSettings(s: { openAtLogin: boolean }): void
}

export type LoginItemSyncResult = 'applied' | 'noop' | 'skipped-dev'

export type MacLoginItemRunner = (cmd: string, args: string[], options: { encoding: 'utf8'; timeout: number }) => string

export interface SyncLoginItemOptions {
  platform?: NodeJS.Platform
  bundlePath?: string | null
  runner?: MacLoginItemRunner
}

function getMacBundlePath(app: LoginItemApp): string | null {
  if (!app.isPackaged || process.platform !== 'darwin') return null
  const exec = process.execPath
  const idx = exec.indexOf('.app/Contents/MacOS/')
  if (idx !== -1) return exec.slice(0, idx + 4)
  return null
}

export function syncMacLoginItem(
  bundlePath: string,
  want: boolean,
  runner: MacLoginItemRunner = execFileSync
): LoginItemSyncResult {
  const escaped = bundlePath.replace(/"/g, '\\"')
  const script = `tell application "System Events"
set itemPath to "${escaped}"
set itemName to "GTools"
set existingItems to (every login item whose path is itemPath)
set hasItem to ((count of existingItems) > 0)
if ${want} then
if not hasItem then
delete (every login item whose name is itemName)
make new login item at end with properties {name:itemName, path:itemPath, hidden:false}
return "applied"
else
return "noop"
end if
else
if hasItem or ((count of (every login item whose name is itemName)) > 0) then
delete (every login item whose path is itemPath)
delete (every login item whose name is itemName)
return "applied"
else
return "noop"
end if
end if
end tell`
  const res = runner('osascript', ['-e', script], { encoding: 'utf8', timeout: 5000 })
  return res.trim() === 'applied' ? 'applied' : 'noop'
}

/**
 * 未打包时 process.execPath 是 electron.exe，跳过以防污染启动项；
 * macOS 建项方向双轨择一（SMAppService 回读生效即独占，防双登录项）；删除方向两轨都清——两存储互不可见，防 System Events 残留项。
 */
export function syncLoginItem(
  app: LoginItemApp,
  want: boolean,
  opts?: SyncLoginItemOptions
): LoginItemSyncResult {
  if (!app.isPackaged) return 'skipped-dev'

  const platform = opts?.platform ?? process.platform
  let electronResult: LoginItemSyncResult = 'noop'

  if (app.getLoginItemSettings().openAtLogin !== want) {
    app.setLoginItemSettings({ openAtLogin: want })
    electronResult = 'applied'
  }

  if (platform === 'darwin') {
    const bundlePath = opts?.bundlePath !== undefined ? opts.bundlePath : getMacBundlePath(app)
    if (bundlePath) {
      // 择一门槛只护建项方向：want=true 且 Electron 轨（SMAppService）回读生效则不跑 System Events，防双登录项；
      // 删除方向无条件跑清理——SMAppService 与 System Events 两存储互不可见，回读一致不代表 System Events 无残留项
      // （未签名 app 的 set 静默失败、双轨时代旧项），脚本对无可删项幂等返回 noop
      if (want && app.getLoginItemSettings().openAtLogin === want) return electronResult
      const macResult = syncMacLoginItem(bundlePath, want, opts?.runner)
      return macResult === 'applied' || electronResult === 'applied' ? 'applied' : 'noop'
    }
  }

  return electronResult
}
