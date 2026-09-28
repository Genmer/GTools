/** electron.App 的最小结构面，测试可直接注入；OS 写入异常不在此吞掉，由调用方决定如何呈现 */
export interface LoginItemApp {
  isPackaged: boolean
  getLoginItemSettings(): { openAtLogin: boolean }
  setLoginItemSettings(s: { openAtLogin: boolean }): void
}

export type LoginItemSyncResult = 'applied' | 'noop' | 'skipped-dev'

/**
 * 未打包时 process.execPath 是 electron.exe，写登录项会把开发壳注册进系统启动，必须跳过；
 * OS 态已一致时 no-op，避免每次启动反复写注册表/SMAppService
 */
export function syncLoginItem(app: LoginItemApp, want: boolean): LoginItemSyncResult {
  if (!app.isPackaged) return 'skipped-dev'
  if (app.getLoginItemSettings().openAtLogin === want) return 'noop'
  app.setLoginItemSettings({ openAtLogin: want })
  return 'applied'
}
