// deepToPlain 单测：reactive 代理逐层 toRaw 解包重建纯对象，硬门槛是 structuredClone（contextBridge 同款克隆器）不抛；
// 端到端用例复现 host.storage.set 直传代理导致持久化静默丢失的 bug。
import { describe, expect, it } from 'vitest'
import { reactive, ref, shallowRef, toRaw } from 'vue'
import { deepToPlain } from '../src/renderer/src/core/deep-to-plain'
import { createHostClient } from '../src/renderer/src/core/host-client'

// 递归断言无任何成员是 reactive 代理（代理上 __v_raw 可读出 raw 目标，纯对象读出 undefined）
function assertNoProxy(v: unknown, seen: Set<unknown> = new Set()): void {
  if (v === null || typeof v !== 'object') return
  expect((v as { __v_raw?: unknown }).__v_raw).toBeUndefined()
  if (seen.has(v)) return
  seen.add(v)
  if (Array.isArray(v)) {
    for (const item of v) assertNoProxy(item, seen)
    return
  }
  if (v instanceof Map) {
    for (const [k, item] of v) {
      assertNoProxy(k, seen)
      assertNoProxy(item, seen)
    }
    return
  }
  if (v instanceof Set) {
    for (const item of v) assertNoProxy(item, seen)
    return
  }
  for (const key of Object.keys(v)) assertNoProxy((v as Record<string, unknown>)[key], seen)
}

describe('deepToPlain', () => {
  it('reactive 深层对象：克隆不抛、内容等值、自身非代理且无代理成员', () => {
    const src = reactive({ list: [{ n: 1 }, { n: 2 }], s: 'x', nested: { deep: { v: true } } })
    const out = deepToPlain(src)
    expect(() => structuredClone(out)).not.toThrow()
    expect(out).toEqual({ list: [{ n: 1 }, { n: 2 }], s: 'x', nested: { deep: { v: true } } })
    expect(toRaw(out)).toBe(out)
    assertNoProxy(out)
  })

  it('ref.value（对象）与 shallowRef.value（含代理成员）解包', () => {
    const outR = deepToPlain(ref({ a: 1, inner: { b: 'x' } }).value)
    expect(() => structuredClone(outR)).not.toThrow()
    expect(toRaw(outR)).toBe(outR)
    assertNoProxy(outR)
    expect(outR).toEqual({ a: 1, inner: { b: 'x' } })

    const outSr = deepToPlain(shallowRef({ p: reactive({ q: 1 }) }).value)
    expect(() => structuredClone(outSr)).not.toThrow()
    assertNoProxy(outSr)
    expect(outSr).toEqual({ p: { q: 1 } })
  })

  it('嵌套数组含代理成员、对象键值是独立代理', () => {
    const inner = reactive({ b: 1 })
    const out = deepToPlain([{ list: [inner] }, { inner }])
    expect(() => structuredClone(out)).not.toThrow()
    assertNoProxy(out)
    expect(out).toEqual([{ list: [{ b: 1 }] }, { inner: { b: 1 } }])
  })

  it('原始值/Date 原样返回；Map/Set 重建（成员里的代理也要解）', () => {
    expect(deepToPlain(42)).toBe(42)
    expect(deepToPlain('str')).toBe('str')
    expect(deepToPlain(true)).toBe(true)
    expect(deepToPlain(null)).toBe(null)
    expect(deepToPlain(undefined)).toBe(undefined)
    const d = new Date('2024-01-01T00:00:00Z')
    expect(deepToPlain(d)).toBe(d)
    expect(structuredClone(deepToPlain(d))).toEqual(d)
    const m = new Map([['k', 1]])
    expect(deepToPlain(m)).toEqual(new Map([['k', 1]]))
    expect(deepToPlain(reactive(m))).toEqual(new Map([['k', 1]]))
    const s = new Set([1, 2])
    expect(deepToPlain(s)).toEqual(new Set([1, 2]))
    expect(deepToPlain(reactive(s))).toEqual(new Set([1, 2]))
    // 往普通 Map/Set 里手动塞代理（绕过 reactive 写入路径的 toRaw），克隆仍须不抛
    const pm = new Map<unknown, unknown>()
    pm.set(reactive({ k: 1 }), reactive({ v: 1 }))
    const ps = new Set<unknown>([reactive({ n: 1 })])
    const outM = deepToPlain(pm)
    const outS = deepToPlain(ps)
    expect(() => structuredClone(outM)).not.toThrow()
    expect(() => structuredClone(outS)).not.toThrow()
    assertNoProxy(outM)
    assertNoProxy(outS)
  })

  it('环引用：重建不栈溢出、克隆不抛、回填已重建引用', () => {
    const p = reactive<{ self?: unknown; n: number }>({ n: 1 })
    p.self = p
    const out = deepToPlain(p)
    expect(() => structuredClone(out)).not.toThrow()
    expect((out as { self?: unknown }).self).toBe(out)
    assertNoProxy(out)

    // 环穿过独立代理成员：原对象成员仍是代理，回填必须是已重建引用而非原对象
    const inner = reactive<{ holder?: unknown }>({})
    const holder = { inner }
    inner.holder = holder
    const outH = deepToPlain(holder)
    expect(() => structuredClone(outH)).not.toThrow()
    assertNoProxy(outH)
    expect((outH as { inner: { holder?: unknown } }).inner.holder).toBe(outH)
  })

  it('空对象/空数组/null/undefined', () => {
    expect(deepToPlain({})).toEqual({})
    expect(deepToPlain([])).toEqual([])
    expect(deepToPlain(reactive({}))).toEqual({})
    expect(deepToPlain(reactive([]))).toEqual([])
    expect(deepToPlain(null)).toBe(null)
    expect(deepToPlain(undefined)).toBe(undefined)
  })

  it('端到端：host.storage.set 直传 reactive 代理，call() 解包后过桥不再抛克隆错', async () => {
    const calls: { id: string; api: string; args: unknown[] }[] = []
    const prevWindow = (globalThis as { window?: unknown }).window
    // fake 用真实 structuredClone 复现桥面行为：args 混入代理即抛，即本 bug 的精确复现器
    ;(globalThis as { window?: unknown }).window = {
      gtools: {
        invoke: (id: string, api: string, args: unknown[]) => {
          structuredClone(args)
          calls.push({ id, api, args })
          return Promise.resolve({ ok: true, data: null })
        }
      }
    }
    try {
      const host = createHostClient('x')
      await host.storage.set('k', reactive({ a: [reactive({ b: 1 })] }))
      const setCall = calls.find((c) => c.id === 'x' && c.api === 'storage.set')
      expect(setCall).toBeDefined()
      assertNoProxy(setCall?.args)
      expect(setCall?.args[1]).toEqual({ a: [{ b: 1 }] })
    } finally {
      if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window
      else (globalThis as { window?: unknown }).window = prevWindow
    }
  })
})
