import type { AppSettings } from '@sdk/settings'
import type { BackupFile } from './format'
import { canonicalJson } from './format'

export type PluginDiffStatus = 'new' | 'update' | 'same'

export interface PluginDiff {
  pluginId: string
  status: PluginDiffStatus
  /** 本地没有、导入会新增的 key */
  added: string[]
  /** 本地已有但值不同、导入会覆盖的 key */
  overwritten: string[]
  /** 本地已有且值相同、写不写都无差别的 key */
  unchangedCount: number
}

export interface SettingsChange {
  field: string
  label: string
  before: string
  after: string
}

export interface ImportPlan {
  plugins: PluginDiff[]
  settingsChanges: SettingsChange[]
  warnings: string[]
  /** 内容有实际变化、需要写盘的插件数 */
  pluginsToWrite: number
  keysToWrite: number
  settingsWillChange: boolean
}

function listDiff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before)
  const a = new Set(after)
  return {
    added: after.filter((x) => !b.has(x)),
    removed: before.filter((x) => !a.has(x))
  }
}

export function settingsChangesBetween(before: AppSettings, after: AppSettings): SettingsChange[] {
  const changes: SettingsChange[] = []
  if (before.theme !== after.theme) {
    changes.push({ field: 'theme', label: '主题', before: before.theme, after: after.theme })
  }
  for (const p of ['darwin', 'win32'] as const) {
    if (before.hotkey[p] !== after.hotkey[p]) {
      changes.push({
        field: `hotkey.${p}`,
        label: p === 'darwin' ? '快捷键 (macOS)' : '快捷键 (Windows)',
        before: before.hotkey[p],
        after: after.hotkey[p]
      })
    }
  }
  const d = listDiff(before.disabledPlugins, after.disabledPlugins)
  if (d.added.length > 0 || d.removed.length > 0) {
    changes.push({
      field: 'disabledPlugins',
      label: '插件启禁',
      before: before.disabledPlugins.join('、') || '（全部启用）',
      after: after.disabledPlugins.join('、') || '（全部启用）'
    })
  }
  return changes
}

/** 导入预览：备份 vs 本地当前数据，逐插件列新增/覆盖，设置列字段级变化 */
export function buildImportPlan(
  backup: Pick<BackupFile, 'settings' | 'pluginStorage'>,
  current: { settings: AppSettings; pluginStorage: Record<string, Record<string, unknown>> },
  extraWarnings: string[] = []
): ImportPlan {
  const plugins: PluginDiff[] = []
  let pluginsToWrite = 0
  let keysToWrite = 0

  for (const [pid, kv] of Object.entries(backup.pluginStorage)) {
    const local = current.pluginStorage[pid]
    if (local === undefined) {
      const added = Object.keys(kv)
      plugins.push({ pluginId: pid, status: 'new', added, overwritten: [], unchangedCount: 0 })
      pluginsToWrite++
      keysToWrite += added.length
      continue
    }
    const added: string[] = []
    const overwritten: string[] = []
    let unchangedCount = 0
    for (const [k, v] of Object.entries(kv)) {
      if (!(k in local)) added.push(k)
      else if (canonicalJson(local[k]) === canonicalJson(v)) unchangedCount++
      else overwritten.push(k)
    }
    const status: PluginDiffStatus = added.length === 0 && overwritten.length === 0 ? 'same' : 'update'
    plugins.push({ pluginId: pid, status, added, overwritten, unchangedCount })
    if (status === 'update') {
      pluginsToWrite++
      keysToWrite += added.length + overwritten.length
    }
  }

  // 本地有数据但备份里没有的插件：不删除本地数据，只在提示里说明
  const warnings = [...extraWarnings]
  const orphans = Object.keys(current.pluginStorage).filter((pid) => backup.pluginStorage[pid] === undefined)
  if (orphans.length > 0) {
    warnings.push(`本机独有、备份中不含数据的插件（保留不动）：${orphans.join('、')}`)
  }

  const settingsChanges = settingsChangesBetween(current.settings, backup.settings)
  plugins.sort((a, b) => {
    const rank = (s: PluginDiffStatus): number => (s === 'update' ? 0 : s === 'new' ? 1 : 2)
    return rank(a.status) - rank(b.status) || a.pluginId.localeCompare(b.pluginId)
  })

  return {
    plugins,
    settingsChanges,
    warnings,
    pluginsToWrite,
    keysToWrite,
    settingsWillChange: settingsChanges.length > 0
  }
}
