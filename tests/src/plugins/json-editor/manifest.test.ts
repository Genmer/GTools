import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import backup from '../../../../src/plugins/backup/manifest'
import batchRename from '../../../../src/plugins/batch-rename/manifest'
import calc from '../../../../src/plugins/calc/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devManual from '../../../../src/plugins/dev-manual/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import diff from '../../../../src/plugins/diff/manifest'
import fakeData from '../../../../src/plugins/fake-data/manifest'
import floatImage from '../../../../src/plugins/float-image/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import hotSearch from '../../../../src/plugins/hot-search/manifest'
import imageBed from '../../../../src/plugins/image-bed/manifest'
import lanFileShare from '../../../../src/plugins/lan-file-share/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import markdownNotes from '../../../../src/plugins/markdown-notes/manifest'
import passwordVault from '../../../../src/plugins/password-vault/manifest'
import todoPomodoro from '../../../../src/plugins/todo-pomodoro/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import varName from '../../../../src/plugins/var-name/manifest'
import webQuickOpen from '../../../../src/plugins/web-quick-open/manifest'
import manifest from '../../../../src/plugins/json-editor/manifest'

const existing = [
  backup,
  batchRename,
  calc,
  clipboard,
  devManual,
  devtools,
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
  varName,
  webQuickOpen
]

function ctxWith(list: typeof existing): ValidateContext {
  return {
    existingIds: new Set(list.map((m) => m.id)),
    activeKeywords: new Map(list.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('json-editor manifest', () => {
  it('结构合法且与全部现有内置插件 id/keyword 不冲突', () => {
    expect(validateManifest(manifest, ctxWith(existing))).toEqual([])
  })

  it('id 与目录名一致、trigger 无 backend、入口固定、首键为 json', () => {
    expect(manifest.id).toBe('json-editor')
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.protocolVersion).toBe(1)
    expect(manifest.source).toBe('builtin')
    expect(manifest.keywords[0]).toBe('json')
  })

  it('keywords 非空且与现有插件无精确冲突', () => {
    expect(manifest.keywords.length).toBeGreaterThan(0)
    const taken = new Set(existing.flatMap((m) => m.keywords))
    for (const k of manifest.keywords) expect(taken.has(k)).toBe(false)
  })

  it('permissions 只声明用到的能力（storage 草稿 + clipboard:write 复制）', () => {
    expect(manifest.permissions).toEqual(['storage', 'clipboard:write'])
    for (const p of manifest.permissions) expect((ALL_PERMISSIONS as readonly string[]).includes(p)).toBe(true)
  })
})
