// uTools 插件功能词条（纯逻辑，可单测）：utools:list 的 scan 产物 → 全局搜索词条。
// 激活零新通路：commandId='<dirId>/<code>' 经 activateEntry→enterPlugin→PluginViewHost 传给 utools-port 视图
import type { SearchEntry } from './matcher'

export const UTOOLS_PLUGIN_ID = 'utools-port'

/** 与主进程 utools-compat.ts 的 scan 产物同构（插件视图禁 import 主进程/渲染层跨层，各自自持形状） */
export interface UtoolsEntryFeature {
  code: string
  explain: string
  cmds: string[]
}
export interface UtoolsEntryManifest {
  name: string
  description: string
  version: string
  main: string
  logo: string
  preload?: string
  features: UtoolsEntryFeature[]
}
export interface UtoolsEntryScan {
  id: string
  manifest?: UtoolsEntryManifest
  error?: string
}

/** 每个 feature 一条词条；error 项不产词条；同 manifest 重复 code 只保留首个（key 会撞），不同目录并存可接受 */
export function buildUtoolsEntries(scans: UtoolsEntryScan[]): SearchEntry[] {
  const out: SearchEntry[] = []
  for (const scan of scans) {
    const m = scan.manifest
    if (!m) continue
    const seen = new Set<string>()
    for (const f of m.features) {
      if (seen.has(f.code)) continue
      seen.add(f.code)
      // title 取首个含 CJK 的 cmd、否则 cmds[0]、空兜底 code（全中文宿主体验）
      const title = f.cmds.find((c) => /\p{Script=Han}/u.test(c)) ?? f.cmds[0] ?? f.code
      out.push({
        key: `${UTOOLS_PLUGIN_ID}:${scan.id}/${f.code}`,
        kind: 'plugin',
        pluginId: UTOOLS_PLUGIN_ID,
        commandId: `${scan.id}/${f.code}`,
        title,
        subtitle: m.name,
        icon: '🧩',
        keywords: [m.name, ...f.cmds, f.code, f.explain].filter((k) => k !== '')
      })
    }
  }
  return out
}

/** '<dirId>/<code>' → { id, code }；目录名不含 '/'，按首个 '/' 切分无歧义；无斜杠/空段返回 null */
export function parseUtoolsCommandId(v: string): { id: string; code: string } | null {
  const i = v.indexOf('/')
  if (i <= 0 || i === v.length - 1) return null
  return { id: v.slice(0, i), code: v.slice(i + 1) }
}
