import type { PluginManifest } from '@sdk/manifest'
import { restOf, router } from './router-core'

// 纯状态机在 router-core（不含 DOM 依赖，可进 node 单测程序）；此处只补窗口侧出口并统一再导出
export { router, keywordMatch, restOf, syncMode, enterSettings, enterPlugin, isSettingsEntry, resetForShow } from './router-core'
export type { Mode } from './router-core'

/** Esc 逐级退出：settings → global，plugin → global（清 keyword 留 rest），global 有内容先清空、空才隐藏窗口 */
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
  // 两段式（对齐 uTools）：global 有内容先清空留窗，再按一次 Esc 才隐藏
  if (router.query.trim() !== '') {
    router.query = ''
    return
  }
  void window.gtools.host('window:hide')
}
