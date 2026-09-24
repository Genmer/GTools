import { describe, expect, it } from 'vitest'
import type { FloatWindowEvent } from '../../../../sdk/api'
import {
  createPinRuntime,
  reduceFloatEvent,
  registerPin,
  dropPin
} from '../../../../src/plugins/float-image/logic/controller'
import { DEFAULT_PERSIST } from '../../../../src/plugins/float-image/logic/state'

function ev(id: string, event: string, payload: unknown): FloatWindowEvent {
  return { id, event, payload }
}

describe('reduceFloatEvent', () => {
  it('zoom：按回传的当前尺寸等比缩放，并回写倍率记忆', () => {
    let rt = createPinRuntime(DEFAULT_PERSIST)
    rt = registerPin(rt, 'w1', { width: 400, height: 300 })
    const r = reduceFloatEvent(rt, ev('w1', 'zoom', { factor: 1.25, width: 400, height: 328 }))
    expect(r.actions).toEqual([
      { kind: 'update', id: 'w1', patch: { width: 500, height: 410 } },
      { kind: 'persist' }
    ])
    expect(r.runtime.persist.scale).toBeCloseTo(1.25)
  })

  it('zoom：未知原图尺寸时只改窗口不动倍率记忆', () => {
    const rt = createPinRuntime(DEFAULT_PERSIST)
    const r = reduceFloatEvent(rt, ev('later', 'zoom', { factor: 0.8, width: 400, height: 228 }))
    expect(r.actions[0]).toEqual({ kind: 'update', id: 'later', patch: { width: 320, height: 182 } })
    expect(r.runtime.persist.scale).toBe(1)
    expect(r.runtime.openIds).toContain('later')
  })

  it('reset：登记原图尺寸并还原 1:1（超限按实际显示倍率记录）', () => {
    let rt = createPinRuntime(DEFAULT_PERSIST)
    rt = registerPin(rt, 'w1', { width: 400, height: 300 })
    const r = reduceFloatEvent(rt, ev('w1', 'reset', { naturalWidth: 6000, naturalHeight: 4000 }))
    expect(r.runtime.naturals.w1).toEqual({ width: 6000, height: 4000 })
    expect(r.actions[0]).toEqual({ kind: 'update', id: 'w1', patch: { width: 4000, height: 4000 } })
    expect(r.runtime.persist.scale).toBeCloseTo(4000 / 6000)
  })

  it('state：位置/不透明度入记忆，宽度推算倍率', () => {
    let rt = createPinRuntime(DEFAULT_PERSIST)
    rt = registerPin(rt, 'w1', { width: 400, height: 300 })
    const r = reduceFloatEvent(
      rt,
      ev('w1', 'state', { x: 120, y: 66, width: 500, height: 403, opacity: 0.45 })
    )
    expect(r.actions).toEqual([{ kind: 'persist' }])
    expect(r.runtime.persist).toEqual({ v: 1, x: 120, y: 66, scale: 1.25, opacity: 0.45 })
  })

  it('state：未知 id 自动登记（重挂载后找回计数）', () => {
    const rt = createPinRuntime(DEFAULT_PERSIST)
    const r = reduceFloatEvent(rt, ev('ghost', 'state', { x: 1, y: 2, width: 300, height: 300 }))
    expect(r.runtime.openIds).toContain('ghost')
    expect(r.runtime.persist.x).toBe(1)
  })

  it('closing：移出已知窗口列表', () => {
    let rt = createPinRuntime(DEFAULT_PERSIST)
    rt = registerPin(rt, 'w1', { width: 400, height: 300 })
    const r = reduceFloatEvent(rt, ev('w1', 'closing', null))
    expect(r.runtime.openIds).toEqual([])
    expect(r.runtime.naturals.w1).toBeUndefined()
  })

  it('dropPin：手动摘除', () => {
    let rt = createPinRuntime(DEFAULT_PERSIST)
    rt = registerPin(rt, 'a', { width: 10, height: 10 })
    rt = registerPin(rt, 'b', { width: 10, height: 10 })
    expect(dropPin(rt, 'a').openIds).toEqual(['b'])
  })

  it('畸形事件与载荷一律无动作', () => {
    const rt = createPinRuntime(DEFAULT_PERSIST)
    expect(reduceFloatEvent(rt, { id: '', event: 'zoom', payload: {} } as FloatWindowEvent).actions).toEqual([])
    expect(reduceFloatEvent(rt, ev('w1', 'zoom', 'junk')).actions).toEqual([])
    expect(reduceFloatEvent(rt, ev('w1', 'reset', { naturalWidth: 0, naturalHeight: 5 })).actions).toEqual([])
    expect(reduceFloatEvent(rt, ev('w1', 'state', { x: 'a' })).actions).toEqual([])
    expect(reduceFloatEvent(rt, ev('w1', 'unknown-event', 1)).actions).toEqual([])
  })

  it('记忆值全程经 normalize 夹取，不会写入越界数据', () => {
    let rt = createPinRuntime(DEFAULT_PERSIST)
    rt = registerPin(rt, 'w1', { width: 100, height: 100 })
    const r = reduceFloatEvent(rt, ev('w1', 'state', { x: 1e9, y: 5, width: 100, height: 100 }))
    // x 越界导致整条 state 被拒，不产生 persist 动作
    expect(r.actions).toEqual([])
  })
})
