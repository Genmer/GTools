import type { PluginManifest } from '@sdk/manifest'
import { restOf, router } from './router-core'

// 纯状态机在 router-core（不含 DOM 依赖，可进 node 单测程序）；此处只补窗口侧出口并统一再导出
export { router, keywordMatch, restOf, syncMode, enterSettings, enterPlugin, isSettingsEntry, resetForShow } from './router-core'
export type { Mode } from './router-core'

/** Esc 逐级退出：settings → global，plugin → global（清 keyword 留 rest），global → 隐藏窗口 */
export function exitLevel(manifests: PluginManifest[]): void {
  if (router.mode === 'settings') {
    router.mode = 'global'
    router.query = ''
    return
  }
  if (router.mode === 'plugin') {
    const rest = restOf(router.query, manifests)
    router.mode = 'global'
    router.activePluginId = null
    router.initialCommand = null
    router.query = rest
    return
  }
  void window.gtools.host('window:hide')
}
