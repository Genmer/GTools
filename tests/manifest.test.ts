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

describe('matchers 校验（向后兼容扩展：缺省字段跳过）', () => {
  it('合法 matchers 通过（旧清单无该字段零感知）', () => {
    expect(validateManifest(base(), emptyCtx())).toEqual([])
    const m = base({
      commands: [{ id: 'cmd', title: '命令' }],
      matchers: [
        { type: 'regex', match: '\\d+', label: '数字' },
        { type: 'text', label: '文本', minLength: 2, maxLength: 100, commandId: 'cmd' },
        { type: 'json', label: 'JSON' }
      ]
    })
    expect(validateManifest(m, emptyCtx())).toEqual([])
  })

  it('matchers 非数组 / 项非对象 / type 非法 / label 空 拒绝且不抛异常', () => {
    expect(validateManifest(base({ matchers: 'x' as never }), emptyCtx())[0].field).toBe('matchers')
    const errs = validateManifest(base({ matchers: [null as never, { type: 'magic', label: 'x' } as never] }), emptyCtx())
    expect(errs.some((e) => e.message.includes('对象'))).toBe(true)
    expect(errs.some((e) => e.message.includes('type'))).toBe(true)
    expect(validateManifest(base({ matchers: [{ type: 'text', label: '' }] }), emptyCtx()).some((e) => e.message.includes('label'))).toBe(true)
  })

  it('regex 型缺 match / 非法正则 / 任意匹配正则（探针全命中）拒绝', () => {
    const noMatch = base({ matchers: [{ type: 'regex', label: 'x' }] })
    expect(validateManifest(noMatch, emptyCtx()).some((e) => e.message.includes('match'))).toBe(true)
    const invalid = base({ matchers: [{ type: 'regex', match: '([', label: 'x' }] })
    expect(validateManifest(invalid, emptyCtx()).some((e) => e.message.includes('非法'))).toBe(true)
    const catchAll = base({ matchers: [{ type: 'regex', match: '[\\s\\S]*', label: 'x' }] })
    expect(validateManifest(catchAll, emptyCtx()).some((e) => e.message.includes('任意'))).toBe(true)
    // 非任意：文件路径正则对探针串不全命中，放行
    const pathRe = base({ matchers: [{ type: 'regex', match: '(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/)[^\\s]{2,}', label: '路径' }] })
    expect(validateManifest(pathRe, emptyCtx())).toEqual([])
  })

  it('exclude 非法正则拒绝；maxLength 超 10000 拒绝；commandId 须在本清单 commands 内', () => {
    const badExclude = base({ matchers: [{ type: 'text', label: 'x', exclude: '*' }] })
    expect(validateManifest(badExclude, emptyCtx()).some((e) => e.message.includes('exclude'))).toBe(true)
    const over = base({ matchers: [{ type: 'text', label: 'x', maxLength: 10001 }] })
    expect(validateManifest(over, emptyCtx()).some((e) => e.message.includes('maxLength'))).toBe(true)
    const ghostCmd = base({ matchers: [{ type: 'text', label: 'x', commandId: 'ghost' }] })
    expect(validateManifest(ghostCmd, emptyCtx()).some((e) => e.message.includes('commandId'))).toBe(true)
    const okCmd = base({ commands: [{ id: 'a', title: 'A' }], matchers: [{ type: 'text', label: 'x', commandId: 'a' }] })
    expect(validateManifest(okCmd, emptyCtx())).toEqual([])
  })
})

describe('matchers files/img 型校验（向后兼容扩展：protocolVersion 不升版）', () => {
  it('files + extensions 合法（含 fileType 三值枚举）；img 最小声明合法', () => {
    expect(PROTOCOL_VERSION).toBe(1)
    expect(validateManifest(base({ matchers: [{ type: 'files', extensions: ['pdf'], label: 'PDF' }] }), emptyCtx())).toEqual([])
    expect(validateManifest(base({ matchers: [{ type: 'files', fileType: 'both', label: '任意' }] }), emptyCtx())).toEqual([])
    expect(validateManifest(base({ matchers: [{ type: 'files', fileType: 'file', label: '文件' }] }), emptyCtx())).toEqual([])
    expect(validateManifest(base({ matchers: [{ type: 'files', fileType: 'directory', label: '目录' }] }), emptyCtx())).toEqual([])
    expect(validateManifest(base({ matchers: [{ type: 'img', label: '图片' }] }), emptyCtx())).toEqual([])
  })

  it('extensions 含大写 / 点前缀 / 非字符串项 / 非数组 拒绝', () => {
    const upper = base({ matchers: [{ type: 'files', extensions: ['PDF'], label: 'x' }] })
    expect(validateManifest(upper, emptyCtx())[0].field).toBe('matchers[0]')
    const dotted = base({ matchers: [{ type: 'files', extensions: ['.pdf'], label: 'x' }] })
    expect(validateManifest(dotted, emptyCtx()).some((e) => e.field === 'matchers[0]')).toBe(true)
    const nonString = base({ matchers: [{ type: 'files', extensions: ['pdf', 1] as never, label: 'x' }] })
    expect(validateManifest(nonString, emptyCtx()).some((e) => e.field === 'matchers[0]')).toBe(true)
    const nonArray = base({ matchers: [{ type: 'files', extensions: 'pdf' as never, label: 'x' }] })
    expect(validateManifest(nonArray, emptyCtx()).some((e) => e.field === 'matchers[0]')).toBe(true)
  })

  it('fileType 非法值拒绝', () => {
    const bad = base({ matchers: [{ type: 'files', fileType: 'symlink' as never, label: 'x' }] })
    expect(validateManifest(bad, emptyCtx())[0].message).toContain('fileType')
  })

  it('未知 type（window）仍拒绝且协议版本不变', () => {
    expect(PROTOCOL_VERSION).toBe(1)
    const errs = validateManifest(base({ matchers: [{ type: 'window', label: 'x' } as never] }), emptyCtx())
    expect(errs.some((e) => e.message.includes('type'))).toBe(true)
  })
})

describe('subInput 声明校验（可选扩展字段：旧清单缺省零感知）', () => {
  it('含 subInput:{placeholder} 的清单通过；省略 placeholder 亦通过', () => {
    expect(validateManifest(base({ subInput: { placeholder: '输入文件名…' } }), emptyCtx())).toEqual([])
    expect(validateManifest(base({ subInput: {} }), emptyCtx())).toEqual([])
  })

  it('subInput 非对象 / placeholder 非字符串或空串 拒绝且不抛异常', () => {
    expect(validateManifest(base({ subInput: 'x' as never }), emptyCtx())[0].field).toBe('subInput')
    expect(validateManifest(base({ subInput: null as never }), emptyCtx())[0].field).toBe('subInput')
    const numPh = validateManifest(base({ subInput: { placeholder: 1 as never } }), emptyCtx())
    expect(numPh[0].field).toBe('subInput.placeholder')
    const emptyPh = validateManifest(base({ subInput: { placeholder: '' } }), emptyCtx())
    expect(emptyPh[0].field).toBe('subInput.placeholder')
  })
})
