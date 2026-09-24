// 复制密码后的延时剪贴板清空。挂在模块作用域而非组件内：宿主窗口隐藏/切插件会卸载视图，组件内定时器会被清掉
import type { HostApi } from '@sdk/api'

export const CLEAR_DELAY_MS = 30_000

export interface ClearScheduler {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

const defaultScheduler: ClearScheduler = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>)
}

interface PendingClear {
  timerId: unknown
  text: string
  scheduler: ClearScheduler
}

const pending: PendingClear[] = []

export function pendingClearCount(): number {
  return pending.length
}

export function cancelAllPendingClears(): void {
  for (const p of pending) p.scheduler.clearTimeout(p.timerId)
  pending.length = 0
}

/** 到期动作：剪贴板仍是本次复制的密码才清空；读取失败按仍含密码处理直接清（Windows 下剪贴板可能被其他进程占用导致读失败，该分支未实测） */
export async function resolveClear(host: HostApi, text: string): Promise<'cleared' | 'skipped'> {
  try {
    const current = await host.clipboard.readText()
    if (current !== text) return 'skipped'
  } catch {
    // 读失败：宁可清空也不冒密码残留风险
  }
  await host.clipboard.writeText('')
  return 'cleared'
}

/** 复制密码后调用；用户中途复制了别的内容则到期跳过（不清掉新内容） */
export function scheduleClipboardClear(
  host: HostApi,
  text: string,
  delayMs: number = CLEAR_DELAY_MS,
  scheduler: ClearScheduler = defaultScheduler
): void {
  if (text === '') return
  const p: PendingClear = { timerId: null, text, scheduler }
  p.timerId = scheduler.setTimeout(() => {
    const i = pending.indexOf(p)
    if (i >= 0) pending.splice(i, 1)
    void resolveClear(host, text).catch(() => {})
  }, delayMs)
  pending.push(p)
}
