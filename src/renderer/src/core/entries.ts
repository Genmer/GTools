import type { PluginManifest } from '@sdk/manifest'
import type { SearchEntry } from './matcher'

export const SETTINGS_PLUGIN_ID = '__settings__'

const COMMON_APP_ALIASES: Record<string, string[]> = {
  'com.tencent.xinWeChat': ['wechat', 'wx'],
  'com.tencent.qq': ['qq', 'txqq'],
  'com.alibaba.DingTalk': ['dingtalk', 'dd'],
  'com.electron.lark': ['lark', 'feishu', 'fs'],
  'com.google.Chrome': ['chrome', 'gc', 'browser'],
  'com.microsoft.VSCode': ['vscode', 'code', 'editor'],
  'com.netease.163music': ['music', 'wyy', 'cloudmusic'],
  'ru.keepcoder.Telegram': ['tg', 'telegram'],
  'com.apple.Safari': ['safari', 'browser'],
  'com.apple.Terminal': ['terminal', 'term', 'zsh', 'bash'],
  'com.apple.iWork.Pages': ['pages', 'word', 'doc'],
  'com.apple.iWork.Numbers': ['numbers', 'excel', 'sheet'],
  'com.apple.iWork.Keynote': ['keynote', 'ppt', 'presentation'],
  'com.apple.calculator': ['calc', 'calculator', 'jisuanqi', 'jsq'],
  'com.apple.SystemPreferences': ['settings', 'preferences', 'xitongshezhi', 'sz']
}

export interface AppInputItem {
  id: string
  name: string
  path: string
  bundleId?: string
  icon?: string
}

/** 本机应用检索词条：提取别名、BundleId 末段与英文分词作为检索关键词 */
export function buildAppEntries(apps: AppInputItem[]): SearchEntry[] {
  return apps.map((a) => {
    const kws = new Set<string>()
    const aliases = COMMON_APP_ALIASES[a.id] || (a.bundleId ? COMMON_APP_ALIASES[a.bundleId] : undefined)
    if (aliases) {
      for (const alias of aliases) kws.add(alias.toLowerCase())
    }
    const bid = a.bundleId || a.id
    const seg = bid.split('.').pop()
    if (seg) {
      kws.add(seg.toLowerCase())
      const words = seg.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ')
      for (const w of words) if (w.length > 1) kws.add(w)
    }
    const nameWords = a.name.toLowerCase().split(/[\s\-_]+/)
    for (const w of nameWords) if (w.length > 1) kws.add(w)

    return {
      key: `app:${a.id}`,
      kind: 'app' as const,
      appId: a.id,
      title: a.name,
      subtitle: '应用',
      icon: a.icon || '',
      keywords: Array.from(kws)
    }
  })
}

/** 宿主词条 + 各插件 main/command 词条的统一装配（仅启用插件进入词条池） */
export function buildEntries(plugins: { manifest: PluginManifest; enabled: boolean }[]): SearchEntry[] {
  const entries: SearchEntry[] = [
    {
      key: 'host:settings',
      kind: 'plugin',
      title: '设置',
      subtitle: '快捷键、主题与插件管理',
      icon: '⚙️',
      pluginId: SETTINGS_PLUGIN_ID,
      keywords: ['settings', 'shezhi', 'sz']
    }
  ]
  for (const { manifest, enabled } of plugins) {
    if (!enabled) continue
    entries.push({
      key: `${manifest.id}:_main`,
      kind: 'plugin',
      title: manifest.name,
      subtitle: manifest.description,
      icon: manifest.icon,
      pluginId: manifest.id,
      keywords: manifest.keywords
    })
    for (const cmd of manifest.commands ?? []) {
      entries.push({
        key: `${manifest.id}:${cmd.id}`,
        kind: 'plugin',
        title: cmd.title,
        subtitle: manifest.name,
        icon: manifest.icon,
        pluginId: manifest.id,
        commandId: cmd.id,
        keywords: cmd.keywords
      })
    }
  }
  return entries
}
