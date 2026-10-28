import { describe, expect, it } from 'vitest'
import type { Permission, PluginManifest } from '@sdk/manifest'
import type { BackendContext } from '@sdk/api'
import { normalizePushedItem, pushedItemsToRecItems, replacePushedItems, type PushedItem } from '../src/renderer/src/core/main-push'

/**
 * backend → 渲染层 main-push 协议集成测试：真实 clipboard 插件的推送已拆除（其 backend 不再 emit），
 * 改用合成常驻 backend 重演同一协议（整组全量重推数组负载），仍覆盖
 * emit → normalize → 整组替换 → RecItem 的渲染层链路（与 App.vue plugin-event 订阅处理器同构）。
 */

const pusherManifest: PluginManifest = {
  id: 'pusher',
  name: '推送方',
  version: '0.1.0',
  protocolVersion: 1,
  icon: '📮',
  keywords: ['push'],
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
    .map((x) => normalizePushedItem(x, pusherManifest.id, { name: pusherManifest.name, icon: pusherManifest.icon }))
    .filter((x): x is PushedItem => x !== null)
  return replacePushedItems(existing, items, pusherManifest.id, [pusherManifest])
}

/** 最小可用 BackendContext 切片（合成 backend 只用 clipboard+emit，其余面不进本链路） */
function makeCtx(emits: { event: string; payload: unknown }[]): Pick<BackendContext, 'clipboard' | 'emit'> {
  let text = ''
  return {
    clipboard: {
      readText: async () => text,
      writeText: async (t) => {
        text = t
      },
      writeTextEphemeral: async (t) => {
        text = t
      },
      isTextExempted: async () => false,
      readImage: async () => null,
      writeImage: async () => {}
    },
    emit: (event: string, payload: unknown) => {
      emits.push({ event, payload })
    }
  }
}

/**
 * 合成常驻 backend：轮询剪贴板并整组重推（无命令行走 pushId 稳定标识），
 * 模拟真实插件「采集 → emit('main-push', 全量数组)」的 backend 侧协议。
 */
class SyntheticPushBackend {
  private rows: { pushId: string; title: string; payloadText: string }[] = []
  private seq = 0

  async pollOnce(ctx: Pick<BackendContext, 'clipboard' | 'emit'>): Promise<void> {
    const text = (await ctx.clipboard.readText()).trim()
    if (text === '' || this.rows.some((r) => r.payloadText === text)) return
    this.rows.unshift({ pushId: `r${++this.seq}`, title: text.slice(0, 40), payloadText: text })
    ctx.emit('main-push', this.rows)
  }

  async clear(ctx: Pick<BackendContext, 'clipboard' | 'emit'>): Promise<void> {
    this.rows = []
    ctx.emit('main-push', this.rows)
  }

  /** 同组重推（内容未变也全量 emit）：验证整组替换幂等 */
  async replay(ctx: Pick<BackendContext, 'clipboard' | 'emit'>): Promise<void> {
    ctx.emit('main-push', this.rows)
  }
}

const lastPush = (emits: { event: string; payload: unknown }[]): { event: string; payload: unknown } | undefined =>
  [...emits].reverse().find((e) => e.event === 'main-push')

describe('main-push 协议链路：合成 backend → 渲染层推荐行', () => {
  it('连续复制三条文本 → 三条互异推荐行（pushId 去重键防塌缩）', async () => {
    const emits: { event: string; payload: unknown }[] = []
    const backend = new SyntheticPushBackend()
    const ctx = makeCtx(emits)

    let pushed: PushedItem[] = []
    for (const t of ['first', 'second', 'third']) {
      await ctx.clipboard.writeText(t)
      await backend.pollOnce(ctx)
      pushed = consume(lastPush(emits), pushed)
    }
    expect(pushedItemsToRecItems(pushed).map((r) => r.payload)).toEqual(['third', 'second', 'first'])
    expect(new Set(pushedItemsToRecItems(pushed).map((r) => r.key))).toHaveLength(3)
  })

  it('清空历史 → backend 重推空组 → 推荐行整组清除（无幽灵行）；再复制只恢复新行', async () => {
    const emits: { event: string; payload: unknown }[] = []
    const backend = new SyntheticPushBackend()
    const ctx = makeCtx(emits)

    let pushed: PushedItem[] = []
    await ctx.clipboard.writeText('kept-then-cleared')
    await backend.pollOnce(ctx)
    pushed = consume(lastPush(emits), pushed)
    expect(pushed).toHaveLength(1)

    await backend.clear(ctx)
    pushed = consume(lastPush(emits), pushed)
    expect(pushed).toEqual([])

    await ctx.clipboard.writeText('new')
    await backend.pollOnce(ctx)
    pushed = consume(lastPush(emits), pushed)
    expect(pushedItemsToRecItems(pushed).map((r) => r.payload)).toEqual(['new'])
  })

  it('同组重复重推幂等：行不翻倍、key 稳定（Vue 行不闪烁的前提）', async () => {
    const emits: { event: string; payload: unknown }[] = []
    const backend = new SyntheticPushBackend()
    const ctx = makeCtx(emits)

    await ctx.clipboard.writeText('same')
    await backend.pollOnce(ctx)
    const first = consume(lastPush(emits), [])
    // 内容未变的同组重推：整组替换后行不翻倍
    await backend.replay(ctx)
    const again = consume(lastPush(emits), first)
    expect(again).toEqual(first)
    expect(pushedItemsToRecItems(again).map((r) => r.key)).toEqual(pushedItemsToRecItems(first).map((r) => r.key))
  })
})
