import { describe, expect, it } from 'vitest'
import { validateManifest } from '@sdk/manifest'
import manifest from '../../../../src/plugins/todo-pomodoro/manifest'
import clipboardManifest from '../../../../src/plugins/clipboard/manifest'
import devtoolsManifest from '../../../../src/plugins/devtools/manifest'
import helloManifest from '../../../../src/plugins/hello/manifest'
import launcherManifest from '../../../../src/plugins/launcher/manifest'
import translateManifest from '../../../../src/plugins/translate/manifest'

const existing = [clipboardManifest, devtoolsManifest, helloManifest, launcherManifest, translateManifest]

const ctx = {
  existingIds: new Set(existing.map((m) => m.id)),
  activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
}

describe('todo-pomodoro manifest', () => {
  it('通过协议校验：无错误（含与现有插件 id/keyword 不冲突）', () => {
    expect(validateManifest(manifest, ctx)).toEqual([])
  })

  it('resident 必带 backend，权限全部合法且最小化', () => {
    expect(manifest.activation).toBe('resident')
    expect(typeof manifest.backend).toBe('string')
    expect(manifest.permissions).toEqual(['storage', 'notification', 'window:float'])
    expect(manifest.protocolVersion).toBe(1)
    expect(manifest.source).toBe('builtin')
    expect(manifest.entry).toBe('./index.vue')
  })

  it('首键触发词为 todo-pomodoro（外壳进入插件用 keywords[0]）', () => {
    expect(manifest.keywords[0]).toBe('todo-pomodoro')
  })

  it('任一触发词都不与现有启用插件冲突', () => {
    for (const k of manifest.keywords) {
      expect(ctx.activeKeywords.has(k), `keyword「${k}」被占用`).toBe(false)
    }
  })
})
