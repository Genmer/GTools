// settings:set 结果信封契约（主进程 ipc.ts HostResult）：warnings 挂信封顶层，data 是 AppSettings 本身（无 warnings 字段）
export interface SettingsSetResult {
  ok: boolean
  data?: unknown
  error?: string
  warnings?: string[]
}

/** 提取保存已生效但个别热键注册失败的部分生效警告；字段缺失或形状不对一律按无警告 */
export function warningsOf(result: unknown): string[] {
  if (typeof result !== 'object' || result === null) return []
  const w = (result as { warnings?: unknown }).warnings
  return Array.isArray(w) ? w.filter((x): x is string => typeof x === 'string') : []
}
