import { describe, expect, it } from 'vitest'
import { validateManifest } from '@sdk/manifest'
import manifest from '../../../../src/plugins/ai-translator/manifest'
// 全量内置清单：keyword 冲突检测的事实来源（漏 import 一个插件就漏一处冲突面）
import backupManifest from '../../../../src/plugins/backup/manifest'
import batchRenameManifest from '../../../../src/plugins/batch-rename/manifest'
import calcManifest from '../../../../src/plugins/calc/manifest'
import clipboardManifest from '../../../../src/plugins/clipboard/manifest'
import devManualManifest from '../../../../src/plugins/dev-manual/manifest'
import devtoolsManifest from '../../../../src/plugins/devtools/manifest'
import diffManifest from '../../../../src/plugins/diff/manifest'
import fakeDataManifest from '../../../../src/plugins/fake-data/manifest'
import fileSearchManifest from '../../../../src/plugins/file-search/manifest'
import floatImageManifest from '../../../../src/plugins/float-image/manifest'
import helloManifest from '../../../../src/plugins/hello/manifest'
import hotSearchManifest from '../../../../src/plugins/hot-search/manifest'
import imageBedManifest from '../../../../src/plugins/image-bed/manifest'
import jsonEditorManifest from '../../../../src/plugins/json-editor/manifest'
import lanFileShareManifest from '../../../../src/plugins/lan-file-share/manifest'
import launcherManifest from '../../../../src/plugins/launcher/manifest'
import markdownNotesManifest from '../../../../src/plugins/markdown-notes/manifest'
import memoManifest from '../../../../src/plugins/memo/manifest'
import passwordVaultManifest from '../../../../src/plugins/password-vault/manifest'
import pdfToolsManifest from '../../../../src/plugins/pdf-tools/manifest'
import qrCodeManifest from '../../../../src/plugins/qr-code/manifest'
import screenshotManifest from '../../../../src/plugins/screenshot/manifest'
import textBatchManifest from '../../../../src/plugins/text-batch/manifest'
import timeToolboxManifest from '../../../../src/plugins/time-toolbox/manifest'
import todoPomodoroManifest from '../../../../src/plugins/todo-pomodoro/manifest'
import translateManifest from '../../../../src/plugins/translate/manifest'
import utoolsPortManifest from '../../../../src/plugins/utools-port/manifest'
import varNameManifest from '../../../../src/plugins/var-name/manifest'
import webQuickOpenManifest from '../../../../src/plugins/web-quick-open/manifest'

const allManifests = [
  backupManifest,
  batchRenameManifest,
  calcManifest,
  clipboardManifest,
  devManualManifest,
  devtoolsManifest,
  diffManifest,
  fakeDataManifest,
  fileSearchManifest,
  floatImageManifest,
  helloManifest,
  hotSearchManifest,
  imageBedManifest,
  jsonEditorManifest,
  lanFileShareManifest,
  launcherManifest,
  markdownNotesManifest,
  memoManifest,
  passwordVaultManifest,
  pdfToolsManifest,
  qrCodeManifest,
  screenshotManifest,
  textBatchManifest,
  timeToolboxManifest,
  todoPomodoroManifest,
  translateManifest,
  utoolsPortManifest,
  varNameManifest,
  webQuickOpenManifest
]

describe('ai-translator manifest', () => {
  it('通过协议校验（含全量内置插件在场）', () => {
    const ids = new Set(allManifests.map((m) => m.id))
    const keywords = new Map<string, string>()
    for (const m of allManifests) for (const k of m.keywords) keywords.set(k, m.id)
    expect(validateManifest(manifest, { existingIds: ids, activeKeywords: keywords })).toEqual([])
  })

  it('keywords 与聚合翻译错开：不含 翻译/fy/fanyi，与其余全部内置插件零冲突', () => {
    expect(manifest.keywords).toEqual(['aitr', 'ai翻译'])
    expect(manifest.keywords).not.toContain('翻译')
    expect(manifest.keywords).not.toContain('fy')
    expect(manifest.keywords).not.toContain('fanyi')
    const owned = new Set(allManifests.flatMap((m) => m.keywords))
    for (const k of manifest.keywords) expect(owned.has(k)).toBe(false)
  })

  it('permissions 精确 = apis:ai 代理面 + 复制 + 偏好存储', () => {
    expect(manifest.permissions).toEqual(['apis:ai', 'clipboard:write', 'storage'])
  })

  it('trigger 激活无 backend，入口与推荐 matcher 符合契约', () => {
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
    expect(manifest.id).toBe('ai-translator')
    expect(manifest.protocolVersion).toBe(1)
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.matchers).toEqual([{ type: 'text', label: '用 AI翻译翻译' }])
  })
})
