import type { ManualDoc, ManualEntry, RawEntry } from './types'
import linux from './linux'
import git from './git'
import http from './http'
import regex from './regex'
import vscode from './vscode'

function toDoc(id: string, label: string, icon: string, raws: RawEntry[]): ManualDoc {
  return {
    id,
    label,
    icon,
    entries: raws.map((r) => ({
      id: `${id}:${r.slug}`,
      manualId: id,
      name: r.name,
      summary: r.summary,
      keywords: r.keywords ?? [],
      copyText: r.copyText,
      meta: r.meta,
      md: r.md
    }))
  }
}

export const MANUALS: ManualDoc[] = [
  toDoc('linux', 'Linux 命令', '🐧', linux),
  toDoc('git', 'Git 操作', '🌳', git),
  toDoc('http', 'HTTP 状态码', '🌐', http),
  toDoc('regex', '正则语法', '🔍', regex),
  toDoc('vscode', 'VSCode 快捷键', '⌨️', vscode)
]

export const ALL_ENTRIES: ManualEntry[] = MANUALS.flatMap((m) => m.entries)

export const ENTRY_BY_ID: ReadonlyMap<string, ManualEntry> = new Map(ALL_ENTRIES.map((e) => [e.id, e]))

export function manualLabelOf(entry: ManualEntry): string {
  return MANUALS.find((m) => m.id === entry.manualId)?.label ?? entry.manualId
}
