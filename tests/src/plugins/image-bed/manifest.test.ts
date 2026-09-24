import { describe, expect, it } from 'vitest'
import { validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import manifest from '../../../../src/plugins/image-bed/manifest'

const OTHERS = [clipboard, devtools, hello, launcher, translate]

function ctxWith(existing: typeof OTHERS): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('image-bed manifest', () => {
  it('结构合法且与现有内置插件不冲突', () => {
    expect(validateManifest(manifest, ctxWith(OTHERS))).toEqual([])
  })

  it('触发词不与现有插件/子命令 keyword 重复（grep 全量 manifest 的镜像断言）', () => {
    const taken = new Set(OTHERS.flatMap((m) => [...m.keywords, ...(m.commands ?? []).flatMap((c) => c.keywords ?? [])]))
    for (const k of manifest.keywords) expect(taken.has(k)).toBe(false)
  })

  it('id 与目录名一致，entry 约定正确，trigger 型无 backend 合法', () => {
    expect(manifest.id).toBe('image-bed')
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
    expect(manifest.protocolVersion).toBe(1)
  })

  it('声明的权限与功能一一对应（无冗余权限）', () => {
    expect(new Set(manifest.permissions)).toEqual(
      new Set(['net', 'clipboard:read', 'clipboard:write', 'storage', 'dialog', 'fs', 'shell:open'])
    )
  })
})
