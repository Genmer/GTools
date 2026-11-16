import { execFileSync } from 'node:child_process'
import { readFileSync, statSync, writeFileSync } from 'node:fs'

/** electron.App 的最小结构面，测试可直接注入；OS 写入异常不在此吞掉，由调用方决定如何呈现 */
export interface LoginItemApp {
  isPackaged: boolean
  getVersion(): string
  getLoginItemSettings(): { openAtLogin: boolean }
  setLoginItemSettings(s: { openAtLogin: boolean }): void
}

export type LoginItemSyncResult = 'applied' | 'noop' | 'skipped-dev'

export type MacLoginItemRunner = (cmd: string, args: string[], options: { encoding: 'utf8'; timeout: number }) => string

export interface SyncLoginItemOptions {
  platform?: NodeJS.Platform
  bundlePath?: string | null
  runner?: MacLoginItemRunner
  /** 强制刷新：want=true 时无视 hasItem 先删同名登录项再新建（可执行文件已换时的兜底） */
  forceRefresh?: boolean
}

export type LoginItemStatFn = (p: string) => { size: number; mtimeMs: number }
export type LoginItemReadFileFn = (file: string, encoding: 'utf8') => string
export type LoginItemWriteFileFn = (file: string, data: string) => void

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
  runner: MacLoginItemRunner = execFileSync,
  force = false
): LoginItemSyncResult {
  const escaped = bundlePath.replace(/"/g, '\\"')
  const script = `tell application "System Events"
set itemPath to "${escaped}"
set itemName to "GTools"
set existingItems to (every login item whose path is itemPath)
set hasItem to ((count of existingItems) > 0)
if ${want} then
if not hasItem or ${force} then
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
  const bundlePath =
    platform === 'darwin' ? (opts?.bundlePath !== undefined ? opts.bundlePath : getMacBundlePath(app)) : null
  const force = want && opts?.forceRefresh === true && bundlePath !== null
  let electronResult: LoginItemSyncResult = 'noop'

  if (force) {
    // ad-hoc 场景 SMAppService 项也按 cdhash 绑定：回读 true 可能仍绑着旧二进制（更新后失效态）。
    // 指纹变化时先清同名旧项（历史 System Events 项与旧 SMAppService 项在 BTM 里同为 type=app，一并清），
    // 再 off→on 重注册，保证刷新后恰好一条且绑当前 cdhash；也防下面的回读短路把刷新机会永久吞掉。
    // 强刷必须替代而非叠加常规写入：先 set(true) 再清再注册会让系统弹两条“将在登录时打开”通知
    syncMacLoginItem(bundlePath, false, opts?.runner)
    app.setLoginItemSettings({ openAtLogin: false })
    app.setLoginItemSettings({ openAtLogin: true })
    electronResult = 'applied'
  } else if (app.getLoginItemSettings().openAtLogin !== want) {
    app.setLoginItemSettings({ openAtLogin: want })
    electronResult = 'applied'
  }

  if (bundlePath) {
    // 择一门槛只护建项方向：want=true 且 Electron 轨（SMAppService）回读生效则不跑 System Events，防双登录项；
    // 删除方向无条件跑清理——SMAppService 与 System Events 两存储互不可见，回读一致不代表 System Events 无残留项
    // （未签名 app 的 set 静默失败、双轨时代旧项），脚本对无可删项幂等返回 noop
    if (want && app.getLoginItemSettings().openAtLogin === want) return electronResult
    const macResult = syncMacLoginItem(bundlePath, want, opts?.runner, force)
    return macResult === 'applied' || electronResult === 'applied' ? 'applied' : 'noop'
  }

  return electronResult
}

/** 登录项指纹 = 版本|可执行文件 size|mtimeMs，变化即说明二进制换过（cdhash 已变，BTM 旧登录项失配） */
export function computeLoginItemFingerprint(
  app: { getVersion(): string },
  execPath: string,
  stat: LoginItemStatFn = statSync
): string {
  const s = stat(execPath)
  return `${app.getVersion()}|${s.size}|${s.mtimeMs}`
}

/** 文件不存在/损坏/字段非 string 一律 null 不抛；指纹单独落盘，不进 settings.json */
export function readLoginItemFingerprint(file: string, readFile: LoginItemReadFileFn = readFileSync): string | null {
  try {
    const data: unknown = JSON.parse(readFile(file, 'utf8'))
    if (data !== null && typeof data === 'object' && typeof (data as { fingerprint?: unknown }).fingerprint === 'string') {
      return (data as { fingerprint: string }).fingerprint
    }
    return null
  } catch {
    return null
  }
}

export function writeLoginItemFingerprint(file: string, fp: string, writeFile: LoginItemWriteFileFn = writeFileSync): void {
  writeFile(file, JSON.stringify({ fingerprint: fp }, null, 2))
}

export interface SyncWithFingerprintOptions extends SyncLoginItemOptions {
  stat?: LoginItemStatFn
  readFile?: LoginItemReadFileFn
  writeFile?: LoginItemWriteFileFn
}

/**
 * 未签名 app 的 BTM 登录项按 cdhash 标识，装新版本即静默失效；指纹变化 → forceRefresh 先删后建 System Events 轨兜底。
 * 关闭方向纯删除不碰指纹；未打包（skipped-dev）不落指纹。
 */
export function syncLoginItemWithFingerprint(
  app: LoginItemApp,
  want: boolean,
  fingerprintFile: string,
  opts?: SyncWithFingerprintOptions
): LoginItemSyncResult {
  if (!want) return syncLoginItem(app, false, opts)
  const fp = computeLoginItemFingerprint(app, process.execPath, opts?.stat)
  const prev = readLoginItemFingerprint(fingerprintFile, opts?.readFile)
  const res = syncLoginItem(app, true, { ...opts, forceRefresh: prev !== fp })
  if (res !== 'skipped-dev') writeLoginItemFingerprint(fingerprintFile, fp, opts?.writeFile)
  return res
}
