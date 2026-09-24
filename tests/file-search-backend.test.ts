import { describe, expect, it } from 'vitest'
import type { BackendContext } from '@sdk/api'
import { createFileSearchBackend, type SearchDeps } from '../src/plugins/file-search/backend/index'
import { ERROR_EVENT, REQ_KEY, RESULTS_EVENT, type SearchErrorPayload, type SearchResultsPayload } from '../src/plugins/file-search/logic/protocol'

interface Harness {
  ctx: BackendContext
  store: Map<string, unknown>
  emits: { event: string; payload: unknown }[]
  setRequest(q: string, seq: number): void
}

function makeCtx(): Harness {
  const store = new Map<string, unknown>()
  const emits: { event: string; payload: unknown }[] = []
  const ctx = {
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
  return { ctx: ctx as unknown as BackendContext, store, emits, setRequest: (q, seq) => void store.set(REQ_KEY, { q, seq }) }
}

const results = (h: Harness): SearchResultsPayload[] => h.emits.filter((e) => e.event === RESULTS_EVENT).map((e) => e.payload as SearchResultsPayload)
const errors = (h: Harness): SearchErrorPayload[] => h.emits.filter((e) => e.event === ERROR_EVENT).map((e) => e.payload as SearchErrorPayload)

function makeDeps(over: Partial<SearchDeps> = {}): SearchDeps {
  return {
    platform: 'darwin',
    execFile: async () => ({ stdout: '/a/b/Dir\n/a/b/note.md\n\n/a/b/Dir\n' }),
    stat: async () => ({ isDirectory: false }),
    ...over
  }
}

describe('file-search backend 请求循环', () => {
  it('mdfind 输出 → 解析 + stat 补全目录 + emit 结果', async () => {
    const h = makeCtx()
    const calls: { cmd: string; args: string[]; opts: { timeout: number } }[] = []
    const b = createFileSearchBackend({
      deps: {
        ...makeDeps(),
        execFile: async (cmd, args, opts) => {
          calls.push({ cmd, args, opts })
          return { stdout: '/a/b/Dir\n/a/b/note.md\n' }
        },
        stat: async (p) => ({ isDirectory: p === '/a/b/Dir' })
      }
    })
    await b.init(h.ctx)
    h.setRequest('note', 1000)
    await b.pollOnce()

    expect(calls).toEqual([{ cmd: 'mdfind', args: ['-name', 'note'], opts: { timeout: 5000 } }])
    const r = results(h)
    expect(r).toHaveLength(1)
    expect(r[0].seq).toBe(1000)
    expect(r[0].total).toBe(2)
    expect(r[0].hits.map((x) => [x.name, x.isDirectory])).toEqual([
      ['Dir', true],
      ['note.md', false]
    ])
  })

  it('同 seq 重复轮询不重复执行/emit', async () => {
    const h = makeCtx()
    let execCount = 0
    const b = createFileSearchBackend({ deps: { ...makeDeps(), execFile: async () => (execCount++, { stdout: '/a/b/x.txt' }) } })
    await b.init(h.ctx)
    h.setRequest('x', 1)
    await b.pollOnce()
    await b.pollOnce()
    expect(execCount).toBe(1)
    expect(results(h)).toHaveLength(1)
  })

  it('空关键词直接回空结果（不跑 mdfind）', async () => {
    const h = makeCtx()
    let execCount = 0
    const b = createFileSearchBackend({ deps: { ...makeDeps(), execFile: async () => (execCount++, { stdout: '' }) } })
    await b.init(h.ctx)
    h.setRequest('   ', 2)
    await b.pollOnce()
    expect(execCount).toBe(0)
    expect(results(h)[0].hits).toEqual([])
  })

  it('非 darwin 平台回 UNSUPPORTED_PLATFORM，不执行搜索器', async () => {
    const h = makeCtx()
    let execCount = 0
    const b = createFileSearchBackend({ deps: { ...makeDeps(), platform: 'win32', execFile: async () => (execCount++, { stdout: '' }) } })
    await b.init(h.ctx)
    h.setRequest('q', 3)
    await b.pollOnce()
    expect(execCount).toBe(0)
    expect(errors(h)).toHaveLength(1)
    expect(errors(h)[0].code).toBe('UNSUPPORTED_PLATFORM')
  })

  it('mdfind 失败回 SEARCH_FAILED', async () => {
    const h = makeCtx()
    const b = createFileSearchBackend({
      deps: { ...makeDeps(), execFile: async () => { throw new Error('timed out') } }
    })
    await b.init(h.ctx)
    h.setRequest('q', 4)
    await b.pollOnce()
    expect(errors(h)[0].code).toBe('SEARCH_FAILED')
    expect(errors(h)[0].message).toContain('mdfind 执行失败')
  })

  it('搜索进行中收到新请求：跑完当前后继续执行新请求（响应按序）', async () => {
    const h = makeCtx()
    const gates: Array<(stdout: string) => void> = []
    const b = createFileSearchBackend({
      deps: {
        ...makeDeps(),
        execFile: () =>
          new Promise((resolve) => {
            gates.push((stdout) => resolve({ stdout }))
          })
      }
    })
    await b.init(h.ctx)

    h.setRequest('a', 10)
    const first = b.pollOnce() // 进入 exec 等待（drain 循环未退出，promise 未决）
    h.setRequest('b', 11)
    await b.pollOnce() // draining 中，只更新 pending 即返回

    gates[0]('/a/first.txt')
    await new Promise((r) => setTimeout(r, 0)) // 让 emit(a) 与 runSearch(b) 的微任务走完
    expect(results(h).map((r) => r.q)).toEqual(['a']) // 第二个还在等 gate

    gates[1]('/a/second.txt')
    await first
    expect(results(h).map((r) => [r.q, r.seq])).toEqual([
      ['a', 10],
      ['b', 11]
    ])
  })
})
