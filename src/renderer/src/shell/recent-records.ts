// 最近打开记录的纯逻辑（从 App.vue 抽出供单测）：旧数据归一、同键去重顶置、截断与最近行装配
import { DEMO_APPS, DEMO_RECENT_COUNT, type RecentTile } from './app-grid'
import type { PluginManifest } from '@sdk/manifest'

export type RecentRecord =
  | { kind: 'plugin'; pluginId: string; commandId?: string; at: number }
  | { kind: 'app'; appId: string; at: number }

export const RECENT_MAX = 9

/** 去重键：插件按 pluginId+commandId（缺省 _main），应用按 appId */
export function recentKey(r: RecentRecord): string {
  return r.kind === 'app' ? `a:${r.appId}` : `p:${r.pluginId}:${r.commandId ?? '_main'}`
}

/** localStorage 原文 → 记录列表：坏 JSON/非数组返回 []，单条脏数据跳过；旧数据无 kind 按插件解读 */
export function parseRecentRecords(raw: string | null): RecentRecord[] {
  let arr: unknown
  try {
    arr = JSON.parse(raw ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const atOf = (e: Record<string, unknown>): number => (typeof e.at === 'number' ? e.at : 0)
  return arr
    .map((x): RecentRecord | null => {
      if (typeof x !== 'object' || x === null) return null
      const e = x as Record<string, unknown>
      if (e.kind === 'app') {
        return typeof e.appId === 'string' && e.appId !== '' ? { kind: 'app', appId: e.appId, at: atOf(e) } : null
      }
      return typeof e.pluginId === 'string' && e.pluginId !== ''
        ? {
            kind: 'plugin',
            pluginId: e.pluginId,
            commandId: typeof e.commandId === 'string' ? e.commandId : undefined,
            at: atOf(e)
          }
        : null
    })
    .filter((x): x is RecentRecord => x !== null)
}

/** 打开一次：同键旧记录移除、新记录顶到最前（时间由调用方注入保持纯函数），截断 RECENT_MAX */
export function pushRecent(records: readonly RecentRecord[], next: RecentRecord): RecentRecord[] {
  const key = recentKey(next)
  return [next, ...records.filter((r) => recentKey(r) !== key)].slice(0, RECENT_MAX)
}

/** appsMode 最近行装配：插件+应用按时间混合去重；应用须仍在列表、插件须启用；demo 态补示例行 */
export function buildRecentTiles(
  records: readonly RecentRecord[],
  opts: { manifests: PluginManifest[]; apps: { id: string; name: string; icon?: string }[]; demo?: boolean }
): RecentTile[] {
  const out: RecentTile[] = []
  const seen = new Set<string>()
  const pushApp = (appId: string): void => {
    const a = opts.apps.find((x) => x.id === appId)
    if (!a) return // 已卸载的应用不再出现
    const key = `a:${a.id}`
    if (seen.has(key)) return
    out.push({ key, kind: 'app', title: a.name, icon: a.icon, appId: a.id })
    seen.add(key)
  }
  for (const r of records) {
    if (r.kind === 'app') {
      pushApp(r.appId)
      continue
    }
    const m = opts.manifests.find((x) => x.id === r.pluginId)
    if (!m) continue
    const key = `p:${r.pluginId}:${r.commandId ?? '_main'}`
    if (seen.has(key)) continue
    const cmd = (m.commands ?? []).find((c) => c.id === r.commandId)
    out.push({ key, kind: 'plugin', title: cmd ? cmd.title : m.name, icon: m.icon, pluginId: r.pluginId, commandId: r.commandId })
    seen.add(key)
  }
  // demo 态补示例最近行（真实记录排在其前）
  if (opts.demo) for (let i = 0; i < Math.min(DEMO_RECENT_COUNT, DEMO_APPS.length); i++) pushApp(DEMO_APPS[i].id)
  return out.slice(0, RECENT_MAX)
}
