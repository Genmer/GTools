import { describe, expect, it } from 'vitest'
import { validateManifest, type ValidateContext, type PluginManifest } from '../../../../sdk/manifest'
import manifest from '../../../../src/plugins/diff/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import translate from '../../../../src/plugins/translate/manifest'

const OTHERS: PluginManifest[] = [clipboard, devtools, hello, launcher, translate]

function ctxWith(existing: PluginManifest[]): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('diff manifest', () => {
  it('结构合法且与现有内置插件 id/keyword 均不冲突', () => {
    expect(validateManifest(manifest, ctxWith(OTHERS))).toEqual([])
  })

  it('id 与目录名一致，trigger 型无 backend（宿主 glob 按 ../plugins/diff/ 取 entry）', () => {
    expect(manifest.id).toBe('diff')
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
  })

  it('首键为 diff，且追加触发词不与任何现有插件关键词重复', () => {
    expect(manifest.keywords[0]).toBe('diff')
    const taken = new Set(OTHERS.flatMap((m) => m.keywords))
    for (const k of manifest.keywords) expect(taken.has(k)).toBe(false)
  })

  it('只声明用到的权限（storage 选项持久化 / clipboard 读写）', () => {
    expect(new Set(manifest.permissions)).toEqual(new Set(['storage', 'clipboard:read', 'clipboard:write']))
  })
})
