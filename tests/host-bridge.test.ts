// host-bridge 单测：host() 是 gtools:host 渲染层单点，载荷经 deepToPlain 解代理后过桥；
// fake 桥面用真实 structuredClone 复现 contextBridge 克隆行为（代理即抛）。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reactive } from 'vue'
import { host } from '../src/renderer/src/core/host-bridge'

interface Recorded {
  api: string
  payload: unknown
}

const calls: Recorded[] = []
const prevWindow = (globalThis as { window?: unknown }).window

function fakeHost(api: string, payload?: unknown): Promise<{ ok: boolean; data?: unknown }> {
  structuredClone(payload)
  calls.push({ api, payload })
  return Promise.resolve({ ok: true, data: null })
}

// 递归断言无成员是 reactive 代理（代理上 __v_raw 可读出 raw 目标，纯对象读出 undefined）
function assertNoProxy(v: unknown): void {
  if (v === null || typeof v !== 'object') return
  expect((v as { __v_raw?: unknown }).__v_raw).toBeUndefined()
  if (Array.isArray(v)) {
    for (const item of v) assertNoProxy(item)
    return
  }
  for (const key of Object.keys(v)) assertNoProxy((v as Record<string, unknown>)[key])
}

beforeEach(() => {
  calls.length = 0
  ;(globalThis as { window?: unknown }).window = { gtools: { host: fakeHost } }
})

afterEach(() => {
  if (prevWindow === undefined) delete (globalThis as { window?: unknown }).window
  else (globalThis as { window?: unknown }).window = prevWindow
})

describe('host-bridge host()', () => {
  it('reactive 深代理载荷（模拟 SettingsPage patch：对象含数组含代理元素）克隆不抛、收到端无代理且内容等值', async () => {
    // 模拟命令热键保存：展开 props.settings.commandHotkeys，保留项仍是代理
    const kept = reactive({ pluginId: 'p1', commandId: 'c1', darwin: 'Cmd+K', win32: 'Ctrl+K' })
    const fresh = { pluginId: 'p2', commandId: 'c2', darwin: 'Cmd+J', win32: 'Ctrl+J' }
    const payload = { commandHotkeys: [kept, fresh] }
    const r = await host('settings:set', payload)
    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].api).toBe('settings:set')
    assertNoProxy(calls[0].payload)
    expect(calls[0].payload).toEqual({ commandHotkeys: [kept, fresh] })
  })

  it('无载荷调用形状不变（payload undefined）', async () => {
    const r = await host('window:hide')
    expect(r).toEqual({ ok: true, data: null })
    expect(calls).toHaveLength(1)
    expect(calls[0].api).toBe('window:hide')
    expect(calls[0].payload).toBeUndefined()
  })

  it('原始值载荷（字符串/数字）原样过桥', async () => {
    await host('example:str', 'text')
    await host('example:num', 42)
    expect(calls.map((c) => c.payload)).toEqual(['text', 42])
  })
})
