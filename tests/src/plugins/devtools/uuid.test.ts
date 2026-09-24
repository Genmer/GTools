import { describe, expect, it } from 'vitest'
import { uuidBatch, uuidV4 } from '../../../../src/plugins/devtools/views/logic/uuid'

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('devtools uuid 生成', () => {
  it('v4 格式：版本位 4、变体位 89ab', () => {
    for (let i = 0; i < 100; i++) expect(uuidV4()).toMatch(V4_RE)
  })

  it('批量生成互不重复', () => {
    const ids = uuidBatch(500)
    expect(ids).toHaveLength(500)
    expect(new Set(ids).size).toBe(500)
  })

  it('批量数量钳制在 1..1000（浮点向下取整）', () => {
    expect(uuidBatch(0)).toHaveLength(1)
    expect(uuidBatch(-5)).toHaveLength(1)
    expect(uuidBatch(2.9)).toHaveLength(2)
    expect(uuidBatch(9999)).toHaveLength(1000)
  })
})
