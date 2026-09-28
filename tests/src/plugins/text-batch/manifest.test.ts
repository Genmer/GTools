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
import fileSearch from '../../../../src/plugins/file-search/manifest'
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
import qrCode from '../../../../src/plugins/qr-code/manifest'
import timeToolbox from '../../../../src/plugins/time-toolbox/manifest'
import todoPomodoro from '../../../../src/plugins/todo-pomodoro/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import varName from '../../../../src/plugins/var-name/manifest'
import webQuickOpen from '../../../../src/plugins/web-quick-open/manifest'
import manifest from '../../../../src/plugins/text-batch/manifest'

const OTHERS = [
  backup,
  batchRename,
  calc,
  clipboard,
  devManual,
  devtools,
  diff,
  fakeData,
  fileSearch,
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
  qrCode,
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

describe('text-batch manifest', () => {
  it('结构合法且与全部现有内置插件 id/keyword 不冲突（装载期 loadIssues 应为空）', () => {
    expect(validateManifest(manifest, ctxWith(OTHERS))).toEqual([])
  })

  it('id 与目录名一致、trigger 无 backend、entry 约定、protocolVersion 1', () => {
    expect(manifest.id).toBe('text-batch')
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
    expect(manifest.protocolVersion).toBe(1)
    expect(manifest.source).toBe('builtin')
  })

  it('keywords 非空且与现有插件（含子命令 keyword）无精确冲突', () => {
    expect(manifest.keywords.length).toBeGreaterThan(0)
    const taken = new Set(
      OTHERS.flatMap((m) => [...m.keywords, ...(m.commands ?? []).flatMap((c) => c.keywords ?? [])])
    )
    for (const k of manifest.keywords) expect(taken.has(k)).toBe(false)
  })

  it('纯前端零权限（复制走渲染层 navigator.clipboard）', () => {
    expect(manifest.permissions).toEqual([])
  })
})
