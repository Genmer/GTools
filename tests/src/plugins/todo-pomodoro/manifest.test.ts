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

  it('番茄钟已并入 timer：trigger 纯渲染层，权限仅 storage', () => {
    expect(manifest.activation).toBe('trigger')
    expect(manifest.backend).toBeUndefined()
    expect(manifest.permissions).toEqual(['storage'])
    expect(manifest.protocolVersion).toBe(1)
    expect(manifest.source).toBe('builtin')
    expect(manifest.entry).toBe('./index.vue')
  })

  it('id 不变保待办数据；首键触发词为 todo-pomodoro', () => {
    expect(manifest.id).toBe('todo-pomodoro')
    expect(manifest.keywords[0]).toBe('todo-pomodoro')
    expect(manifest.name).toBe('待办清单')
  })

  it('声明 add 命令与对应的 text matcher', () => {
    expect(manifest.commands?.some((c) => c.id === 'add' && c.title === '添加到待办')).toBe(true)
    expect(manifest.matchers?.some((m) => m.type === 'text' && m.commandId === 'add')).toBe(true)
  })
})
