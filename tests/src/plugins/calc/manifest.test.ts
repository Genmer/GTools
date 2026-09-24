import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import manifest from '../../../../src/plugins/calc/manifest'
import translate from '../../../../src/plugins/translate/manifest'

const existing = [devtools, hello, launcher, translate, clipboard]

function ctxWith(list: typeof existing): ValidateContext {
  return {
    existingIds: new Set(list.map((m) => m.id)),
    activeKeywords: new Map(list.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('calc manifest', () => {
  it('结构合法且与现有内置插件 id/keyword 不冲突', () => {
    expect(validateManifest(manifest, ctxWith(existing))).toEqual([])
  })

  it('id 与目录名一致、trigger 无 backend、首键为 calc', () => {
    expect(manifest.id).toBe('calc')
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.keywords[0]).toBe('calc')
  })

  it('keywords 与现有插件无精确冲突', () => {
    const taken = new Set(existing.flatMap((m) => m.keywords))
    for (const k of manifest.keywords) expect(taken.has(k)).toBe(false)
  })

  it('permissions 只声明用到的能力（storage 持久化 + clipboard:write 复制结果）', () => {
    expect(manifest.permissions).toEqual(['storage', 'clipboard:write'])
    for (const p of manifest.permissions) expect((ALL_PERMISSIONS as readonly string[]).includes(p)).toBe(true)
  })
})
