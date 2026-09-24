import { describe, expect, it } from 'vitest'
import { validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import manifest from '../../../../src/plugins/float-image/manifest'

function ctxWith(existing: typeof devtools[]): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

const OTHERS = [devtools, translate, clipboard, hello, launcher]

describe('float-image manifest', () => {
  it('结构合法且与现有内置插件不冲突', () => {
    expect(validateManifest(manifest, ctxWith(OTHERS))).toEqual([])
  })

  it('id 与目录名一致，触发词首键为 float-image', () => {
    expect(manifest.id).toBe('float-image')
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.keywords[0]).toBe('float-image')
  })

  it('trigger 型无 backend，权限只声明用到的能力', () => {
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
    expect(manifest.permissions).toEqual(['clipboard:read', 'window:float', 'dialog', 'fs', 'storage'])
  })

  it('commands 唯一且与全局词条直达对应', () => {
    const ids = manifest.commands?.map((c) => c.id) ?? []
    expect(ids).toEqual(['pin-clipboard', 'pin-file'])
  })
})
