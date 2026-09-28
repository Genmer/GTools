import { describe, expect, it } from 'vitest'
import type { Permission, PluginManifest } from '@sdk/manifest'
import {
  mergePushedItems,
  normalizePushedItem,
  PUSHED_ITEMS_CAP,
  pushedItemsToRecItems,
  pushedKey,
  replacePushedItems,
  type PushedItem
} from '../src/renderer/src/core/main-push'

// 'mainPush' 权限名归 sdk 车道扩展，落地前以 string[] 断言注入（降转 Permission[] 合法）
const manifest = (id: string, perms: string[] = [], over: Partial<PluginManifest> = {}): PluginManifest => ({
  id,
  name: id,
  version: '0.1.0',
  protocolVersion: 1,
  icon: '🧩',
  keywords: [id],
  activation: 'resident',
  permissions: perms as Permission[],
  source: 'builtin',
  entry: './index.vue',
  ...over
})

const item = (over: Partial<PushedItem> & { pluginId: string }): PushedItem => ({
  title: over.title ?? 'T',
  subtitle: over.subtitle ?? 'S',
  icon: over.icon ?? 'I',
  ...over
})

describe('mergePushedItems', () => {
  it('无 mainPush 权限的插件项整批丢弃', () => {
    const allowed = manifest('clip', ['mainPush'])
    const denied = manifest('note')
    const incoming = [item({ pluginId: 'clip', title: 'A' }), item({ pluginId: 'note', title: 'B' })]
    expect(mergePushedItems([], incoming, [allowed, denied])).toEqual([incoming[0]])
  })

  it('pluginId+commandId 去重先到先得（existing 优先 incoming、_main 与具名命令互异）', () => {
    const m = manifest('clip', ['mainPush'])
    const existing = [item({ pluginId: 'clip', title: '旧' })]
    const incoming = [item({ pluginId: 'clip', title: '新' }), item({ pluginId: 'clip', commandId: 'c1', title: '命令' })]
    const merged = mergePushedItems(existing, incoming, [m])
    expect(merged.map((x) => x.title)).toEqual(['旧', '命令'])
    // 同 commandId 再推不重复；不同 commandId 与主入口同存
    const again = mergePushedItems(merged, [item({ pluginId: 'clip', commandId: 'c1', title: '又新' })], [m])
    expect(again).toHaveLength(2)
  })

  it(`cap 截断（默认 ${PUSHED_ITEMS_CAP}）`, () => {
    const m = manifest('clip', ['mainPush'])
    const many = Array.from({ length: 12 }, (_, i) => item({ pluginId: 'clip', commandId: `c${i}`, title: `T${i}` }))
    const merged = mergePushedItems([], many, [m])
    expect(merged).toHaveLength(PUSHED_ITEMS_CAP)
    expect(merged[0].title).toBe('T0')
    expect(merged[11]).toBeUndefined()
    // 显式 cap 生效
    expect(mergePushedItems([], many, [m], 3)).toHaveLength(3)
  })

  it('去重发生在 cap 之前：existing 占位后 incoming 同键不挤占额度', () => {
    const m = manifest('clip', ['mainPush'])
    const existing = [item({ pluginId: 'clip', title: '旧' })]
    const incoming = [item({ pluginId: 'clip', title: '新' })]
    expect(mergePushedItems(existing, incoming, [m], 1)).toEqual(existing)
  })
})

describe('pushedItemsToRecItems', () => {
  it('映射为 source push 的 RecItem：key/label=title/payload 透传', () => {
    const [rec] = pushedItemsToRecItems([item({ pluginId: 'clip', commandId: 'c1', title: '剪贴板', subtitle: '子题', icon: '📋', payloadText: 'text' })])
    expect(rec).toMatchObject({
      key: 'clip:c1',
      pluginId: 'clip',
      commandId: 'c1',
      title: '剪贴板',
      subtitle: '子题',
      label: '剪贴板',
      icon: '📋',
      payload: 'text',
      source: 'push'
    })
    // 无 commandId 落主入口键
    expect(pushedItemsToRecItems([item({ pluginId: 'clip' })])[0].key).toBe('clip:_main')
  })

  it('超 2000 字符 payloadText 剥离（对齐 recommend 的只进入不注入语义），恰 2000 保留', () => {
    const big = 'x'.repeat(2001)
    expect(pushedItemsToRecItems([item({ pluginId: 'clip', payloadText: big })])[0].payload).toBeUndefined()
    const ok = 'x'.repeat(2000)
    expect(pushedItemsToRecItems([item({ pluginId: 'clip', payloadText: ok })])[0].payload).toBe(ok)
    expect(pushedItemsToRecItems([item({ pluginId: 'clip' })])[0].payload).toBeUndefined()
  })
})

describe('pushedKey / 无 commandId 批量行去重', () => {
  it('pushId 参与 key：三行批量推送互不塌缩；pushId 缺席回退 _main', () => {
    expect(pushedKey({ pluginId: 'clip', pushId: 'r1' })).toBe('clip:r1')
    expect(pushedKey({ pluginId: 'clip' })).toBe('clip:_main')
    // commandId 优先于 pushId（具名命令语义不变）
    expect(pushedKey({ pluginId: 'clip', commandId: 'c1', pushId: 'r1' })).toBe('clip:c1')
  })

  it('mergePushedItems 同样按 pushId 去重', () => {
    const m = manifest('clip', ['mainPush'])
    const merged = mergePushedItems(
      [],
      [item({ pluginId: 'clip', pushId: 'r1', title: 'A' }), item({ pluginId: 'clip', pushId: 'r2', title: 'B' })],
      [m]
    )
    expect(merged.map((x) => x.title)).toEqual(['A', 'B'])
    // 同 pushId 再推不重复（existing 优先）
    expect(mergePushedItems(merged, [item({ pluginId: 'clip', pushId: 'r1', title: 'A2' })], [m])).toEqual(merged)
  })
})

describe('replacePushedItems（数组整组替换协议）', () => {
  const clip = manifest('clip', ['mainPush'])
  const note = manifest('note', ['mainPush'])

  it('整组替换：该插件旧行清空、新组全量入位；其他插件行原样保留', () => {
    const existing = [
      item({ pluginId: 'note', pushId: 'n1', title: 'N' }),
      item({ pluginId: 'clip', pushId: 'r-old', title: '旧' })
    ]
    const out = replacePushedItems(existing, [item({ pluginId: 'clip', pushId: 'r1', title: 'A' })], 'clip', [clip, note])
    expect(out.map((x) => `${x.pluginId}:${x.title}`)).toEqual(['note:N', 'clip:A'])
  })

  it('空数组即清除该插件全部行（幽灵行回归测试）', () => {
    const existing = [
      item({ pluginId: 'note', pushId: 'n1', title: 'N' }),
      item({ pluginId: 'clip', pushId: 'r1', title: 'A' })
    ]
    expect(replacePushedItems(existing, [], 'clip', [clip, note])).toEqual([existing[0]])
  })

  it('无 mainPush 权限的通道整组拒绝；组内同键去重；cap 截断', () => {
    const existing = [item({ pluginId: 'clip', pushId: 'r1', title: 'A' })]
    const denied = replacePushedItems(existing, [item({ pluginId: 'clip', pushId: 'r9', title: 'X' })], 'note', [clip])
    expect(denied).toEqual(existing)
    const deduped = replacePushedItems(
      [],
      [item({ pluginId: 'clip', pushId: 'r1', title: 'A' }), item({ pluginId: 'clip', pushId: 'r1', title: 'A2' })],
      'clip',
      [clip]
    )
    expect(deduped).toEqual([item({ pluginId: 'clip', pushId: 'r1', title: 'A' })])
    const many = Array.from({ length: 12 }, (_, i) => item({ pluginId: 'clip', pushId: `r${i}`, title: `T${i}` }))
    expect(replacePushedItems([], many, 'clip', [clip])).toHaveLength(PUSHED_ITEMS_CAP)
  })
})

describe('normalizePushedItem', () => {
  it('pluginId 强制取通道归属；坏字段回退插件名/图标；非对象返回 null', () => {
    expect(
      normalizePushedItem({ pluginId: 'evil', title: 'T', subtitle: 'S', payloadText: 'p' }, 'clip', { name: '剪贴板', icon: '📋' })
    ).toEqual({ pluginId: 'clip', commandId: undefined, pushId: undefined, title: 'T', subtitle: 'S', icon: '📋', payloadText: 'p' })
    expect(
      normalizePushedItem({ title: 42 }, 'clip', { name: '剪贴板', icon: '📋' })
    ).toEqual({ pluginId: 'clip', commandId: undefined, pushId: undefined, title: '剪贴板', subtitle: '', icon: '📋', payloadText: undefined })
    expect(normalizePushedItem('oops', 'clip', { name: 'n', icon: 'i' })).toBeNull()
    expect(normalizePushedItem(null, 'clip', { name: 'n', icon: 'i' })).toBeNull()
  })
})
