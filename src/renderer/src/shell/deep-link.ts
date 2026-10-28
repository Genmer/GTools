import type { PluginManifest } from '@sdk/manifest'
import { enterPlugin } from './router-core'

export interface DeepLink {
  pluginId: string
  query: string
  demo: boolean
  isDetached: boolean
  isFlyout: boolean
}

/**
 * 解析 hash 深链（截图/自动化/独立窗口/剪贴板飞窗入口）：
 * '#plugin=<id>&q=<query>&demo=1'、独立窗口 '#detached=true&plugin=<id>&query=<q>'、飞窗 '#clipboard-flyout=1'。
 * 仅 '#demo=1'/'#clipboard-flyout=1'（无 plugin）也合法：demo 态注入示例应用，飞窗态渲染剪贴板卡片，pluginId 为空串。
 * 值一律 decodeURIComponent，'+' 不当空格（计算式查询里是真实加号）。
 */
export function parseDeepLink(hash: string): DeepLink | null {
  const h = hash.replace(/^#/, '')
  if (
    !h.startsWith('plugin=') &&
    !h.startsWith('demo=') &&
    !h.startsWith('detached=') &&
    !h.startsWith('clipboard-flyout=')
  )
    return null
  const params = new Map<string, string>()
  for (const part of h.split('&')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const raw = part.slice(eq + 1)
    let v = raw
    try {
      v = decodeURIComponent(raw)
    } catch {
      // 非法百分号序列按原文保留，不让整个链接失效
    }
    params.set(part.slice(0, eq), v)
  }
  const demo = (params.get('demo') ?? '').toLowerCase()
  const demoOn = demo === '1' || demo === 'true'
  const detachedRaw = (params.get('detached') ?? '').toLowerCase()
  const detachedOn = detachedRaw === '1' || detachedRaw === 'true'
  const flyoutRaw = (params.get('clipboard-flyout') ?? '').toLowerCase()
  const flyoutOn = flyoutRaw === '1' || flyoutRaw === 'true'
  const pluginId = params.get('plugin') ?? ''
  if (pluginId === '' && !demoOn && !flyoutOn) return null
  return {
    pluginId,
    query: params.get('query') ?? params.get('q') ?? '',
    demo: demoOn,
    isDetached: detachedOn,
    isFlyout: flyoutOn
  }
}

/** 命中启用插件则进入其视图（demo=1 → initialCommand='demo'），未命中返回 false */
export function applyDeepLink(link: DeepLink, manifests: PluginManifest[]): boolean {
  if (!manifests.some((m) => m.id === link.pluginId)) return false
  enterPlugin(link.pluginId, manifests, link.demo ? 'demo' : undefined, link.query)
  return true
}
