import { describe, expect, it } from 'vitest'
import { validateManifest } from '@sdk/manifest'
import type { PluginManifest } from '@sdk/manifest'
import manifest from '../../../../src/plugins/password-vault/manifest'
import { normalizePrefs } from '../../../../src/plugins/password-vault/logic/prefs'
import { normalizeGeneratorOptions } from '../../../../src/plugins/password-vault/logic/generator'

// 动态收集当前仓库全部内置插件清单：关键词冲突检查对并行新增的插件同样生效
const manifests = import.meta.glob<{ default: PluginManifest }>('../../../../src/plugins/*/manifest.ts', {
  eager: true
})

function allKeywords(m: PluginManifest): string[] {
  return [...m.keywords, ...(m.commands ?? []).flatMap((c) => c.keywords ?? [])]
}

describe('password-vault manifest', () => {
  it('通过协议校验（空上下文）', () => {
    expect(validateManifest(manifest, { existingIds: new Set(), activeKeywords: new Map() })).toEqual([])
  })

  it('首键为 password-vault，id 为 kebab-case，trigger 激活不带 backend', () => {
    expect(manifest.keywords[0]).toBe('password-vault')
    expect(manifest.id).toBe('password-vault')
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
  })

  it('权限最小化：只声明 storage 与 clipboard 读写', () => {
    expect(new Set(manifest.permissions)).toEqual(new Set(['storage', 'clipboard:read', 'clipboard:write']))
  })

  it('关键词（含命令关键词）不与任何内置插件冲突', () => {
    const mine = new Set(allKeywords(manifest))
    expect(mine.size).toBe(allKeywords(manifest).length) // 自身无重复
    for (const [path, mod] of Object.entries(manifests)) {
      if (path.includes('/password-vault/')) continue
      for (const k of allKeywords(mod.default)) {
        expect(mine, `keyword「${k}」与插件 ${mod.default.id} 冲突`).not.toContain(k)
      }
    }
  })
})

describe('prefs 归一', () => {
  it('undefined / 非法输入回默认（5 分钟 + 16 位全字符集）', () => {
    expect(normalizePrefs(undefined)).toEqual({
      autoLockMin: 5,
      gen: normalizeGeneratorOptions(undefined)
    })
  })
  it('部分字段非法时只修该字段，其余保留', () => {
    const p = normalizePrefs({ autoLockMin: 30, gen: { length: 999, symbols: false } })
    expect(p.autoLockMin).toBe(30)
    expect(p.gen.length).toBe(128)
    expect(p.gen.symbols).toBe(false)
    expect(normalizePrefs({ autoLockMin: 3 }).autoLockMin).toBe(5)
  })
})
