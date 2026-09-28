import { describe, expect, it } from 'vitest'
import type { Permission, PluginManifest } from '@sdk/manifest'
import type { BackendContext } from '@sdk/api'
import { ClipboardHistoryBackend } from '../src/plugins/clipboard/backend'
import { CLEAR_MARKER_KEY } from '../src/plugins/clipboard/logic/history'
import { normalizePushedItem, pushedItemsToRecItems, replacePushedItems, type PushedItem } from '../src/renderer/src/core/main-push'

/**
 * backend → 渲染层 main-push 协议集成测试：真实 backend 产出事件负载，
 * 经与 App.vue plugin-event 订阅处理器相同的数组分支（normalize + 整组替换）映射为推荐行。
 * vitest 为 node 环境无 DOM，App.vue 组件层不在本测试射程，两端契约由共享纯函数承载。
 */

const clipboardManifest: PluginManifest = {
  id: 'clipboard',
  name: '剪贴板',
  version: '0.1.0',
  protocolVersion: 1,
  icon: '📋',
  keywords: ['clip'],
  activation: 'resident',
  permissions: ['mainPush'] as Permission[],
  source: 'builtin',
  entry: './index.vue'
}

/** 与 App.vue 订阅处理器同构的渲染侧消费（数组分支；单对象旧协议不在本链路） */
function consume(emit: { event?: string; payload?: unknown } | undefined, existing: PushedItem[]): PushedItem[] {
  if (!emit || emit.event !== 'main-push') return existing
  if (!Array.isArray(emit.payload)) throw new Error('本链路只发数组负载')
  const items = emit.payload
    .map((x) => normalizePushedItem(x, clipboardManifest.id, { name: clipboardManifest.name, icon: clipboardManifest.icon }))
    .filter((x): x is PushedItem => x !== null)
  return replacePushedItems(existing, items, clipboardManifest.id, [clipboardManifest])
}

function makeCtx(emits: { event: string; payload: unknown }[]): BackendContext {
  const store = new Map<string, unknown>()
  let text = ''
  return {
    apiVersion: 1,
    clipboard: {
      readText: async () => text,
      writeText: async (t) => {
        text = t
      },
      readImage: async () => null,
      writeImage: async () => {}
    },
    storage: {
      get: async <T>(key: string): Promise<T | null> => (store.has(key) ? (store.get(key) as T) : null),
      set: async (key, value) => {
        store.set(key, value)
      },
      remove: async (key) => {
        store.delete(key)
      },
      keys: async () => [...store.keys()]
    },
    net: { fetch: async () => { throw new Error('no net') }, lanAddresses: async () => [] },
    notification: { show: async () => {} },
    shell: { openApp: async () => {}, openPath: async () => {}, openExternal: async () => {} },
    window: { hide: async () => {}, float: { create: async () => '', update: async () => {}, close: async () => {}, closeAll: async () => {} } },
    screenshot: { capture: async () => ({ action: 'cancel' as const }) },
    dialog: { openFile: async () => [], saveFile: async () => null },
    fs: {
      grant: async () => {},
      read: async () => '',
      write: async () => {},
      rename: async () => {},
      remove: async () => {},
      stat: async () => null,
      list: async () => [],
      mkdir: async () => {}
    },
    app: { platform: 'test', version: '0' },
    apis: {
      invoke: () => Promise.reject(new Error('apis 未用于本测试')),
      status: () => Promise.reject(new Error('apis 未用于本测试'))
    },
    events: { on: () => () => {} },
    emit: (event: string, payload: unknown) => {
      emits.push({ event, payload })
    }
  }
}

const lastPush = (emits: { event: string; payload: unknown }[]): { event: string; payload: unknown } | undefined =>
  [...emits].reverse().find((e) => e.event === 'main-push')

describe('main-push 协议链路：clipboard backend → 渲染层推荐行', () => {
  it('连续复制三条文本 → 三条互异推荐行（pushId 去重键防塌缩）', async () => {
    const emits: { event: string; payload: unknown }[] = []
    const backend = new ClipboardHistoryBackend()
    const ctx = makeCtx(emits)
    await backend.init(ctx)

    let pushed: PushedItem[] = []
    for (const t of ['first', 'second', 'third']) {
      await ctx.clipboard.writeText(t)
      await backend.pollOnce()
      pushed = consume(lastPush(emits), pushed)
    }
    expect(pushedItemsToRecItems(pushed).map((r) => r.payload)).toEqual(['third', 'second', 'first'])
    expect(new Set(pushedItemsToRecItems(pushed).map((r) => r.key))).toHaveLength(3)
  })

  it('清空历史 → backend 重推空组 → 推荐行整组清除（无幽灵行）；再复制只恢复新行', async () => {
    const emits: { event: string; payload: unknown }[] = []
    const backend = new ClipboardHistoryBackend()
    const ctx = makeCtx(emits)
    await backend.init(ctx)

    let pushed: PushedItem[] = []
    await ctx.clipboard.writeText('kept-then-cleared')
    await backend.pollOnce()
    pushed = consume(lastPush(emits), pushed)
    expect(pushed).toHaveLength(1)

    // 渲染层清空路径：写 clear-marker，backend 采纳后重推空组（先等在途 flush 落盘，否则 syncExternal 因 dirty 早退）
    await backend.flush()
    await ctx.storage.set(CLEAR_MARKER_KEY, Date.now())
    await backend.syncExternal()
    pushed = consume(lastPush(emits), pushed)
    expect(pushed).toEqual([])

    await ctx.clipboard.writeText('new')
    await backend.pollOnce()
    pushed = consume(lastPush(emits), pushed)
    expect(pushedItemsToRecItems(pushed).map((r) => r.payload)).toEqual(['new'])
  })

  it('同组重复重推幂等：行不翻倍、key 稳定（Vue 行不闪烁的前提）', async () => {
    const emits: { event: string; payload: unknown }[] = []
    const backend = new ClipboardHistoryBackend()
    const ctx = makeCtx(emits)
    await backend.init(ctx)

    await ctx.clipboard.writeText('same')
    await backend.pollOnce()
    const first = consume(lastPush(emits), [])
    const again = consume(lastPush(emits), first)
    expect(again).toEqual(first)
    expect(pushedItemsToRecItems(again).map((r) => r.key)).toEqual(pushedItemsToRecItems(first).map((r) => r.key))
  })
})
