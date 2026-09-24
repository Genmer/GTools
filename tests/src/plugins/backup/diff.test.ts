import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@sdk/settings'
import { buildImportPlan, settingsChangesBetween } from '../../../../src/plugins/backup/logic/diff'

const settings = (over: Partial<typeof DEFAULT_SETTINGS> = {}) => ({ ...DEFAULT_SETTINGS, ...over })

describe('diff：settingsChangesBetween', () => {
  it('无差异返回空', () => {
    expect(settingsChangesBetween(settings(), settings())).toEqual([])
  })

  it('主题与双平台快捷键变化逐字段给出 before/after', () => {
    const before = settings()
    const after = settings({ theme: 'dark', hotkey: { darwin: 'Cmd+Shift+P', win32: 'Ctrl+Alt+J' } })
    const changes = settingsChangesBetween(before, after)
    expect(changes.map((c) => c.field).sort()).toEqual(['hotkey.darwin', 'hotkey.win32', 'theme'])
    const theme = changes.find((c) => c.field === 'theme')
    expect(theme?.before).toBe('light')
    expect(theme?.after).toBe('dark')
  })

  it('禁用插件列表变化合并为一条', () => {
    const before = settings({ disabledPlugins: ['hello', 'devtools'] })
    const after = settings({ disabledPlugins: ['clipboard'] })
    const changes = settingsChangesBetween(before, after)
    expect(changes).toHaveLength(1)
    expect(changes[0].before).toBe('hello、devtools')
    expect(changes[0].after).toBe('clipboard')
  })
})

describe('diff：buildImportPlan', () => {
  it('全新插件标记 new 并统计新增 key 数', () => {
    const plan = buildImportPlan(
      { settings: settings(), pluginStorage: { clipboard: { a: 1, b: 2 } } },
      { settings: settings(), pluginStorage: {} }
    )
    expect(plan.plugins).toHaveLength(1)
    expect(plan.plugins[0].status).toBe('new')
    expect(plan.plugins[0].added).toEqual(['a', 'b'])
    expect(plan.pluginsToWrite).toBe(1)
    expect(plan.keysToWrite).toBe(2)
  })

  it('值不同的 key 记为覆盖、值相同记为无变化（键序无关）', () => {
    const plan = buildImportPlan(
      { settings: settings(), pluginStorage: { clipboard: { same: { x: 1, y: 2 }, diff: 'new', fresh: 1 } } },
      { settings: settings(), pluginStorage: { clipboard: { same: { y: 2, x: 1 }, diff: 'old', other: 9 } } }
    )
    const p = plan.plugins[0]
    expect(p.status).toBe('update')
    expect(p.overwritten).toEqual(['diff'])
    expect(p.added).toEqual(['fresh'])
    expect(p.unchangedCount).toBe(1)
    expect(plan.keysToWrite).toBe(2)
  })

  it('内容完全一致标记 same 且不计数为写盘', () => {
    const kv = { a: 1 }
    const plan = buildImportPlan(
      { settings: settings(), pluginStorage: { clipboard: kv } },
      { settings: settings(), pluginStorage: { clipboard: { a: 1 } } }
    )
    expect(plan.plugins[0].status).toBe('same')
    expect(plan.pluginsToWrite).toBe(0)
    expect(plan.keysToWrite).toBe(0)
  })

  it('本机独有插件不删数据，提示保留；设置变化进入 settingsWillChange', () => {
    const plan = buildImportPlan(
      { settings: settings({ theme: 'dark' }), pluginStorage: { clipboard: { a: 1 } } },
      { settings: settings(), pluginStorage: { clipboard: { a: 1 }, translate: { x: 1 } } }
    )
    expect(plan.warnings.some((w) => w.includes('translate'))).toBe(true)
    expect(plan.plugins.find((p) => p.pluginId === 'translate')).toBeUndefined()
    expect(plan.settingsWillChange).toBe(true)
    expect(plan.settingsChanges[0].field).toBe('theme')
  })

  it('预览按 更新 > 新增 > 无变化 排序', () => {
    const plan = buildImportPlan(
      {
        settings: settings(),
        pluginStorage: { znew: { a: 1 }, asame: { a: 1 }, mupdate: { a: 2 } }
      },
      { settings: settings(), pluginStorage: { asame: { a: 1 }, mupdate: { a: 1 } } }
    )
    expect(plan.plugins.map((p) => p.status)).toEqual(['update', 'new', 'same'])
  })

  it('extraWarnings 透传到 plan.warnings', () => {
    const plan = buildImportPlan({ settings: settings(), pluginStorage: {} }, { settings: settings(), pluginStorage: {} }, ['w1'])
    expect(plan.warnings).toContain('w1')
  })
})
