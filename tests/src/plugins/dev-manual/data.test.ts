import { describe, expect, it } from 'vitest'
import { marked } from 'marked'
import { validateManifest } from '@sdk/manifest'
import devManual from '../../../../src/plugins/dev-manual/manifest'
import { ALL_ENTRIES, MANUALS } from '../../../../src/plugins/dev-manual/data'
import devtools from '../../../../src/plugins/devtools/manifest'
import translate from '../../../../src/plugins/translate/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import hello from '../../../../src/plugins/hello/manifest'

const builtinManifests = [devtools, translate, clipboard, launcher, hello, devManual]

describe('dev-manual manifest', () => {
  it('通过协议校验', () => {
    const errs = validateManifest(devManual, { existingIds: new Set(), activeKeywords: new Map() })
    expect(errs).toEqual([])
  })

  it('触发词不与既有内置插件冲突', () => {
    const owners = new Map<string, string>()
    for (const m of builtinManifests) {
      if (m.id === devManual.id) continue
      for (const k of m.keywords) owners.set(k, m.id)
    }
    for (const k of devManual.keywords) {
      expect(owners.get(k), `keyword「${k}」被 ${owners.get(k)} 占用`).toBeUndefined()
    }
  })

  it('command id 在插件内唯一', () => {
    const ids = (devManual.commands ?? []).map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('dev-manual data integrity', () => {
  it('五本手册，条目总量达标', () => {
    expect(MANUALS.map((m) => m.id)).toEqual(['linux', 'git', 'http', 'regex', 'vscode'])
    expect(MANUALS.every((m) => m.label !== '' && m.icon !== '')).toBe(true)
    expect(ALL_ENTRIES.length).toBeGreaterThanOrEqual(180)
  })

  it('entry id 全局唯一，字段完整', () => {
    const ids = new Set<string>()
    for (const e of ALL_ENTRIES) {
      expect(ids.has(e.id), `重复 id：${e.id}`).toBe(false)
      ids.add(e.id)
      expect(e.name.trim()).not.toBe('')
      expect(e.summary.trim()).not.toBe('')
      expect(e.md.trim()).not.toBe('')
      expect(e.id.startsWith(`${e.manualId}:`)).toBe(true)
      if (e.copyText !== undefined) expect(e.copyText).not.toBe('')
    }
  })

  it('VSCode 条目 mac/win 组合键齐全', () => {
    const vscode = MANUALS.find((m) => m.id === 'vscode')?.entries ?? []
    expect(vscode.length).toBeGreaterThan(20)
    for (const e of vscode) {
      expect(e.meta?.mac, `${e.id} 缺 mac 组合键`).toBeTruthy()
      expect(e.meta?.win, `${e.id} 缺 win 组合键`).toBeTruthy()
    }
  })

  it('全部 markdown 可被 marked 解析出 HTML', () => {
    for (const e of ALL_ENTRIES) {
      const html = marked.parse(e.md, { async: false })
      expect(typeof html).toBe('string')
      expect(html.length).toBeGreaterThan(0)
    }
  })
})
