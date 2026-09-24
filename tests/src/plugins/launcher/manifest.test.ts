import { describe, expect, it } from 'vitest'
import { validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import manifest from '../../../../src/plugins/launcher/manifest'

function ctxWith(existing: typeof devtools[]): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('launcher manifest', () => {
  it('结构合法且与现有内置插件不冲突', () => {
    expect(validateManifest(manifest, ctxWith([devtools, hello]))).toEqual([])
  })

  it('id 与目录名一致（宿主 glob 按 ../plugins/${id}/ 取 entry 与 backend）', () => {
    expect(manifest.id).toBe('launcher')
    expect(manifest.backend).toBe('./backend/index.ts')
    expect(manifest.entry).toBe('./index.vue')
  })

  it('trigger 型带 backend 是协议允许的（DESIGN §3.4 按需能力）', () => {
    expect(manifest.activation).toBe('trigger')
    expect(typeof manifest.backend).toBe('string')
  })
})
