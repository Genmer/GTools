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
  calls: { readImage: number; isTextExempted: number }
  /** 豁免集合：加入其中的文本 pollOnce 视为宿主写入的敏感内容（清空即模拟 TTL 过期） */
  exempted: Set<string>
}

async function makeHarness(seedState?: unknown, seedExtra?: [string, unknown][]): Promise<Harness> {
  const scheduler = new ManualScheduler()
  const storage = new Map<string, unknown>(
    seedState === undefined ? (seedExtra ?? []) : ([['state', seedState]] as [string, unknown][]).concat(seedExtra ?? [])
  )
  const clipboard = { text: '', image: null as { width: number; height: number; dataUrl: string } | null, failReadText: false }
  const emits: { event: string; payload: unknown }[] = []
  const calls = { readImage: 0, isTextExempted: 0 }
  const exempted = new Set<string>()
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
      writeTextEphemeral: async (t) => {
        clipboard.text = t
        exempted.add(t)
      },
      isTextExempted: async (t) => {
        calls.isTextExempted++
        return exempted.has(t)
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
    screenshot: { capture: async () => ({ action: 'cancel' as const }) },
    window: {
      hide: async () => {},
      showMain: async () => {},
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
  return { backend, scheduler, clipboard, storage, emits, calls, exempted }
}

const storedStateOf = (h: Harness): { settings: { maxRecords: number; clearOnExit: boolean }; records: unknown[] } =>
  h.storage.get('state') as { settings: { maxRecords: number; clearOnExit: boolean }; records: unknown[] }

describe('clipboard backend 轮询与去重', () => {
  it('init 从持久化恢复，启动时对最新内容不重复记录', async () => {
    const h = await makeHarness(
      toPersisted({ maxRecords: 10, clearOnExit: false, skipSensitive: true }, [{ id: 'r1', kind: 'text', ts: 111, text: 'hello' }])
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
    const h = await makeHarness(toPersisted({ maxRecords: 10, clearOnExit: false, skipSensitive: true }, []))
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

  it('用户清空→采集新记录→重启（init）→新记录仍在（标记采纳即消费）', async () => {
    const h1 = await makeHarness()
    h1.clipboard.text = 'old'
    await h1.backend.pollOnce()
    await h1.backend.flush()
    h1.storage.set('clear-marker', 42) // 用户清空
    await h1.backend.syncExternal()
    expect(h1.storage.get('clear-marker')).toBe(0) // 采纳即消费（修复前残留 42）
    h1.clipboard.text = 'new'
    await h1.backend.pollOnce()
    await h1.backend.flush()

    // 重启：内存 clearMarker 归零，靠已消费的标记避免 init→syncExternal 再次采纳
    const h2 = await makeHarness(h1.storage.get('state'), [['clear-marker', h1.storage.get('clear-marker')]])
    expect(h2.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['new'])
    h2.clipboard.text = 'post-restart'
    await h2.backend.pollOnce()
    await h2.backend.flush()
    expect(h2.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['post-restart', 'new'])
    expect(storedStateOf(h2).records.map((r) => (r as { text: string }).text)).toEqual(['post-restart', 'new'])
  })

  it('导入带清空标记的备份→backend 重启（init）→导入的历史仍在（不再被 adoptClear 清掉）', async () => {
    // 备份源会话：清空已采纳，标记随之消费为 0（备份随 kv.json 带上该键）
    const src = await makeHarness()
    src.storage.set('clear-marker', 42)
    await src.backend.syncExternal()
    expect(src.storage.get('clear-marker')).toBe(0)

    // 恢复导入：backend 停机期间 restore 写入历史 state（连同备份里的 clear-marker 键），随后重启
    const h = await makeHarness(
      toPersisted({ maxRecords: 10, clearOnExit: false, skipSensitive: true }, [
        { id: 'imp1', kind: 'text', ts: 100, text: 'imported-1' },
        { id: 'imp2', kind: 'text', ts: 101, text: 'imported-2' }
      ]),
      [['clear-marker', src.storage.get('clear-marker')]]
    )
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['imported-2', 'imported-1'])
    await h.backend.flush()
    expect(storedStateOf(h).records).toHaveLength(2)
    expect(h.emits.some((e) => e.event === 'history-changed' && (e.payload as { count: number }).count === 0)).toBe(false)
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

describe('clipboard backend 敏感内容拦截', () => {
  it('skipSensitive 默认开启：敏感文本不入库、同内容短路；改普通文本恢复记录', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'password: hunter2'
    await h.backend.pollOnce()
    await h.backend.pollOnce() // 同内容指纹短路，不重复试探
    expect(h.backend.snapshot()).toHaveLength(0)
    expect(h.emits).toHaveLength(0)

    h.clipboard.text = 'normal note'
    await h.backend.pollOnce()
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['normal note'])

    h.clipboard.text = 'token: abc'
    await h.backend.pollOnce()
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['normal note'])
  })

  it('pollOnce 多轮（每轮 syncExternal→applySettings）后 skipSensitive 仍生效', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'a'
    await h.backend.pollOnce()
    await h.backend.flush()
    // 写入缺 skipSensitive 的旧结构 state：parseSettings 缺省回 true，重建不得丢字段
    const persisted = storedStateOf(h)
    h.storage.set('state', { v: 1, settings: { maxRecords: 10, clearOnExit: false }, records: persisted.records })
    await h.backend.syncExternal()
    for (let i = 0; i < 3; i++) {
      h.clipboard.text = `t${i}`
      await h.backend.pollOnce()
    }
    h.clipboard.text = 'API_KEY=zzz'
    await h.backend.pollOnce()
    const texts = h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))
    expect(texts).toEqual(['t2', 't1', 't0', 'a'])
    expect(texts).not.toContain('API_KEY=zzz')
  })

  it('外部关闭 skipSensitive（applySettings 三字段重建）后敏感内容恢复入库', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'one'
    await h.backend.pollOnce()
    await h.backend.flush()
    h.storage.set('state', {
      v: 1,
      settings: { maxRecords: 10, clearOnExit: false, skipSensitive: false },
      records: storedStateOf(h).records
    })
    await h.backend.syncExternal()
    h.clipboard.text = 'password: hunter2'
    await h.backend.pollOnce()
    await h.backend.flush()
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['password: hunter2', 'one'])
  })
})

describe('clipboard backend 敏感指纹豁免（writeTextEphemeral 闭环）', () => {
  it('豁免命中 → 不入库不通知，同内容指纹短路不重复查询（skipSensitive 关闭也拦）', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'one'
    await h.backend.pollOnce()
    await h.backend.flush()
    h.storage.set('state', {
      v: 1,
      settings: { maxRecords: 10, clearOnExit: false, skipSensitive: false },
      records: storedStateOf(h).records
    })
    await h.backend.syncExternal()

    h.clipboard.text = 'vault-pw-xyz' // 任意形态密码：正则拦不住，靠指纹豁免
    h.exempted.add('vault-pw-xyz')
    const emitsBefore = h.emits.length
    const exemptBefore = h.calls.isTextExempted
    await h.backend.pollOnce()
    await h.backend.pollOnce() // 同内容指纹短路，第二轮不再查豁免
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['one'])
    expect(h.emits).toHaveLength(emitsBefore)
    expect(h.calls.isTextExempted).toBe(exemptBefore + 1)
  })

  it('TTL 过期（豁免失效）后同内容重新采集（经内容变化重置指纹）', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'pw'
    h.exempted.add('pw')
    await h.backend.pollOnce()
    expect(h.backend.snapshot()).toHaveLength(0)

    h.exempted.delete('pw') // 模拟 TTL 过期
    h.clipboard.text = 'other' // 剪贴板换了内容再换回，重置 lastSig 指纹
    await h.backend.pollOnce()
    h.clipboard.text = 'pw'
    await h.backend.pollOnce()
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['pw', 'other'])
  })

  it('未登记豁免的文本不受影响（正常采集）', async () => {
    const h = await makeHarness()
    h.clipboard.text = 'plain text'
    await h.backend.pollOnce()
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['plain text'])
    expect(h.calls.isTextExempted).toBe(1)
  })
})

describe('clipboard backend 单条删除（remove-marker 协议）', () => {
  const idOfText = (h: Harness, t: string): string => {
    const rec = h.backend.snapshot().find((r) => r.kind === 'text' && r.text === t)
    if (rec === undefined) throw new Error(`record ${t} not found`)
    return rec.id
  }

  it('remove-marker 变新：采纳删除、落盘同步、emit 新 count', async () => {
    const h = await makeHarness()
    for (const t of ['a', 'b', 'c']) {
      h.clipboard.text = t
      await h.backend.pollOnce()
      await h.backend.flush()
    }
    h.storage.set('remove-marker', { ts: 1000, ids: [idOfText(h, 'b')] })
    await h.backend.syncExternal()
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['c', 'a'])
    await h.backend.flush()
    expect(storedStateOf(h).records.map((r) => (r as { text: string }).text)).toEqual(['c', 'a'])
    expect(h.emits.some((e) => e.event === 'history-changed' && (e.payload as { count: number }).count === 2)).toBe(true)
  })

  it('marker 重写为 {ts 不变, ids:[]}（标记不膨胀）；同 ts 不重复采纳', async () => {
    const h = await makeHarness()
    for (const t of ['a', 'b']) {
      h.clipboard.text = t
      await h.backend.pollOnce()
      await h.backend.flush()
    }
    h.storage.set('remove-marker', { ts: 1000, ids: [idOfText(h, 'b')] })
    await h.backend.syncExternal()
    expect(h.storage.get('remove-marker')).toEqual({ ts: 1000, ids: [] })

    const emitCount = h.emits.length
    await h.backend.syncExternal()
    expect(h.backend.snapshot().map((r) => (r.kind === 'text' ? r.text : ''))).toEqual(['a'])
    expect(h.emits.length).toBe(emitCount)
  })

  it('clear-marker 与 remove-marker 同轮并发：清空优先，被删 id 不复活，删除标记一并消费', async () => {
    const h = await makeHarness()
    for (const t of ['a', 'b']) {
      h.clipboard.text = t
      await h.backend.pollOnce()
      await h.backend.flush()
    }
    h.storage.set('remove-marker', { ts: 2000, ids: [idOfText(h, 'b')] })
    h.storage.set('clear-marker', 42)
    await h.backend.syncExternal()
    expect(h.backend.snapshot()).toHaveLength(0)
    await h.backend.flush()
    expect(storedStateOf(h).records).toHaveLength(0)
    expect(h.storage.get('remove-marker')).toEqual({ ts: 2000, ids: [] })
    expect(h.emits.some((e) => e.event === 'history-changed' && (e.payload as { count: number }).count === 0)).toBe(true)
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
    const wipe = await makeHarness(
      toPersisted({ maxRecords: 10, clearOnExit: true, skipSensitive: true }, [{ id: 'r1', kind: 'text', ts: 1, text: 'old' }])
    )
    await wipe.backend.dispose()
    expect(storedStateOf(wipe)?.records).toHaveLength(0)

    const keep = await makeHarness(
      toPersisted({ maxRecords: 10, clearOnExit: false, skipSensitive: true }, [{ id: 'r1', kind: 'text', ts: 1, text: 'old' }])
    )
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
