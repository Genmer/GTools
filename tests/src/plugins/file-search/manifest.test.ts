import { describe, expect, it } from 'vitest'
import { validateManifest, type ValidateContext } from '../../../../sdk/manifest'
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
import jsonEditor from '../../../../src/plugins/json-editor/manifest'
import lanFileShare from '../../../../src/plugins/lan-file-share/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import markdownNotes from '../../../../src/plugins/markdown-notes/manifest'
import memo from '../../../../src/plugins/memo/manifest'
import passwordVault from '../../../../src/plugins/password-vault/manifest'
import pdfTools from '../../../../src/plugins/pdf-tools/manifest'
import timeToolbox from '../../../../src/plugins/time-toolbox/manifest'
import todoPomodoro from '../../../../src/plugins/todo-pomodoro/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import varName from '../../../../src/plugins/var-name/manifest'
import webQuickOpen from '../../../../src/plugins/web-quick-open/manifest'
import manifest from '../../../../src/plugins/file-search/manifest'

const OTHERS = [
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
  jsonEditor,
  lanFileShare,
  launcher,
  markdownNotes,
  memo,
  passwordVault,
  pdfTools,
  timeToolbox,
  todoPomodoro,
  translate,
  varName,
  webQuickOpen
]

function ctxWith(existing: typeof OTHERS): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('file-search manifest', () => {
  it('结构合法且与全部现有内置插件不冲突', () => {
    expect(validateManifest(manifest, ctxWith(OTHERS))).toEqual([])
  })

  it('触发词不与现有插件/子命令 keyword 重复', () => {
    const taken = new Set(
      OTHERS.flatMap((m) => [...m.keywords, ...(m.commands ?? []).flatMap((c) => c.keywords ?? [])])
    )
    for (const k of manifest.keywords) expect(taken.has(k)).toBe(false)
  })

  it('id 与目录名一致；trigger 型带 backend（跑 mdfind 的常驻轮询）合法', () => {
    expect(manifest.id).toBe('file-search')
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBe('./backend/index.ts')
    expect(manifest.protocolVersion).toBe(1)
  })

  it('声明的权限与功能一一对应（无冗余权限）', () => {
    expect(new Set(manifest.permissions)).toEqual(new Set(['storage', 'shell:open', 'window:hide', 'clipboard:write', 'notification']))
  })
})
