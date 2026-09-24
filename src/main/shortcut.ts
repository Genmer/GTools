import { globalShortcut } from 'electron'
import { toElectronAccelerator, validateAccelerator } from '@sdk/shortcut-rules'

let currentElectronAccel: string | null = null

export function registerHotkey(accel: string, cb: () => void): { ok: boolean; error?: string } {
  const issue = validateAccelerator(accel, process.platform)
  if (!issue.ok) return { ok: false, error: issue.reason }
  const electronAccel = toElectronAccelerator(accel, process.platform)
  if (!globalShortcut.register(electronAccel, cb)) {
    return { ok: false, error: `快捷键 ${accel} 注册失败（可能被其他应用占用）` }
  }
  currentElectronAccel = electronAccel
  return { ok: true }
}

/** 换绑：先试注册新键，成功才注销旧键；失败保留旧绑定（应用不崩） */
export function rebindHotkey(newAccel: string, cb: () => void): { ok: boolean; error?: string } {
  const issue = validateAccelerator(newAccel, process.platform)
  if (!issue.ok) return { ok: false, error: issue.reason }
  const electronAccel = toElectronAccelerator(newAccel, process.platform)
  if (!globalShortcut.register(electronAccel, cb)) {
    return { ok: false, error: `快捷键 ${newAccel} 注册失败（可能被其他应用占用），已保留原快捷键` }
  }
  if (currentElectronAccel && currentElectronAccel !== electronAccel) {
    globalShortcut.unregister(currentElectronAccel)
  }
  currentElectronAccel = electronAccel
  return { ok: true }
}

export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll()
  currentElectronAccel = null
}
