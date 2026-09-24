// 剪贴板 backend 单测：Electron 能力（clipboard/storage/emit）全部注入 fake，scheduler 手动控制。
import { describe, expect, it } from 'vitest'
import type { BackendContext } from '@sdk/api'
import { POLL_INTERVAL_MS, SYNC_INTERVAL_MS, ClipboardHistoryBackend } from './backend/index'
import { fnv1a32 } from './logic/image-hash'
import { MAX_TEXT_CHARS, type ClipboardRecord } from './logic/history'

interface Harness {
  ctx: BackendContext
  store: Map<string, unknown>
  emits: { event: string; payload: unknown }[]
  setText(t: string): void
  setImage(img: { width: number; height: number; dataUrl: string } | null): void
  failRead(): void
}

function makeCtx(): Harness {
  const store = new Map<string, unknown>()
  const emits: { event: string; payload: unknown }[] = []
  let nextText = ''
  let nextImage: { width: number; height: number; dataUrl: string } | null = null
  let shouldFail = false
  const ctx = {
    clipboard: {
      readText: async (): Promise<string> => {
        if (shouldFail) throw new Error('clipboard busy')
        return nextText
      },
      readImage: async () => nextImage
    },
    storage: {
      get: async (key: string): Promise<unknown> => (store.has(key) ? structuredClone(store.get(key)) : null),
      set: async (key: string, value: unknown): Promise<void> => {
        store.set(key, structuredClone(value))
      }
    },
    emit: (event: string, payload: unknown): void => {
      emits.push({ event, payload })
    }
  }
  return {
    ctx: ctx as unknown as BackendContext,
    store,
    emits,
    setText: (t) => {
      nextText = t
      shouldFail = false
    },
    setImage: (img) => {
      nextImage = img
      shouldFail = false
    },
    failRead: () => {
      shouldFail = true
    }
  }
}

// 永不触发的 scheduler：测试直接调 pollOnce 驱动
const idleScheduler = {
  setInterval: (): number => 0,
  clearInterval: (): void => {}
}

function newBackend(): ClipboardHistoryBackend {
  return new ClipboardHistoryBackend(idleScheduler)
}

const texts = (records: readonly ClipboardRecord[]): string[] => records.filter((r) => r.kind === 'text').map((r) => r.text)
const kinds = (records: readonly ClipboardRecord[]): string[] => records.map((r) => r.kind)
const stateIn = (h: Harness): { records: unknown[]; settings: { maxRecords: number; clearOnExit: boolean } } =>
  h.store.get('state') as { records: unknown[]; settings: { maxRecords: number; clearOnExit: boolean } }

describe('pollOnce 文本与图片记录', () => {
  it('新文本入库并 emit；相同文本次轮跳过（不重复 emit/落盘）', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    h.setText('hello')
    await b.pollOnce()
    expect(texts(b.snapshot())).toEqual(['hello'])
    expect(h.emits).toEqual([{ event: 'history-changed', payload: { count: 1 } }])
    expect(stateIn(h).records).toHaveLength(1)

    await b.pollOnce()
    expect(b.snapshot()).toHaveLength(1)
    expect(h.emits).toHaveLength(1)
  })

  it('文本→图片→文本交替记录，图片含指纹字段', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    h.setText('a')
    await b.pollOnce()
    h.setText('')
    h.setImage({ width: 20, height: 10, dataUrl: 'data:image/png;base64,QUJD' })
    await b.pollOnce()
    const img = b.snapshot()[0]
    expect(img).toMatchObject({ kind: 'image', width: 20, height: 10, bytes: 3 })
    expect((img as { hash: string }).hash).toBe(`3:20x10:${fnv1a32(new TextEncoder().encode('ABC'))}`)

    h.setText('a')
    await b.pollOnce()
    expect(kinds(b.snapshot())).toEqual(['text', 'image', 'text'])
  })

  it('图片去重：dataUrl 完全相同或字节相同（hash 相同）都不新增', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    h.setText('')
    h.setImage({ width: 5, height: 5, dataUrl: 'data:image/png;base64,QUJD' })
    await b.pollOnce()
    h.setImage({ width: 5, height: 5, dataUrl: 'data:image/png;base64,QUJD' })
    await b.pollOnce() // 完全相同 → lastImageDataUrl 短路
    h.setImage({ width: 5, height: 5, dataUrl: 'data:image/jpeg;base64,QUJD' }) // 前缀不同但字节相同
    await b.pollOnce() // hash 相同 → 短路
    expect(b.snapshot()).toHaveLength(1)
    expect(h.emits).toHaveLength(1)
  })

  it('字节不同的图片正常新增为第二条', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    h.setText('')
    h.setImage({ width: 5, height: 5, dataUrl: 'data:image/png;base64,QUJD' })
    await b.pollOnce()
    h.setImage({ width: 5, height: 5, dataUrl: 'data:image/png;base64,QUJDRA==' })
    await b.pollOnce()
    expect(b.snapshot()).toHaveLength(2)
  })

  it('超大文本不入库（无 emit），且后续同文本被短路；正常文本恢复记录', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    h.setText('x'.repeat(MAX_TEXT_CHARS + 1))
    await b.pollOnce()
    expect(b.snapshot()).toHaveLength(0)
    expect(h.emits).toHaveLength(0)
    await b.pollOnce()
    expect(b.snapshot()).toHaveLength(0)

    h.setText('normal')
    await b.pollOnce()
    expect(texts(b.snapshot())).toEqual(['normal'])
  })

  it('clipboard 读取抛异常静默吞掉，不影响后续轮询', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    h.failRead()
    await expect(b.pollOnce()).resolves.toBeUndefined()
    h.setText('after-error')
    await b.pollOnce()
    expect(texts(b.snapshot())).toEqual(['after-error'])
  })

  it('空剪贴板（文本空且无图）不产生任何记录', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    await b.pollOnce()
    expect(b.snapshot()).toHaveLength(0)
    expect(h.emits).toHaveLength(0)
  })
})

describe('init 从存储恢复', () => {
  it('加载已存历史并恢复 lastSig：与最新一条相同的内容不重记', async () => {
    const h = makeCtx()
    h.store.set('state', {
      v: 1,
      settings: { maxRecords: 50, clearOnExit: false },
      records: [
        { id: 'a', kind: 'text', ts: 2, text: 'a' },
        { id: 'b', kind: 'text', ts: 1, text: 'b' }
      ]
    })
    const b = newBackend()
    await b.init(h.ctx)
    expect(texts(b.snapshot())).toEqual(['a', 'b'])

    h.setText('a')
    await b.pollOnce()
    expect(b.snapshot()).toHaveLength(2) // 最新即 a，去重

    h.setText('b')
    await b.pollOnce()
    expect(texts(b.snapshot())).toEqual(['b', 'a', 'b'])
  })

  it('存储为空/坏数据按空历史启动', async () => {
    const h = makeCtx()
    h.store.set('state', { v: 9, junk: true })
    const b = newBackend()
    await b.init(h.ctx)
    expect(b.snapshot()).toHaveLength(0)
  })
})

describe('syncExternal 外部变更', () => {
  it('渲染层清空（写 clear-marker 标记）→ 内存清空、落盘空状态并 emit count 0；清空后新内容正常入库', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    h.setText('one')
    await b.pollOnce()
    h.setText('two')
    await b.pollOnce()
    expect(b.snapshot()).toHaveLength(2)

    // 渲染层清空只写标记键（不直写 state），由 backend 采纳后统一落盘
    h.store.set('clear-marker', 7)
    h.setText('three')
    await b.pollOnce() // commit 前的 syncExternal 采纳清空，再记录清空后的新内容
    expect(b.snapshot()).toHaveLength(1)
    expect(texts(b.snapshot())).toEqual(['three'])
    expect(h.emits.at(-1)).toEqual({ event: 'history-changed', payload: { count: 1 } })
    expect(h.emits.some((e) => e.payload !== null && typeof e.payload === 'object' && (e.payload as { count: number }).count === 0)).toBe(true)
    await b.flush()
    expect(texts(stateIn(h).records as ClipboardRecord[])).toEqual(['three'])
  })

  it('重启残留的清空标记在 init 即被采纳（清空跨会话生效）', async () => {
    const h = makeCtx()
    h.store.set('state', {
      v: 1,
      settings: { maxRecords: 50, clearOnExit: false },
      records: [{ id: 'a', kind: 'text', ts: 1, text: 'a' }]
    })
    h.store.set('clear-marker', 9)
    const b = newBackend()
    await b.init(h.ctx) // init 内 syncExternal 采纳
    expect(b.snapshot()).toHaveLength(0)
    expect(stateIn(h).records).toHaveLength(0)
    expect(h.emits.some((e) => (e.payload as { count: number } | null)?.count === 0)).toBe(true)
  })

  it('flush 写前比对清空标记：早于用户清空的在途脏数据整批丢弃（次级竞态修复）', async () => {
    const emits: { event: string; payload: unknown }[] = []
    const store = new Map<string, unknown>()
    let curText = ''
    let failSet = true
    const ctx = {
      clipboard: {
        readText: async (): Promise<string> => curText,
        readImage: async (): Promise<null> => null
      },
      storage: {
        get: async (key: string): Promise<unknown> => (store.has(key) ? structuredClone(store.get(key)) : null),
        set: async (key: string, value: unknown): Promise<void> => {
          if (failSet) throw new Error('io error') // 制造在途：commit 后的 flush 一直失败，脏数据滞留
          store.set(key, structuredClone(value))
        }
      },
      emit: (event: string, payload: unknown): void => {
        emits.push({ event, payload })
      }
    }
    const b = new ClipboardHistoryBackend(idleScheduler)
    await b.init(ctx as unknown as BackendContext)

    curText = 'stale'
    await b.pollOnce() // commit 'stale'，自动 flush 写失败 → dirty 滞留
    await b.flush() // 仍失败，确认脏状态成立
    expect(b.snapshot()).toHaveLength(1)

    failSet = false
    store.set('clear-marker', 42) // 用户此刻清空
    await b.flush() // 写前发现标记更新：丢弃在途 'stale'，改写空状态
    expect(b.snapshot()).toHaveLength(0)
    expect((store.get('state') as { records: unknown[] }).records).toHaveLength(0)
    expect(emits.some((e) => (e.payload as { count: number } | null)?.count === 0)).toBe(true)
  })

  it('键缺失/瞬时读失败（get 解析为 null）不清内存，历史不丢', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    h.setText('a')
    await b.pollOnce()
    h.store.delete('state') // PluginStorageService 读失败静默返回 {} → get 为 null
    await b.syncExternal()
    expect(texts(b.snapshot())).toEqual(['a'])
    expect(h.emits).toHaveLength(1) // 无 count 0 误报
  })

  it('flush 在途（慢盘）时 syncExternal 读到的旧空状态不清内存，旧记录不丢', async () => {
    const emits: { event: string; payload: unknown }[] = []
    const store = new Map<string, unknown>()
    let curText = ''
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let savingOps = 0
    const ctx = {
      clipboard: {
        readText: async (): Promise<string> => curText,
        readImage: async (): Promise<null> => null
      },
      storage: {
        get: async (key: string): Promise<unknown> => (store.has(key) ? structuredClone(store.get(key)) : null),
        set: async (key: string, value: unknown): Promise<void> => {
          savingOps++
          await gate // 模拟大 JSON 慢写：落盘前读到的仍是旧值（此处为 null）
          store.set(key, structuredClone(value))
        }
      },
      emit: (event: string, payload: unknown): void => {
        emits.push({ event, payload })
      }
    }
    const b = new ClipboardHistoryBackend(idleScheduler)
    await b.init(ctx as unknown as BackendContext)

    curText = 'one'
    await b.pollOnce() // syncExternal(null→不清) → commit one → flush 挂起（saving）
    curText = 'two'
    await b.pollOnce() // saving=true 跳过同步；若无此保护，读到 null 会清空 ['one']
    expect(savingOps).toBeGreaterThanOrEqual(1)

    release()
    await new Promise((r) => setTimeout(r, 0)) // 等在途 flush 走完
    await b.flush() // 补写 dirty 中的最终状态

    expect(texts(b.snapshot())).toEqual(['two', 'one']) // 'one' 不被过期读抹掉
    const persisted = store.get('state') as { records: ClipboardRecord[] }
    expect(texts(persisted.records)).toEqual(['two', 'one'])
    expect(emits.some((e) => (e.payload as { count: number } | null)?.count === 0)).toBe(false)
  })

  it('外部 settings 收紧容量：超限裁剪并 emit，之后入库也按新容量', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    for (let i = 0; i < 12; i++) {
      h.setText(`t${i}`)
      await b.pollOnce()
    }
    expect(b.snapshot()).toHaveLength(12)

    h.store.set('state', {
      v: 1,
      settings: { maxRecords: 10, clearOnExit: false },
      records: stateIn(h).records
    })
    h.setText('cap')
    await b.pollOnce()
    expect(b.snapshot()).toHaveLength(10)
    expect(texts(b.snapshot())[0]).toBe('cap')

    await b.stop() // 触发最终 flush
    const finalState = stateIn(h)
    expect(finalState.settings.maxRecords).toBe(10)
    expect(finalState.records).toHaveLength(10)
  })
})

describe('生命周期与调度器', () => {
  it('start 立即轮询一次并注册 poll/sync 两个周期定时器，stop 清理', async () => {
    const h = makeCtx()
    const timers: { fn: () => void; ms: number; cleared: boolean }[] = []
    const scheduler = {
      setInterval: (fn: () => void, ms: number): unknown => {
        timers.push({ fn, ms, cleared: false })
        return timers.length - 1
      },
      clearInterval: (id: unknown): void => {
        timers[id as number].cleared = true
      }
    }
    const b = new ClipboardHistoryBackend(scheduler)
    await b.init(h.ctx)
    h.setText('boot')
    await b.start()
    expect(texts(b.snapshot())).toEqual(['boot'])
    expect(timers.map((t) => t.ms)).toEqual([POLL_INTERVAL_MS, SYNC_INTERVAL_MS])
    expect(POLL_INTERVAL_MS).toBe(1000)
    expect(SYNC_INTERVAL_MS).toBe(5000)

    timers[0].fn() // 手动触发一轮 poll：同文本短路
    expect(b.snapshot()).toHaveLength(1)

    await b.stop()
    expect(timers.every((t) => t.cleared)).toBe(true)
  })

  it('重复 start 不重复注册定时器', async () => {
    const h = makeCtx()
    const timers: unknown[] = []
    const scheduler = {
      setInterval: (fn: () => void): unknown => {
        timers.push(fn)
        return timers.length
      },
      clearInterval: (): void => {}
    }
    const b = new ClipboardHistoryBackend(scheduler)
    await b.init(h.ctx)
    await b.start()
    await b.start()
    expect(timers).toHaveLength(2)
    await b.stop()
  })

  it('stop 落盘挂起的变更（commit 后即 flush，这里验证 stop 后存储可读）', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    h.setText('persist-me')
    await b.pollOnce()
    await b.stop()
    const state = stateIn(h)
    expect(state.records).toHaveLength(1)
    expect((state.records[0] as { text: string }).text).toBe('persist-me')
  })
})

describe('dispose 退出清理', () => {
  it('clearOnExit=true 清空历史并落盘空状态', async () => {
    const h = makeCtx()
    h.store.set('state', {
      v: 1,
      settings: { maxRecords: 50, clearOnExit: true },
      records: [{ id: 'a', kind: 'text', ts: 1, text: 'a' }]
    })
    const b = newBackend()
    await b.init(h.ctx)
    expect(b.snapshot()).toHaveLength(1)
    await b.dispose()
    expect(b.snapshot()).toHaveLength(0)
    expect(stateIn(h).records).toHaveLength(0)
  })

  it('clearOnExit=false 保留历史', async () => {
    const h = makeCtx()
    const b = newBackend()
    await b.init(h.ctx)
    h.setText('keep')
    await b.pollOnce()
    await b.dispose()
    expect(texts(b.snapshot())).toEqual(['keep'])
    expect(stateIn(h).records).toHaveLength(1)
  })
})
