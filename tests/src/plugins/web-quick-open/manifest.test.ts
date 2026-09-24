import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import manifest from '../../../../src/plugins/web-quick-open/manifest'

const EXISTING = [clipboard, devtools, hello, launcher, translate]

function ctxWith(existing: typeof EXISTING): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('web-quick-open manifest', () => {
  it('结构合法且与现有全部内置插件不冲突', () => {
    expect(validateManifest(manifest, ctxWith(EXISTING))).toEqual([])
  })

  it('id 与目录名一致，trigger 无 backend，权限均合法', () => {
    expect(manifest.id).toBe('web-quick-open')
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
    expect(manifest.source).toBe('builtin')
    for (const p of manifest.permissions) expect(ALL_PERMISSIONS).toContain(p)
  })

  it('首键触发词为 web-quick-open，且追加触发词不与现有插件 keywords 冲突', () => {
    expect(manifest.keywords[0]).toBe('web-quick-open')
    const taken = new Set(EXISTING.flatMap((m) => m.keywords))
    for (const k of manifest.keywords.slice(1)) expect(taken.has(k)).toBe(false)
  })
})
