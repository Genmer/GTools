import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

// 照 electron-services-events.test.ts 的 electron 桩：fetchStreamViaNet 只触 net.fetch
vi.mock('electron', () => ({
  app: { getFileIcon: vi.fn(), getVersion: vi.fn(() => '0.0.0-test') },
  clipboard: { readText: vi.fn(async () => '') },
  ClipboardItem: class {},
  desktopCapturer: { getSources: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
  nativeImage: { createFromDataURL: vi.fn(), createFromBuffer: vi.fn(), createFromPath: vi.fn() },
  net: { fetch: vi.fn() },
  Notification: class {},
  screen: { getPrimaryDisplay: vi.fn(), getCursorScreenPoint: vi.fn(), getDisplayNearestPoint: vi.fn() },
  shell: {},
  BrowserWindow: class {}
}))

import { net } from 'electron'
import { fetchStreamViaNet } from '../src/main/services/electron-services'

const fetchMock = net.fetch as unknown as Mock

interface FakeResInit {
  status?: number
  contentLength?: string | null
  body?: ReadableStream<Uint8Array> | null
}

const resLike = (init: FakeResInit): unknown => ({
  ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
  status: init.status ?? 200,
  headers: {
    get: (h: string): string | null => (h.toLowerCase() === 'content-length' ? (init.contentLength ?? null) : null)
  },
  body: init.body === undefined ? null : init.body
})

// 入队间隔一跳：for-await 在非对象模式流上会把「同时已就绪」的数据并成一帧，真实网络分块按到达交付
const streamOf = (...sizes: number[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    async start(c) {
      for (const n of sizes) {
        c.enqueue(new Uint8Array(n))
        await new Promise((r) => setTimeout(r, 0))
      }
      c.close()
    }
  })

const URL_ = 'https://github.com/Genmer/GTools/releases/download/v9.9.9/GTools.Setup.9.9.9.exe'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchStreamViaNet（应用内更新流式出口）', () => {
  it('带 Accept-Encoding:identity 与 AbortSignal；content-length 数字解析 totalBytes；consume 按序迭代；cancel 触发 abort', async () => {
    fetchMock.mockImplementation(async () => resLike({ contentLength: '3', body: streamOf(2, 1) }))
    const res = await fetchStreamViaNet(URL_)
    expect(fetchMock).toHaveBeenCalledWith(URL_, {
      headers: { 'Accept-Encoding': 'identity' },
      signal: expect.any(AbortSignal)
    })
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(res.totalBytes).toBe(3)
    const sizes: number[] = []
    await res.consume((c) => sizes.push(c.byteLength))
    expect(sizes).toEqual([2, 1])
    res.cancel()
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal
    expect(signal.aborted).toBe(true)
  })

  it('content-length 缺失或非数字 → totalBytes null；HTTP 404 透传 ok:false/status', async () => {
    fetchMock.mockImplementation(async () => resLike({ body: streamOf(1) }))
    const a = await fetchStreamViaNet(URL_)
    expect(a.totalBytes).toBeNull()
    fetchMock.mockImplementation(async () => resLike({ contentLength: 'abc', status: 404, body: streamOf(1) }))
    const b = await fetchStreamViaNet(URL_)
    expect(b.totalBytes).toBeNull()
    expect(b.ok).toBe(false)
    expect(b.status).toBe(404)
  })

  it('body 为 null → consume 抛「响应无内容流」', async () => {
    fetchMock.mockImplementation(async () => resLike({ contentLength: '1', body: null }))
    const res = await fetchStreamViaNet(URL_)
    await expect(res.consume(() => {})).rejects.toThrow('响应无内容流')
  })
})
