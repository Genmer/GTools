// 崩溃自动重载策略：60 秒滑动窗内最多 3 次，超限放弃（防崩溃循环 reload 风暴）
export interface ReloadDecision {
  reload: boolean
  /** 清出窗外旧时间戳并记入本次 now 后的新历史，调用方整体替换旧数组 */
  history: number[]
}

const WINDOW_MS = 60_000
const MAX_RELOADS = 3

export function decideAutoReload(history: number[], now: number): ReloadDecision {
  const floor = now - WINDOW_MS
  const recent = history.filter((t) => t >= floor)
  return { reload: recent.length < MAX_RELOADS, history: [...recent, now] }
}
