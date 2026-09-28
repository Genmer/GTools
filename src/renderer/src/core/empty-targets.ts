// 空态扁平目标与段界的纯逻辑（从 App.vue 抽出供单测锁定段序）：
// 段序两分支固定为 推荐 → 搜索历史 → 中段（最近 tiles 或插件清单）→ 应用 → 抽屉开关（仅 appsMode 末段），
// EmptyState 的 data-idx 偏移与 App.vue 的导航段界都按这段序手写累加，改动段序须三处同步
import type { RecentTile } from '../shell/app-grid'
import type { MatchFile, RecItem } from './recommend'

/** 空态键盘导航的扁平目标 */
export type EmptyTarget =
  | { kind: 'plugin'; pluginId: string; commandId?: string; payload?: string; files?: MatchFile[] }
  | { kind: 'app'; appId: string }
  | { kind: 'apps-toggle' }
  | { kind: 'history'; query: string }

interface EmptyTargetsBase {
  /** 段1 推荐行（推送+剪贴板+拖入合并去重后）：files/img 源激活时携带拖入集 */
  clipRecs: readonly RecItem[]
  /** 拖入集原样透传（引用不拷贝，与激活通路共享同一数组） */
  dropFiles: MatchFile[]
  /** 段2 搜索历史词（新→旧） */
  history: readonly string[]
}

export interface AppsModeTargetsInput extends EmptyTargetsBase {
  appsMode: true
  /** 段3 最近行 tiles（插件/应用混合，buildRecentTiles 产物） */
  recentTiles: readonly RecentTile[]
  /** 段4 可见应用（折叠切片后） */
  appIds: readonly string[]
  hasAppsToggle: boolean
}

export interface FallbackTargetsInput extends EmptyTargetsBase {
  appsMode: false
  /** 段3 启用插件 id（插件格无 command） */
  pluginIds: readonly string[]
  /** 段4 最近使用行 */
  recentRows: readonly { pluginId: string; commandId?: string }[]
}

export type EmptyTargetsInput = AppsModeTargetsInput | FallbackTargetsInput

export interface EmptySegmentOffsets {
  /** 累计段界：clipEnd=历史段起点，histEnd=中段起点，middleEnd=段4起点，appsEnd=开关格起点（非 appsMode 即 total） */
  clipEnd: number
  histEnd: number
  middleEnd: number
  appsEnd: number
  total: number
}

function clipTargets(base: EmptyTargetsBase): EmptyTarget[] {
  return base.clipRecs.map((r) => ({
    kind: 'plugin' as const,
    pluginId: r.pluginId,
    commandId: r.commandId,
    payload: r.payload,
    files: r.source === 'files' || r.source === 'img' ? base.dropFiles : undefined
  }))
}

/** 段界偏移：与 buildEmptyTargets 同一输入同一段长，导航按偏移算段界而非再手写累加 */
export function emptySegmentOffsets(input: EmptyTargetsInput): EmptySegmentOffsets {
  const clipEnd = input.clipRecs.length
  const histEnd = clipEnd + input.history.length
  if (input.appsMode) {
    const middleEnd = histEnd + input.recentTiles.length
    const appsEnd = middleEnd + input.appIds.length
    return { clipEnd, histEnd, middleEnd, appsEnd, total: appsEnd + (input.hasAppsToggle ? 1 : 0) }
  }
  const middleEnd = histEnd + input.pluginIds.length
  return { clipEnd, histEnd, middleEnd, appsEnd: middleEnd, total: middleEnd + input.recentRows.length }
}

export function buildEmptyTargets(input: EmptyTargetsInput): EmptyTarget[] {
  const clip = clipTargets(input)
  const hist: EmptyTarget[] = input.history.map((q) => ({ kind: 'history', query: q }))
  if (input.appsMode) {
    const targets: EmptyTarget[] = [
      ...clip,
      ...hist,
      // buildRecentTiles 产物保证 kind 与对应 id 字段成对出现
      ...input.recentTiles.map((t) =>
        t.kind === 'app'
          ? { kind: 'app' as const, appId: t.appId! }
          : { kind: 'plugin' as const, pluginId: t.pluginId!, commandId: t.commandId }
      ),
      ...input.appIds.map((id) => ({ kind: 'app' as const, appId: id }))
    ]
    if (input.hasAppsToggle) targets.push({ kind: 'apps-toggle' })
    return targets
  }
  return [
    ...clip,
    ...hist,
    ...input.pluginIds.map((id) => ({ kind: 'plugin' as const, pluginId: id })),
    ...input.recentRows.map((r) => ({ kind: 'plugin' as const, pluginId: r.pluginId, commandId: r.commandId }))
  ]
}
