import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import type { PluginManifest } from '@sdk/manifest'
import backup from '../../../../src/plugins/backup/manifest'
import batchRename from '../../../../src/plugins/batch-rename/manifest'
import calc from '../../../../src/plugins/calc/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devManual from '../../../../src/plugins/dev-manual/manifest'
import diff from '../../../../src/plugins/diff/manifest'
import fakeData from '../../../../src/plugins/fake-data/manifest'
import floatImage from '../../../../src/plugins/float-image/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import hotSearch from '../../../../src/plugins/hot-search/manifest'
import imageBed from '../../../../src/plugins/image-bed/manifest'
import lanFileShare from '../../../../src/plugins/lan-file-share/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import markdownNotes from '../../../../src/plugins/markdown-notes/manifest'
import manifest from '../../../../src/plugins/devtools/manifest'
import passwordVault from '../../../../src/plugins/password-vault/manifest'
import todoPomodoro from '../../../../src/plugins/todo-pomodoro/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import webQuickOpen from '../../../../src/plugins/web-quick-open/manifest'

const EXISTING: PluginManifest[] = [
  backup,
  batchRename,
  calc,
  clipboard,
  devManual,
  diff,
  fakeData,
  floatImage,
  hello,
  hotSearch,
  imageBed,
  lanFileShare,
  launcher,
  markdownNotes,
  passwordVault,
  todoPomodoro,
  translate,
  webQuickOpen
]

function ctxWith(existing: PluginManifest[]): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('devtools manifest', () => {
  it('结构合法且与现有全部内置插件不冲突', () => {
    expect(validateManifest(manifest, ctxWith(EXISTING))).toEqual([])
  })

  it('id 与目录名一致，trigger 无 backend，权限均合法', () => {
    expect(manifest.id).toBe('devtools')
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
    expect(manifest.source).toBe('builtin')
    for (const p of manifest.permissions) expect(ALL_PERMISSIONS).toContain(p)
  })

  it('7 个子工具 command id 唯一且 title 非空', () => {
    expect(manifest.commands).toHaveLength(7)
    const ids = manifest.commands?.map((c) => c.id) ?? []
    expect(new Set(ids).size).toBe(7)
    for (const c of manifest.commands ?? []) expect(c.title.length).toBeGreaterThan(0)
  })
})
