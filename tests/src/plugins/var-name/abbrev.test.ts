// 缩写词典应用深测（store.test.ts 的缩写 describe 覆盖主干，本文件补变体/撞形优先级/复数边界/组合流）
import { describe, expect, it } from 'vitest'
import { ABBREVIATIONS, ABBR_LEVEL_LABEL, applyAbbrevs, contextualSuggestions, reverseLookup } from '../../../../src/plugins/var-name/data/abbrev'
import { generate } from '../../../../src/plugins/var-name/logic/engine'
import { LANGUAGE_PRESETS, type LanguagePreset } from '../../../../src/plugins/var-name/data/presets'

const byId = (id: string): LanguagePreset => LANGUAGE_PRESETS.find((p) => p.id === id)!
const valueOf = (words: readonly string[], presetId: string, contextId: string): string =>
  generate(words, byId(presetId)).find((c) => c.contextId === contextId)!.value

describe('applyAbbrevs 替换规则', () => {
  it('recommended 主形态替换：database/context/temporary/buffer → db/ctx/tmp/buf（不用变体 buff/temp）', () => {
    expect(applyAbbrevs(['database', 'context', 'temporary', 'buffer'])).toEqual(['db', 'ctx', 'tmp', 'buf'])
  })

  it('复数保留 s：arguments/transactions/references → args/txs/refs', () => {
    expect(applyAbbrevs(['arguments', 'transactions', 'references'])).toEqual(['args', 'txs', 'refs'])
  })

  it('复数边界：-ies 词形不支持（properties 原样）；≤3 字母词不做去 s 探测（ids 原样）', () => {
    expect(applyAbbrevs(['properties'])).toEqual(['properties'])
    expect(applyAbbrevs(['ids'])).toEqual(['ids'])
  })

  it('未收录词与已是缩写的词原样通过（db 不再二次变换）', () => {
    expect(applyAbbrevs(['user', 'xyzzy', 'db'])).toEqual(['user', 'xyzzy', 'db'])
  })

  it('contextual / avoid 级全称一律不自动替换', () => {
    expect(applyAbbrevs(['allocation', 'action', 'iterator', 'version'])).toEqual(['allocation', 'action', 'iterator', 'version'])
  })
})

describe('reverseLookup 反查与撞形优先级（按收录序首个命中）', () => {
  it('变体可反查到词条：buff/temp/cur/e', () => {
    expect(reverseLookup('buff')).toMatchObject({ full: 'buffer', level: 'recommended' })
    expect(reverseLookup('temp')).toMatchObject({ full: 'temporary', level: 'recommended' })
    expect(reverseLookup('cur')).toMatchObject({ full: 'current', level: 'recommended' })
    expect(reverseLookup('e')).toMatchObject({ full: 'event', level: 'recommended' })
  })

  it('同形多义：recommended 先于 contextual/avoid（com→communication、dev→developer）', () => {
    expect(reverseLookup('com')).toMatchObject({ full: 'communication', level: 'recommended' })
    expect(reverseLookup('dev')).toMatchObject({ full: 'developer', level: 'recommended' })
  })

  it('仅 contextual / avoid 收录的形态按对应级别返回（cfg/fn/txt）', () => {
    expect(reverseLookup('cfg')).toMatchObject({ full: 'configuration', level: 'contextual' })
    expect(reverseLookup('fn')).toMatchObject({ full: 'function', level: 'contextual' })
    expect(reverseLookup('txt')).toMatchObject({ full: 'text', level: 'avoid' })
  })
})

describe('contextualSuggestions 建议', () => {
  it('同词多条 contextual 全部给出：user → u（URL 语境）与 usr（Unix 惯例）', () => {
    const got = contextualSuggestions(['user'])
    expect(got.map((s) => s.abbr).sort()).toEqual(['u', 'usr'])
    expect(got.every((s) => s.full === 'user' && s.context !== '')).toBe(true)
  })

  it('多词各查各的：difference→diff、matrix→mat（只建议主形态，不含变体 mtx）', () => {
    const got = contextualSuggestions(['difference', 'matrix'])
    expect(got).toHaveLength(2)
    expect(got.find((s) => s.full === 'difference')?.abbr).toBe('diff')
    expect(got.find((s) => s.full === 'matrix')?.abbr).toBe('mat')
  })

  it('无 contextual 命中返回空数组（recommended 全称或未收录词不触发建议）', () => {
    expect(contextualSuggestions(['database', 'settings'])).toEqual([])
  })
})

describe('缩写与风格引擎组合（index.vue 的实际管线）', () => {
  it('先缩写后生成：Python 常量 USER_CONFIG_CTX；JavaScript 变量 userConfigCtx', () => {
    const raw = ['user', 'configuration', 'context']
    expect(valueOf(applyAbbrevs(raw), 'python', 'constant')).toBe('USER_CONFIG_CTX')
    expect(valueOf(applyAbbrevs(raw), 'javascript', 'variable')).toBe('userConfigCtx')
    // 开关关闭时保留全称
    expect(valueOf(raw, 'python', 'constant')).toBe('USER_CONFIGURATION_CONTEXT')
  })
})

describe('词典数据形态', () => {
  it('全部 primary 与变体均为小写字母数字（进 tokenize 后可稳定参与风格渲染）', () => {
    for (const e of ABBREVIATIONS) {
      for (const a of [e.primary, ...(e.variants ?? [])]) {
        expect(a, `${e.full} 的 ${a}`).toMatch(/^[a-z0-9]+$/)
      }
    }
  })

  it('ABBR_LEVEL_LABEL 覆盖三级别文案', () => {
    expect(Object.keys(ABBR_LEVEL_LABEL).sort()).toEqual(['avoid', 'contextual', 'recommended'])
    expect(ABBR_LEVEL_LABEL.recommended).toBe('推荐缩写')
    expect(ABBR_LEVEL_LABEL.avoid).toContain('全称')
  })
})
