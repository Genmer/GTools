import { describe, expect, it } from 'vitest'
import { validateManifest, PROTOCOL_VERSION } from '../sdk/manifest'
import type { PluginManifest } from '../sdk/manifest'

const base = (over: Partial<PluginManifest> = {}): PluginManifest => ({
  id: 'demo',
  name: '演示',
  version: '0.1.0',
  protocolVersion: PROTOCOL_VERSION,
  icon: '🔧',
  keywords: ['demo'],
  activation: 'trigger',
  permissions: [],
  source: 'builtin',
  entry: './index.vue',
  ...over
})

const emptyCtx = () => ({ existingIds: new Set<string>(), activeKeywords: new Map<string, string>() })

describe('manifest 校验', () => {
  it('合法清单通过', () => {
    expect(validateManifest(base(), emptyCtx())).toEqual([])
  })

  it('协议版本不符拒绝，错误信息含双端版本', () => {
    const errs = validateManifest(base({ protocolVersion: 99 }), emptyCtx())
    expect(errs).toHaveLength(1)
    expect(errs[0].field).toBe('protocolVersion')
    expect(errs[0].message).toContain('99')
  })

  it('id 非法（大写/数字开头/空）拒绝', () => {
    expect(validateManifest(base({ id: 'Demo' }), emptyCtx())[0].field).toBe('id')
    expect(validateManifest(base({ id: '1abc' }), emptyCtx())[0].field).toBe('id')
    expect(validateManifest(base({ id: '' }), emptyCtx()).some((e) => e.field === 'id')).toBe(true)
  })

  it('id 与已加载插件冲突拒绝（后到者）', () => {
    const ctx = { existingIds: new Set(['demo']), activeKeywords: new Map() }
    const errs = validateManifest(base(), ctx)
    expect(errs.some((e) => e.field === 'id' && e.message.includes('冲突'))).toBe(true)
  })

  it('resident 缺 backend 拒绝', () => {
    const errs = validateManifest(base({ activation: 'resident' }), emptyCtx())
    expect(errs.some((e) => e.field === 'backend')).toBe(true)
  })

  it('keywords 与已启用插件冲突拒绝，信息含双方 id', () => {
    const ctx = { existingIds: new Set<string>(), activeKeywords: new Map([['demo', 'owner-plugin']]) }
    const errs = validateManifest(base({ id: 'other' }), ctx)
    expect(errs.some((e) => e.field === 'keywords' && e.message.includes('owner-plugin'))).toBe(true)
  })

  it('未知权限拒绝', () => {
    const errs = validateManifest(base({ permissions: ['superuser' as never] }), emptyCtx())
    expect(errs.some((e) => e.field === 'permissions')).toBe(true)
  })

  it('非对象清单不抛异常，返回可读错误', () => {
    const errs = validateManifest(null, emptyCtx())
    expect(errs[0].message).toContain('对象')
  })

  it('command id 重复拒绝', () => {
    const errs = validateManifest(
      base({
        commands: [
          { id: 'a', title: 'A' },
          { id: 'a', title: 'B' }
        ]
      }),
      emptyCtx()
    )
    expect(errs.some((e) => e.field === 'commands' && e.message.includes('重复'))).toBe(true)
  })
})
