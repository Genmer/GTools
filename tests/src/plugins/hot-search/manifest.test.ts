import { describe, expect, it } from 'vitest'
import { validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import manifest from '../../../../src/plugins/hot-search/manifest'

const BUILTINS = [clipboard, devtools, hello, launcher, translate]

function ctxWith(existing: typeof BUILTINS): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('hot-search manifest', () => {
  it('结构合法且与全部现有内置插件不冲突', () => {
    expect(validateManifest(manifest, ctxWith(BUILTINS))).toEqual([])
  })

  it('id 与目录名一致，触发词首键为 hot-search 且不与现有插件重复', () => {
    expect(manifest.id).toBe('hot-search')
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.keywords[0]).toBe('hot-search')
    const taken = new Set(BUILTINS.flatMap((m) => m.keywords))
    for (const k of manifest.keywords) expect(taken.has(k)).toBe(false)
  })

  it('按需最小授权：无 backend 的 trigger 插件只申请 net/storage/shell:open', () => {
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
    expect([...manifest.permissions].sort()).toEqual(['net', 'shell:open', 'storage'])
  })
})
