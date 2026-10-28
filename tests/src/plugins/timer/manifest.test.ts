import { describe, expect, it } from 'vitest'
import { validateManifest, type PluginManifest, type ValidateContext } from '../../../../sdk/manifest'
import manifest from '../../../../src/plugins/timer/manifest'
import calc from '../../../../src/plugins/calc/manifest'
import clipboard from '../../../../src/plugins/clipboard/manifest'
import devtools from '../../../../src/plugins/devtools/manifest'
import hello from '../../../../src/plugins/hello/manifest'
import launcher from '../../../../src/plugins/launcher/manifest'
import markdownNotes from '../../../../src/plugins/markdown-notes/manifest'
import timeToolbox from '../../../../src/plugins/time-toolbox/manifest'
import todoPomodoro from '../../../../src/plugins/todo-pomodoro/manifest'
import translate from '../../../../src/plugins/translate/manifest'

const others = [calc, clipboard, devtools, hello, launcher, markdownNotes, timeToolbox, todoPomodoro, translate]

function ctxWith(existing: typeof others): ValidateContext {
  return {
    existingIds: new Set(existing.map((m) => m.id)),
    activeKeywords: new Map(existing.flatMap((m) => m.keywords.map((k) => [k, m.id] as const)))
  }
}

describe('timer manifest', () => {
  it('结构合法（含与收编后的 time-toolbox / todo-pomodoro 无 id/keyword 冲突）', () => {
    expect(validateManifest(manifest, ctxWith(others))).toEqual([])
  })
  it('resident 必带 backend；权限为四项集合', () => {
    expect(manifest.activation).toBe('resident')
    expect(manifest.backend).toBe('./backend/index.ts')
    expect(manifest.entry).toBe('./index.vue')
    expect(manifest.permissions).toEqual(['storage', 'notification', 'window:float', 'window:main'])
    expect(manifest.protocolVersion).toBe(1)
    expect(manifest.source).toBe('builtin')
  })
  it('收编后的触发词：倒计时/番茄钟相关词从两旧插件归入本插件', () => {
    expect(manifest.keywords).toEqual(['timer', '计时器', '倒计时', '番茄钟', 'fanqie', 'daojishi', 'djs'])
    expect(timeToolbox.keywords.some((k) => manifest.keywords.includes(k))).toBe(false)
    expect(todoPomodoro.keywords.some((k) => manifest.keywords.includes(k))).toBe(false)
  })
  it('命令词条：countdown / pomodoro 直达', () => {
    expect(manifest.commands).toEqual([
      { id: 'countdown', title: '倒计时', keywords: ['daojishi', 'djs'] },
      { id: 'pomodoro', title: '番茄钟', keywords: ['fanqie', '番茄'] }
    ])
  })

  it('keywords 与全部内置插件全局无冲突（glob 实收 src/plugins 全量清单）', () => {
    const modules = import.meta.glob('../../../../src/plugins/*/manifest.ts', { eager: true }) as Record<
      string,
      { default: PluginManifest }
    >
    const all = Object.values(modules).map((m) => m.default)
    expect(all.some((m) => m.id === 'timer')).toBe(true)
    expect(all.some((m) => m.id === 'time-toolbox')).toBe(true)
    expect(all.some((m) => m.id === 'todo-pomodoro')).toBe(true)
    const others = all.filter((m) => m.id !== 'timer')
    expect(others.length).toBeGreaterThan(10) // 防 glob 失配退化为空集恒真
    expect(validateManifest(manifest, ctxWith(others))).toEqual([])
  })
})
