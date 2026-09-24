import { describe, expect, it } from 'vitest'
import { validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import fakeData from '../../../../src/plugins/fake-data/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import translate from '../../../../src/plugins/translate/manifest'

const EXISTING = [clipboard, devtools, hello, launcher, translate]

function ctxWith(existing: typeof EXISTING): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('fake-data manifest', () => {
  it('结构合法且与现有内置插件零冲突', () => {
    expect(validateManifest(fakeData, ctxWith(EXISTING))).toEqual([])
  })

  it('id 与目录名一致（宿主 glob 按 ../plugins/${id}/ 取 entry）', () => {
    expect(fakeData.id).toBe('fake-data')
    expect(fakeData.entry).toBe('./index.vue')
    expect(fakeData.protocolVersion).toBe(1)
    expect(fakeData.source).toBe('builtin')
  })

  it('触发词首键为 fake-data，且不与任何现有插件的 keyword 重合', () => {
    expect(fakeData.keywords[0]).toBe('fake-data')
    const taken = new Set(EXISTING.flatMap((m) => m.keywords))
    for (const k of fakeData.keywords) expect(taken.has(k)).toBe(false)
  })

  it('trigger 型无 backend、permissions 均在协议白名单内', () => {
    expect(fakeData.activation).toBe('trigger')
    expect(fakeData.backend).toBeUndefined()
    for (const p of fakeData.permissions) {
      expect(['storage', 'clipboard:write']).toContain(p)
    }
  })
})
