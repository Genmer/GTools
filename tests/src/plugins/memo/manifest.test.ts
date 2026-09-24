import { describe, expect, it } from 'vitest'
import { validateManifest, type ValidateContext } from '../../../../sdk/manifest'
import manifest from '../../../../src/plugins/memo/manifest'
import calc from '../../../../src/plugins/calc/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import markdownNotes from '../../../../src/plugins/markdown-notes/manifest'
import todoPomodoro from '../../../../src/plugins/todo-pomodoro/manifest'
import translate from '../../../../src/plugins/translate/manifest'

const others = [calc, clipboard, devtools, hello, launcher, markdownNotes, todoPomodoro, translate]

function ctxWith(existing: typeof others): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('memo manifest', () => {
  it('结构合法', () => {
    expect(validateManifest(manifest, ctxWith([]))).toEqual([])
  })
  it('与其他内置插件无 id / keyword 冲突', () => {
    expect(validateManifest(manifest, ctxWith(others))).toEqual([])
    const mine = new Set(manifest.keywords)
    for (const m of others) {
      for (const k of m.keywords) expect(mine.has(k)).toBe(false)
    }
  })
  it('目录与入口约定', () => {
    expect(manifest.id).toBe('memo')
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
  })
  it('权限最小化：只声明用到的能力', () => {
    expect(new Set(manifest.permissions)).toEqual(new Set(['storage', 'clipboard:write']))
  })
})
