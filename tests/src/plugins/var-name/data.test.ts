// 预设数据与 manifest 完整性测试（DESIGN 附录 C.2/C.3）
import { describe, expect, it } from 'vitest'
import { ALL_PERMISSIONS, validateManifest, type PluginManifest } from '@sdk/manifest'
import manifest from '../../../../src/plugins/var-name/manifest'
import { ALL_PRESETS, GENERIC_PRESET, LANGUAGE_PRESETS } from '../../../../src/plugins/var-name/data/presets'

// C.3 表逐语言规则数（表头合计 88 与分语言明细之和 90 不一致，以分语言明细为准）
const EXPECTED_COUNTS: Record<string, number> = {
  javascript: 9,
  typescript: 6,
  python: 8,
  java: 6,
  kotlin: 7,
  go: 5,
  rust: 4,
  csharp: 7,
  'cpp-google': 8,
  'cpp-llvm': 4,
  php: 6,
  ruby: 5,
  swift: 5,
  css: 3,
  sql: 4,
  shell: 3
}

describe('语言预设数据', () => {
  it('16 套语言预设 + 通用五件套，id 唯一且 kebab-case', () => {
    expect(LANGUAGE_PRESETS.length).toBe(16)
    expect(ALL_PRESETS.length).toBe(17)
    const ids = ALL_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('每语言上下文规则数与 C.3 表一致（合计 90 条）', () => {
    let total = 0
    for (const p of LANGUAGE_PRESETS) {
      expect(p.contexts.length, `${p.id} 规则数`).toBe(EXPECTED_COUNTS[p.id])
      total += p.contexts.length
    }
    expect(total).toBe(90)
  })

  it('语言内 context id 唯一；变量/函数上下文具备主流形态', () => {
    for (const p of LANGUAGE_PRESETS) {
      const ids = p.contexts.map((c) => c.id)
      expect(new Set(ids).size, `${p.id} context id 重复`).toBe(ids.length)
      // 每套预设至少有一个可当变量名的上下文（css/sql 除外按表设计，其余必有 variable 或等价首列）
      if (!['css', 'sql', 'shell'].includes(p.id)) {
        expect(ids).toContain('variable')
      }
    }
    expect(LANGUAGE_PRESETS.find((p) => p.id === 'css')?.contexts.map((c) => c.id)).toEqual(['class', 'id', 'custom-prop'])
  })

  it('通用五件套 = camel/pascal/snake/kebab/screaming', () => {
    expect(GENERIC_PRESET.contexts.map((c) => c.style)).toEqual(['camel', 'pascal', 'snake', 'kebab', 'screaming'])
    expect(GENERIC_PRESET.id).toBe('generic')
  })

  it('关键硬差异在数据中成立（跨语言同一描述不同风格）', () => {
    const constStyle = (id: string) => LANGUAGE_PRESETS.find((p) => p.id === id)!.contexts.find((c) => c.id === 'constant')!.style
    // 常量风格三派（调研 §4.1）
    expect(constStyle('python')).toBe('screaming')
    expect(constStyle('go')).toBe('pascal')
    expect(constStyle('swift')).toBe('camel')
    expect(constStyle('cpp-google')).toBe('kCamel')
    // 变量/函数两大派（§4.2）
    expect(constStyle('rust') === 'screaming').toBe(true)
    const varStyle = (id: string) => LANGUAGE_PRESETS.find((p) => p.id === id)!.contexts.find((c) => c.id === 'variable')!.style
    expect(varStyle('python')).toBe('snake')
    expect(varStyle('javascript')).toBe('camel')
    expect(varStyle('cpp-llvm')).toBe('pascal')
  })
})

describe('manifest（DESIGN C.2）', () => {
  it('校验通过（空注册上下文）', () => {
    const errors = validateManifest(manifest, { existingIds: new Set(), activeKeywords: new Map() })
    expect(errors).toEqual([])
  })

  it('字段与权限面符合规格：apis:translate + 剪贴板 + storage', () => {
    expect(manifest.id).toBe('var-name')
    expect(manifest.protocolVersion).toBe(1)
    expect(manifest.activation).toBe('trigger')
    expect(new Set(manifest.permissions)).toEqual(new Set(['apis:translate', 'clipboard:read', 'clipboard:write', 'storage']))
    for (const p of manifest.permissions) expect(ALL_PERMISSIONS).toContain(p)
    // 不带 net：翻译走全局 API 中心代理，维持最小授权
    expect(manifest.permissions).not.toContain('net')
  })

  it('触发词 vn / 命名 / var 与既有全部插件不冲突', () => {
    expect(manifest.keywords).toEqual(['vn', '命名', 'var'])
    const modules = import.meta.glob<{ default: PluginManifest }>('../../../../src/plugins/*/manifest.ts', { eager: true })
    const owners = new Map<string, string>()
    for (const [path, mod] of Object.entries(modules)) {
      const m = mod.default
      expect(m.id, path).toBeTruthy()
      for (const k of [...m.keywords, ...(m.commands ?? []).flatMap((c) => c.keywords ?? [])]) {
        const owner = owners.get(k)
        // 宿主只判跨插件冲突；同一插件主触发词与命令词复用合法（如 float-image 的 tietu）
        expect(owner === undefined || owner === m.id, `keyword「${k}」在 ${owner} 与 ${m.id} 冲突`).toBe(true)
        if (owner === undefined) owners.set(k, m.id)
      }
    }
    // glob 确实扫到了全部内置插件（含 var-name 自身）
    expect(owners.get('vn')).toBe('var-name')
    expect(owners.size).toBeGreaterThanOrEqual(80)
  })
})
