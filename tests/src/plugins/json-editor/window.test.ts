import { describe, expect, it } from 'vitest'
import { windowRange } from '../../../../src/plugins/json-editor/logic/window'

describe('windowRange', () => {
  it('常规窗口含 overscan 缓冲（行高参数化：树行 24 / 行号行 22 同一实现）', () => {
    expect(windowRange(1000, 0, 480, 24)).toEqual({ start: 0, end: 28 })
    expect(windowRange(1000, 24 * 100, 480, 24)).toEqual({ start: 92, end: 128 })
    expect(windowRange(1000, 0, 440, 22)).toEqual({ start: 0, end: 28 })
    expect(windowRange(1000, 22 * 50, 440, 22)).toEqual({ start: 42, end: 78 })
  })

  it('边界：滚过头/零视口/空列表钳制', () => {
    expect(windowRange(10, 99999, 480, 24)).toEqual({ start: 10, end: 10 })
    expect(windowRange(0, 100, 480, 24)).toEqual({ start: 0, end: 0 })
    expect(windowRange(100, -5, 0, 24)).toEqual({ start: 0, end: 8 })
  })

  it('正常视口（textarea 100% 高对应 clientHeight）下 169 行文档滚到底尾行仍覆盖', () => {
    // 滚到底：首行 149（(169-20)*22），可见 20 行 + overscan，end 钳到总行数 169
    expect(windowRange(169, (169 - 20) * 22, 440, 22)).toEqual({ start: 141, end: 169 })
  })
})
