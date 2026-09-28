import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import manifest from '../../../../src/plugins/web-quick-open/manifest'
import { buildQuickSearchMatcherSource } from '../../../../src/plugins/web-quick-open/match'
import { BUILTIN_SITES } from '../../../../src/plugins/web-quick-open/sites'

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

describe('web-quick-open 全局快搜 matcher 与站点命令', () => {
  it('清单（含 matchers/commands）校验通过；regex 源与 sites 别名全集再生成一致', () => {
    expect(validateManifest(manifest, ctxWith(EXISTING))).toEqual([])
    const matcher = manifest.matchers?.[0]
    expect(matcher).toMatchObject({ type: 'regex', label: '网页快搜', commandId: 'search' })
    expect(matcher?.match).toBe(buildQuickSearchMatcherSource(BUILTIN_SITES.flatMap((s) => s.aliases ?? [])))
  })

  it('锚定正则放行「别名 关键词」，对探针集（x/1/中/a b）与裸别名单词条不命中', () => {
    const re = new RegExp(manifest.matchers?.[0]?.match ?? '(?!)')
    expect(re.test('bd 天气')).toBe(true)
    expect(re.test('bili 演讲')).toBe(true)
    expect(re.test('gh vue')).toBe(true)
    expect(re.test('bd')).toBe(false)
    expect(re.test('bili')).toBe(false)
    for (const probe of ['x', '1', '中', 'a b']) expect(re.test(probe)).toBe(false)
  })

  it('commands 含 search 与 8 条高频站点直达，open-* 的 id 均能对应内置站点且 keywords 非空', () => {
    const cmds = manifest.commands ?? []
    expect(cmds.filter((c) => c.id.startsWith('open-'))).toHaveLength(8)
    expect(cmds.some((c) => c.id === 'search' && c.title === '网页快搜')).toBe(true)
    for (const c of cmds.filter((x) => x.id.startsWith('open-'))) {
      const site = BUILTIN_SITES.find((s) => s.id === c.id.slice('open-'.length))
      expect(site).toBeDefined()
      expect(c.title).toContain(site!.name)
      expect(c.keywords?.length ?? 0).toBeGreaterThan(0)
    }
  })
})
