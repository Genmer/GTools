import { toRaw } from 'vue'

// reactive 代理过 contextBridge 结构化克隆即抛错（桥面在代理到达 preload 前抛），
// IPC 前必须逐层 toRaw 解代理并重建纯对象
export function deepToPlain<T>(value: T): T {
  return rebuild(value, new WeakMap()) as T
}

// cache 记 raw→重建结果：环引用回填"已重建引用"，返回原对象会把它内部的独立代理成员带回复制结果
function rebuild(value: unknown, cache: WeakMap<object, unknown>): unknown {
  const raw = toRaw(value)
  if (raw === null || typeof raw !== 'object') return raw
  const cached = cache.get(raw)
  if (cached !== undefined) return cached
  if (Array.isArray(raw)) {
    const arr: unknown[] = []
    cache.set(raw, arr)
    for (let i = 0; i < raw.length; i++) arr[i] = rebuild(raw[i], cache)
    return arr
  }
  // Map/Set 的克隆器不进成员，塞入前已是代理的成员须重建集合并逐条递归
  if (raw instanceof Map) {
    const map = new Map()
    cache.set(raw, map)
    for (const [k, v] of raw) map.set(rebuild(k, cache), rebuild(v, cache))
    return map
  }
  if (raw instanceof Set) {
    const set = new Set()
    cache.set(raw, set)
    for (const v of raw) set.add(rebuild(v, cache))
    return set
  }
  // 只重建纯对象（Object.prototype 或 null 原型）；Date/File 等结构化克隆本身支持，toRaw 后原样返回
  const proto = Object.getPrototypeOf(raw)
  if (proto !== Object.prototype && proto !== null) return raw
  const obj: Record<string, unknown> = {}
  cache.set(raw, obj)
  for (const key of Object.keys(raw)) obj[key] = rebuild((raw as Record<string, unknown>)[key], cache)
  return obj
}
