import { describe, expect, it } from 'vitest'
import { validateManifest, type PluginManifest, type ValidateContext } from '../../../../sdk/manifest'
import qrCode from '../../../../src/plugins/qr-code/manifest'
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
import timeToolbox from '../../../../src/plugins/time-toolbox/manifest'
import todoPomodoro from '../../../../src/plugins/todo-pomodoro/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import varName from '../../../../src/plugins/var-name/manifest'
import webQuickOpen from '../../../../src/plugins/web-quick-open/manifest'

// 全量内置清单做 keyword 冲突自查：新插件上线即被_runtime 同规则拒绝的问题在这里先行暴露
const OTHERS: PluginManifest[] = [
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
  timeToolbox,
  todoPomodoro,
  translate,
  varName,
  webQuickOpen
]

function ctxWith(existing: PluginManifest[]): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('qr-code manifest', () => {
  it('结构合法，keywords 与全部其他内置插件零冲突', () => {
    expect(validateManifest(qrCode, ctxWith(OTHERS))).toEqual([])
    const mine = new Set(qrCode.keywords)
    for (const m of OTHERS) {
      for (const k of m.keywords) expect(mine.has(k)).toBe(false)
    }
  })

  it('目录/入口/权限约定：trigger 无 backend，仅声明 clipboard:write', () => {
    expect(qrCode.id).toBe('qr-code')
    expect(qrCode.entry).toBe('./index.vue')
    expect(qrCode.activation).toBe('trigger')
    expect(qrCode.backend).toBeUndefined()
    expect(qrCode.permissions).toEqual(['clipboard:write'])
  })

  it('matcher：锚定 URL 正则、commandId 指向 gen、对任意匹配探针不全命中', () => {
    const matcher = qrCode.matchers?.[0]
    expect(matcher).toMatchObject({ type: 'regex', match: '^https?://\\S+$', label: '生成二维码', commandId: 'gen' })
    const re = new RegExp(matcher?.match ?? '(?!)')
    expect(re.test('https://example.com')).toBe(true)
    expect(re.test('http://localhost:5173/path?q=1')).toBe(true)
    for (const probe of ['x', '1', '中', 'a b']) expect(re.test(probe)).toBe(false)
    expect(re.test('example.com')).toBe(false) // 无协议前缀不命中（宿主已有 web-quick-open 等更合适入口）
  })

  it('commands：gen 词条在列', () => {
    expect(qrCode.commands).toEqual([{ id: 'gen', title: '生成二维码' }])
  })
})
