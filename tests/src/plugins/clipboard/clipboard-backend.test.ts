import { describe, expect, it } from 'vitest'
import defaultBackend, {
  ClipboardHistoryBackend,
  POLL_INTERVAL_MS,
  SYNC_INTERVAL_MS,
  type BackendScheduler
} from '../../../../src/plugins/clipboard/backend'
import { MAX_TEXT_CHARS, toPersisted } from '../../../../src/plugins/clipboard/logic/history'
import type { BackendContext } from '@sdk/api'

type Timer = { id: number; fn: () => void; ms: number; cleared: boolean }

class ManualScheduler implements BackendScheduler {
  readonly timers: Timer[] = []
  private seq = 0

  setInterval(fn: () => void, ms: number): unknown {
    const t: Timer = { id: ++this.seq, fn, ms, cleared: false }
    this.timers.push(t)
    return t.id
  }

  clearInterval(id: unknown): void {
    const t = this.timers.find((x) => x.id === id)
    if (t !== undefined) t.cleared = true
  }

  live(): Timer[] {
    return this.timers.filter((t) => !t.cleared)
  }
}

function pngDataUrl(seed: string, size = 16): string {
  const body = Buffer.concat([Buffer.from(seed), Buffer.alloc(size, 0x7f)])
  return `data:image/png;base64,${body.toString('base64')}`
}

interface Harness {
  backend: ClipboardHistoryBackend
  scheduler: ManualScheduler
  clipboard: {
    text: string
    image: { width: number; height: number; dataUrl: string } | null
    failReadText: boolean
  }
  storage: Map<string, unknown>
  emits: { event: string; payload: unknown }[]
  calls: { readImage: number }
}

async function makeHarness(seedState?: unknown): Promise<Harness> {
  const scheduler = new ManualScheduler()
  const storage = new Map<string, unknown>(seedState === undefined ? [] : [['state', seedState]])
  const clipboard = { text: '', image: null as { width: number; height: number; dataUrl: string } | null, failReadText: false }
  const emits: { event: string; payload: unknown }[] = []
  const calls = { readImage: 0 }
  const ctx: BackendContext = {
    apiVersion: 1,
    clipboard: {
      readText: async () => {
        if (clipboard.failReadText) throw new Error('clipboard busy')
        return clipboard.text
      },
      writeText: async (t) => {
        clipboard.text = t
      },
      readImage: async () => {
        calls.readImage++
        return clipboard.image
      },
      writeImage: async (d) => {
        clipboard.image = { width: 0, height: 0, dataUrl: d }
      }
    },
    storage: {
      get: async <T>(key: string): Promise<T | null> => (storage.has(key) ? (storage.get(key) as T) : null),
      set: async (key: string, value: unknown) => {
        storage.set(key, value)
      },
      remove: async (key: string) => {
        storage.delete(key)
      },
      keys: async () => [...storage.keys()]
    },
    net: { fetch: async () => { throw new Error('no net in test') }, lanAddresses: async () => [] },
    notification: { show: async () => {} },
    shell: { openApp: async () => {}, openPath: async () => {}, openExternal: async () => {} },
    window: {
      hide: async () => {},
      float: {
        create: async () => '',
        update: async () => {},
        close: async () => {},
        closeAll: async () => {}
      }
    },
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
  const backend = new ClipboardHistoryBackend(scheduler)
  await backend.init(ctx)
  return { backend, scheduler, clipboard, storage, emits, calls }
}

const storedStateOf = (h: Harness): { settings: { maxRecords: number; clearOnExit: boolean }; records: unknown[] } =>
  h.storage.get('state') as { settings: { maxRecords: number; clearOnExit: boolean }; records: unknown[] }

describe('clipboard backend 轮询与去重', () => {
  it('init 从持久化恢复，启动时对最新内容不重复记录', async () => {
    const h = await makeHarness(
      toPersisted({ maxRecords: 10, clearOnExit: false }, [{ id: 'r1', kind: 'text', ts: 111, text: 'hello' }])
    )
    h.clipboard.text = 'hello'
    await h.backend.start()
    expect(h.backend.snapshot()).toHaveLength(1)
    await h.backend.flush()
    expect(storedStateOf(h)?.records).toHaveLength(1)
    await h.backend.stop()
  })

  it('文本变化才记录：相同内容重复轮询不新增', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'a'
    await h.backend.pollOnce()
    await h.backend.pollOnce()
    expect(h.backend.snapshot()).toHaveLength(1)
    h.clipboard.text = 'b'
    await h.backend.pollOnce()
    await h.backend.pollOnce()
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['b', 'a'])
    expect(h.emits.some((e) => e.event === 'history-changed')).toBe(true)
  })

  it('A→B→A 重新记录（去重只对比最新一条）', async () => {
    const h = await makeHarness()
    for (const t of ['a', 'b', 'a']) {
      h.clipboard.text = t
      await h.backend.pollOnce()
    }
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['a', 'b', 'a'])
  })

  it('仅文本为空时才读图（省解码开销），图片按指纹去重', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'x'
    await h.backend.pollOnce()
    expect(h.calls.readImage).toBe(0)

    h.clipboard.text = ''
    h.clipboard.image = { width: 800, height: 600, dataUrl: pngDataUrl('s1') }
    await h.backend.pollOnce()
    await h.backend.pollOnce()
    const snap = h.backend.snapshot()
    expect(snap).toHaveLength(2) // [图片, 之前的文本]
    expect(snap[0]).toMatchObject({ kind: 'image', width: 800, height: 600 })
    expect(h.calls.readImage).toBe(2)
  })

  it('图片经文本中转后再次复制会重新记录', async () => {
    const h = await makeHarness()
    h.clipboard.image = { width: 10, height: 10, dataUrl: pngDataUrl('s1') }
    await h.backend.pollOnce()
    h.clipboard.text = 't'
    h.clipboard.image = { width: 10, height: 10, dataUrl: pngDataUrl('s1') }
    await h.backend.pollOnce()
    h.clipboard.text = ''
    await h.backend.pollOnce()
    const snap = h.backend.snapshot()
    expect(snap).toHaveLength(3)
    expect(snap[0]?.kind).toBe('image')
    expect(snap[1]?.kind).toBe('text')
  })

  it('超大文本不记录，后续正常文本不受影响', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'x'.repeat(MAX_TEXT_CHARS + 1)
    await h.backend.pollOnce()
    await h.backend.pollOnce()
    expect(h.backend.snapshot()).toHaveLength(0)
    h.clipboard.text = 'small'
    await h.backend.pollOnce()
    expect(h.backend.snapshot()).toHaveLength(1)
  })

  it('读剪贴板异常不崩、不记录', async () => {
    const h = await makeHarness()
    h.clipboard.failReadText = true
    await expect(h.backend.pollOnce()).resolves.toBeUndefined()
    expect(h.backend.snapshot()).toHaveLength(0)
    h.clipboard.failReadText = false
    h.clipboard.text = 'ok'
    await h.backend.pollOnce()
    expect(h.backend.snapshot()).toHaveLength(1)
  })
})

describe('clipboard backend 容量与清空', () => {
  it('容量上限淘汰最旧（设置来自持久化，含非法值收敛）', async () => {
    const h = await makeHarness(toPersisted({ maxRecords: 10, clearOnExit: false }, []))
    const texts = Array.from({ length: 12 }, (_, i) => `t${i}`)
    for (const t of texts) {
      h.clipboard.text = t
      await h.backend.pollOnce()
      await h.backend.flush()
    }
    expect(h.backend.snapshot()).toHaveLength(10)
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).not.toContain('t0')
    expect(h.backend.snapshot()[0]).toMatchObject({ kind: 'text', text: 't11' })
    expect(storedStateOf(h)?.records).toHaveLength(10)
  })

  it('键缺失/瞬时读失败（get 为 null）不清内存，历史不丢', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'a'
    await h.backend.pollOnce()
    await h.backend.flush()
    expect(storedStateOf(h)?.records).toHaveLength(1)

    h.storage.delete('state') // 读失败也表现为 null，与用户清空不可区分，按不清处理
    await h.backend.syncExternal()
    expect(h.backend.snapshot()).toHaveLength(1)
    expect(h.emits.some((e) => e.event === 'history-changed' && (e.payload as { count: number }).count === 0)).toBe(false)

    h.clipboard.text = 'b'
    await h.backend.pollOnce()
    await h.backend.flush()
    expect(h.backend.snapshot()).toHaveLength(2) // 'a' 未丢，新记录正常追加
    expect(storedStateOf(h)?.records).toHaveLength(2)
  })

  it('渲染层清空走 clear-marker 标记：backend 采纳后清内存并落盘空状态', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'a'
    await h.backend.pollOnce()
    await h.backend.flush()
    h.storage.set('clear-marker', 42)
    await h.backend.syncExternal()
    expect(h.backend.snapshot()).toHaveLength(0)
    expect(storedStateOf(h)?.records).toHaveLength(0)
    expect(h.emits.some((e) => e.event === 'history-changed' && (e.payload as { count: number }).count === 0)).toBe(true)
  })

  it('清空后新复制的内容保留（标记采纳先于 commit）', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'a'
    await h.backend.pollOnce()
    await h.backend.flush()
    h.storage.set('clear-marker', 42)
    h.clipboard.text = 'b'
    await h.backend.pollOnce() // pre-commit syncExternal 先采纳清空，再记录 'b'
    await h.backend.flush()
    expect(h.backend.snapshot()).toHaveLength(1)
    expect(storedStateOf(h)?.records).toHaveLength(1)
  })

  it('渲染层改容量：设置生效并重收敛，records 非空时以内存为准', async () => {
    const h = await makeHarness()
    const texts = Array.from({ length: 12 }, (_, i) => `t${i}`)
    for (const t of texts) {
      h.clipboard.text = t
      await h.backend.pollOnce()
      await h.backend.flush()
    }
    h.storage.set('state', { v: 1, settings: { maxRecords: 10, clearOnExit: false }, records: [{ id: 'stale', kind: 'text', ts: 1, text: 'stale' }] })
    await h.backend.syncExternal()
    await h.backend.flush()
    expect(h.backend.snapshot()).toHaveLength(10)
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).not.toContain('t0')
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).not.toContain('stale')
    expect(storedStateOf(h)?.records).toHaveLength(10)
  })
})

describe('clipboard backend 生命周期', () => {
  it('start 立即轮询一次并注册 1s 轮询 + 5s 外部同步两个定时器；重复 start 幂等', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'boot'
    await h.backend.start()
    expect(h.backend.snapshot()).toHaveLength(1)
    const ms = h.scheduler.live().map((t) => t.ms).sort((a, b) => a - b)
    expect(ms).toEqual([POLL_INTERVAL_MS, SYNC_INTERVAL_MS])
    expect(POLL_INTERVAL_MS).toBe(1000)
    await h.backend.start()
    expect(h.scheduler.live()).toHaveLength(2)
    await h.backend.stop()
  })

  it('stop 停掉全部定时器并落盘（B3：此后不再产生记录）', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'a'
    await h.backend.start()
    h.clipboard.text = 'b'
    await h.backend.stop()
    expect(h.scheduler.live()).toHaveLength(0)
    await h.backend.flush()
    expect(storedStateOf(h)?.records).toHaveLength(1)
  })

  it('dispose 按「退出时清空」设置决定是否清历史', async () => {
    const wipe = await makeHarness(toPersisted({ maxRecords: 10, clearOnExit: true }, [{ id: 'r1', kind: 'text', ts: 1, text: 'old' }]))
    await wipe.backend.dispose()
    expect(storedStateOf(wipe)?.records).toHaveLength(0)

    const keep = await makeHarness(toPersisted({ maxRecords: 10, clearOnExit: false }, [{ id: 'r1', kind: 'text', ts: 1, text: 'old' }]))
    keep.clipboard.text = 'new'
    await keep.backend.pollOnce()
    await keep.backend.flush()
    await keep.backend.dispose()
    expect(storedStateOf(keep)?.records).toHaveLength(2)
  })

  it('默认导出是可直接装配的 PluginBackend 实例', () => {
    expect(typeof defaultBackend.init).toBe('function')
    expect(typeof defaultBackend.start).toBe('function')
    expect(typeof defaultBackend.stop).toBe('function')
    expect(SYNC_INTERVAL_MS).toBeGreaterThan(POLL_INTERVAL_MS)
  })
})
