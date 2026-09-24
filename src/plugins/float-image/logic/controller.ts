// 浮窗回传事件的纯 reducer：输入当前运行态 + 事件，输出新状态与待执行动作，视图层只做副作用
import type { FloatWindowEvent } from '@sdk/api'
import {
  applyZoom,
  clampScale,
  normalizePersist,
  parseResetPayload,
  parseStateReport,
  parseZoomPayload,
  resetSize,
  type FloatImagePersist,
  type NaturalSize
} from './state'

export interface PinRuntime {
  persist: FloatImagePersist
  /** id → 原图尺寸：创建时登记；重挂载丢失后由 reset 事件回填 */
  naturals: Record<string, NaturalSize>
  /** 本会话已知悬浮窗 id（尽力而为的计数；宿主无枚举 API） */
  openIds: string[]
}

export type PinAction =
  | { kind: 'update'; id: string; patch: { width: number; height: number } }
  | { kind: 'persist' }

export function createPinRuntime(persist: FloatImagePersist): PinRuntime {
  return { persist: normalizePersist(persist), naturals: {}, openIds: [] }
}

function withPersist(rt: PinRuntime, persist: FloatImagePersist): PinRuntime {
  return { ...rt, persist: normalizePersist(persist) }
}

function registerId(rt: PinRuntime, id: string): PinRuntime {
  return rt.openIds.includes(id) ? rt : { ...rt, openIds: [...rt.openIds, id] }
}

export function registerPin(rt: PinRuntime, id: string, natural: NaturalSize): PinRuntime {
  return { ...registerId(rt, id), naturals: { ...rt.naturals, [id]: natural } }
}

export function dropPin(rt: PinRuntime, id: string): PinRuntime {
  const naturals = { ...rt.naturals }
  delete naturals[id]
  return { ...rt, openIds: rt.openIds.filter((x) => x !== id), naturals }
}

/** 由实际窗口宽推算显示倍率（宿主 clamp 后的宽度即真实显示宽） */
function scaleFor(rt: PinRuntime, id: string, width: number): number | null {
  const natural = rt.naturals[id]
  if (!natural || natural.width <= 0) return null
  return clampScale(width / natural.width)
}

export function reduceFloatEvent(
  rt: PinRuntime,
  ev: FloatWindowEvent
): { runtime: PinRuntime; actions: PinAction[] } {
  if (typeof ev?.id !== 'string' || ev.id === '' || typeof ev.event !== 'string') {
    return { runtime: rt, actions: [] }
  }
  let next = registerId(rt, ev.id)

  if (ev.event === 'zoom') {
    const z = parseZoomPayload(ev.payload)
    if (!z) return { runtime: next, actions: [] }
    const size = applyZoom({ width: z.width, height: z.height }, z.factor)
    const scale = scaleFor(next, ev.id, size.width)
    if (scale !== null) next = withPersist(next, { ...next.persist, scale })
    return { runtime: next, actions: [{ kind: 'update', id: ev.id, patch: size }, { kind: 'persist' }] }
  }

  if (ev.event === 'reset') {
    const natural = parseResetPayload(ev.payload)
    if (!natural) return { runtime: next, actions: [] }
    next = { ...next, naturals: { ...next.naturals, [ev.id]: natural } }
    const size = resetSize(natural)
    const scale = scaleFor(next, ev.id, size.width)
    if (scale !== null) next = withPersist(next, { ...next.persist, scale })
    return { runtime: next, actions: [{ kind: 'update', id: ev.id, patch: size }, { kind: 'persist' }] }
  }

  if (ev.event === 'state') {
    const s = parseStateReport(ev.payload)
    if (!s) return { runtime: next, actions: [] }
    const persist: FloatImagePersist = {
      ...next.persist,
      x: s.x,
      y: s.y,
      opacity: s.opacity ?? next.persist.opacity
    }
    const scale = scaleFor(next, ev.id, s.width)
    if (scale !== null) persist.scale = scale
    return { runtime: withPersist(next, persist), actions: [{ kind: 'persist' }] }
  }

  if (ev.event === 'closing') {
    return { runtime: dropPin(next, ev.id), actions: [] }
  }

  return { runtime: next, actions: [] }
}
