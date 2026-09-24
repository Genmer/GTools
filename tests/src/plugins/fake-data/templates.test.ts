import { describe, expect, it } from 'vitest'
import {
  MAX_TEMPLATES,
  normalizeTemplates,
  removeTemplate,
  sanitizeFields,
  sanitizeFormat,
  upsertTemplate,
  type FieldTemplate
} from '../../../../src/plugins/fake-data/logic/templates'
import { FIELD_DEFS } from '../../../../src/plugins/fake-data/logic/fields'

const valid: FieldTemplate = { name: '用户表', fields: ['name', 'phone', 'email'], count: 20, format: 'json' }

describe('fake-data templates', () => {
  it('sanitizeFields 过滤未知 id 并去重', () => {
    expect(sanitizeFields(['name', 'nope', 'phone', 'name'])).toEqual(['name', 'phone'])
    expect(sanitizeFields('not-array')).toEqual([])
    expect(sanitizeFields(null)).toEqual([])
    // 全量字段 id 都能通过（模板可勾任意组合）
    expect(sanitizeFields(FIELD_DEFS.map((f) => f.id))).toHaveLength(FIELD_DEFS.length)
  })

  it('sanitizeFormat 非法值回 json', () => {
    expect(sanitizeFormat('table')).toBe('table')
    expect(sanitizeFormat('csv')).toBe('json')
    expect(sanitizeFormat(undefined)).toBe('json')
  })

  it('normalizeTemplates 过滤非法项、同名去重、条数钳制', () => {
    const raw = [
      valid,
      { name: '  订单表  ', fields: ['amount', 'datetime'], count: 999, format: 'text' },
      { name: '', fields: ['name'] }, // 空名丢弃
      { name: '坏字段', fields: ['x', 'y'] }, // 字段全非法丢弃
      { name: '用户表', fields: ['name'] }, // 与第一条同名丢弃
      'garbage',
      null
    ]
    const list = normalizeTemplates(raw)
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual(valid)
    expect(list[1]).toEqual({ name: '订单表', fields: ['amount', 'datetime'], count: 100, format: 'text' })
  })

  it('normalizeTemplates 非数组输入返回空数组', () => {
    expect(normalizeTemplates(undefined)).toEqual([])
    expect(normalizeTemplates({})).toEqual([])
  })

  it('normalizeTemplates 超量截断到 MAX_TEMPLATES', () => {
    const raw = Array.from({ length: 30 }, (_, i) => ({ name: `t${i}`, fields: ['name'], count: 5, format: 'json' }))
    expect(normalizeTemplates(raw)).toHaveLength(MAX_TEMPLATES)
  })

  it('upsertTemplate 同名覆盖并置顶，超量丢最旧', () => {
    let list: FieldTemplate[] = Array.from({ length: MAX_TEMPLATES }, (_, i) => ({
      name: `t${i}`,
      fields: ['name'],
      count: 5,
      format: 'json'
    }))
    list = upsertTemplate(list, { ...valid })
    expect(list).toHaveLength(MAX_TEMPLATES)
    expect(list[0]?.name).toBe('用户表')
    expect(list.some((t) => t.name === 't11')).toBe(false) // 最旧的被挤掉

    const updated = upsertTemplate(list, { name: '用户表', fields: ['ip'], count: 3, format: 'text' })
    expect(updated).toHaveLength(MAX_TEMPLATES)
    expect(updated[0]).toEqual({ name: '用户表', fields: ['ip'], count: 3, format: 'text' })
    expect(updated.filter((t) => t.name === '用户表')).toHaveLength(1)
  })

  it('upsertTemplate 拒绝空名/空字段', () => {
    const list = [valid]
    expect(upsertTemplate(list, { name: '  ', fields: ['name'], count: 1, format: 'json' })).toEqual(list)
    expect(upsertTemplate(list, { name: 'x', fields: [], count: 1, format: 'json' })).toEqual(list)
  })

  it('removeTemplate 按名删除', () => {
    expect(removeTemplate([valid, { name: 'b', fields: ['ip'], count: 1, format: 'json' }], '用户表')).toEqual([
      { name: 'b', fields: ['ip'], count: 1, format: 'json' }
    ])
  })

  it('存储往返：JSON 序列化再 normalize 结果不变', () => {
    const list = [valid, { name: 'b', fields: ['uuid'], count: 50, format: 'table' }]
    expect(normalizeTemplates(JSON.parse(JSON.stringify(list)))).toEqual(list)
  })
})
