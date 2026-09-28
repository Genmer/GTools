import { reactive } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import { SETTINGS_PLUGIN_ID } from '../core/entries'
import type { MatchFile } from '../core/recommend'

export type Mode = 'global' | 'plugin' | 'settings'

interface RouterState {
  mode: Mode
  query: string
  activePluginId: string | null
  initialCommand: string | null
  /** 拖拽携参进入插件时携带的文件列表（如拖 PDF 进 pdf-tools）；清理点见 syncMode/enterPlugin/resetForShow */
  initialPayload: MatchFile[] | null
}

export const router = reactive<RouterState>({
  mode: 'global',
  query: '',
  activePluginId: null,
  initialCommand: null,
  initialPayload: null
})

/** "kw rest" 形态（keyword 后必须跟空格）才进入插件模式，避免输入中途劫持候选列表 */
export function keywordMatch(query: string, manifests: PluginManifest[]): PluginManifest | null {
  for (const m of manifests) {
    if (m.keywords.some((k) => query === `${k} ` || query.startsWith(`${k} `))) return m
  }
  return null
}

export function restOf(query: string, manifests: PluginManifest[]): string {
  const m = keywordMatch(query, manifests)
  if (!m) return query
  const kw = m.keywords.find((k) => query === `${k} ` || query.startsWith(`${k} `)) ?? ''
  return query.slice(kw.length + 1)
}

/** query 或插件启用集变化后重算模式（settings 模式只由 Esc 退出） */
export function syncMode(manifests: PluginManifest[]): void {
  if (router.mode === 'settings') return
  const hit = keywordMatch(router.query, manifests)
  if (hit) {
    // 手输关键字进入插件态不经 enterPlugin、不带 payload，须清残留；
    // 条件必要：enterPlugin 先置 mode='plugin'，query watcher 后跑的 syncMode 不得误清刚携入的 payload
    if (router.mode !== 'plugin') router.initialPayload = null
    router.mode = 'plugin'
    router.activePluginId = hit.id
  } else if (router.mode === 'plugin') {
    router.mode = 'global'
    router.activePluginId = null
    router.initialCommand = null
    router.initialPayload = null
  }
}

export function enterSettings(): void {
  router.mode = 'settings'
  router.activePluginId = null
  router.initialCommand = null
}

export function enterPlugin(
  id: string,
  manifests: PluginManifest[],
  initialCommand?: string,
  rest = '',
  payload?: MatchFile[]
): void {
  const m = manifests.find((x) => x.id === id)
  if (!m) return
  router.query = rest === '' ? `${m.keywords[0]} ` : `${m.keywords[0]} ${rest}`
  router.mode = 'plugin'
  router.activePluginId = id
  router.initialCommand = initialCommand ?? null
  // 无条件覆盖：exitLevel 直改字段退插件不经 syncMode，残留靠此处清掉；不带参即置 null
  router.initialPayload = payload ?? null
}

export function isSettingsEntry(pluginId: string): boolean {
  return pluginId === SETTINGS_PLUGIN_ID
}

/** 重新唤起：清空输入回 global；插件/设置态默认保留现场（force=true 才强制重置） */
export function resetForShow(force = false): void {
  if (!force && (router.mode === 'plugin' || router.mode === 'settings')) return
  router.query = ''
  router.mode = 'global'
  router.activePluginId = null
  router.initialCommand = null
  router.initialPayload = null
}
