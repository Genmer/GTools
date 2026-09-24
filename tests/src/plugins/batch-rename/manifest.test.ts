import { describe, expect, it } from 'vitest'
import { validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import batchRename from '../../../../src/plugins/batch-rename/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import translate from '../../../../src/plugins/translate/manifest'

const others = [clipboard, devtools, hello, launcher, translate]

function ctxWith(): ValidateContext {
  return {
    existingIds: new Set(others.map((m) => m.id)),
    activeKeywords: new Map(others.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('batch-rename manifest', () => {
  it('结构合法且与现有内置插件无 id / keyword 冲突', () => {
    expect(validateManifest(batchRename, ctxWith())).toEqual([])
  })

  it('触发词首键为 batch-rename，且各触发词互不重复', () => {
    expect(batchRename.keywords[0]).toBe('batch-rename')
    expect(new Set(batchRename.keywords).size).toBe(batchRename.keywords.length)
  })

  it('trigger 型无 backend，目录与 entry 约定一致', () => {
    expect(batchRename.activation).toBe('trigger')
    expect(batchRename.backend).toBeUndefined()
    expect(batchRename.id).toBe('batch-rename')
    expect(batchRename.entry).toBe('./index.vue')
    expect(batchRename.source).toBe('builtin')
  })

  it('只声明用到的最小权限（dialog + fs + storage 撤销日志）', () => {
    expect(new Set(batchRename.permissions)).toEqual(new Set(['dialog', 'fs', 'storage']))
  })
})
