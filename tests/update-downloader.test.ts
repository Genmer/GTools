import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import {
  createUpdateDownloader,
  sweepUpdateCache,
  type StreamFetchResponse,
  type UpdateDownloaderFs,
  type UpdateDownloadSnapshot
} from '../src/main/services/update-downloader'

const DIR = '/userData/update-cache'
const WIN_URL = 'https://github.com/Genmer/GTools/releases/download/v9.9.9/GTools.Setup.9.9.9.exe'
const WIN_URL2 = 'https://github.com/Genmer/GTools/releases/download/v9.9.8/GTools.Setup.9.9.8.exe'
const MAC_URL = 'https://github.com/Genmer/GTools/releases/download/v9.9.9/GTools-9.9.9.dmg'
const MB = 1_048_576

const u8 = (n: number): Uint8Array => new Uint8Array(n)
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

interface FakeSink {
  path: string
  byteLengths: number[]
  closed: boolean
}

/** 内存目录：listing 记 name→mtimeMs；sink 只记字节长度与关闭 */
function makeFs(listing: Record<string, number> = {}) {
  const state = {
    listing: new Map<string, number>(Object.entries(listing)),
    rm: [] as string[],
    renamed: [] as Array<[string, string]>,
    mkdirs: [] as string[]
  }
  const sinks: FakeSink[] = []
  const base = (p: string): string => p.split(/[\\/]/).pop() ?? p
  const fs: UpdateDownloaderFs = {
    mkdir: async (d) => {
      state.mkdirs.push(d)
    },
    readdir: async () => [...state.listing.keys()],
    rm: async (p) => {
      state.rm.push(p)
      state.listing.delete(base(p))
    },
    rename: async (from, to) => {
      state.renamed.push([from, to])
      state.listing.set(base(to), state.listing.get(base(from)) ?? 0)
      state.listing.delete(base(from))
    },
    stat: async (p) => {
      const mtimeMs = state.listing.get(base(p))
      if (mtimeMs === undefined) throw new Error(`ENOENT ${p}`)
      return { mtimeMs }
    },
    createSink: async (p) => {
      const sink: FakeSink = { path: p, byteLengths: [], closed: false }
      sinks.push(sink)
      return {
        write: async (c: Uint8Array) => {
          sink.byteLengths.push(c.byteLength)
        },
        close: async () => {
          sink.closed = true
        }
      }
    }
  }
  return { fs, state, sinks }
}

/** 一次性消费完全部 chunk 的流 */
function makeStream(chunks: number[], opts: { totalBytes?: number | null; status?: number } = {}) {
  const totalBytes = opts.totalBytes === undefined ? chunks.reduce((a, b) => a + b, 0) : opts.totalBytes
  const status = opts.status ?? 200
  const cancelled = { count: 0 }
  const fetchStream = vi.fn(async (): Promise<StreamFetchResponse> => ({
    ok: status >= 200 && status < 300,
    status,
    totalBytes,
    consume: async (onChunk) => {
      for (const n of chunks) onChunk(u8(n))
    },
    cancel: () => {
      cancelled.count++
    }
  }))
  return { fetchStream, cancelled }
}

/** 挂起流：pushChunk/finish/fail 由测试手动驱动（cancel/停滞/幂等用例） */
function makeHangingStream(totalBytes: number | null) {
  const cancelled = { count: 0 }
  let pushChunk: ((n: number) => void) | null = null
  let finish: (() => void) | null = null
  let fail: ((err: Error) => void) | null = null
  const fetchStream = vi.fn(async (): Promise<StreamFetchResponse> => ({
    ok: true,
    status: 200,
    totalBytes,
    consume: (onChunk) =>
      new Promise<void>((resolve, reject) => {
        pushChunk = (n: number): void => onChunk(u8(n))
        finish = (): void => resolve()
        fail = (err: Error): void => reject(err)
      }),
    cancel: () => {
      cancelled.count++
    }
  }))
  return {
    fetchStream,
    cancelled,
    pushChunk: (n: number): void => pushChunk!(n),
    finish: (): void => finish!(),
    fail: (err: Error): void => fail!(err)
  }
}

/** 握手可控流：fetchStream 的 resolve/reject 与每个响应的 consume 都由测试手动驱动（会话竞态用例） */
function makeHandshakeStream() {
  interface Call {
    resolveFetch: (r: StreamFetchResponse) => void
    rejectFetch: (e: Error) => void
    cancelled: number
    pushChunk: (n: number) => void
    finish: () => void
    fail: (e: Error) => void
  }
  const calls: Call[] = []
  const fetchStream = vi.fn(
    () =>
      new Promise<StreamFetchResponse>((resolve, reject) => {
        const call: Call = {
          resolveFetch: resolve,
          rejectFetch: reject,
          cancelled: 0,
          pushChunk: () => {},
          finish: () => {},
          fail: () => {}
        }
        calls.push(call)
      })
  )
  const respond = (i: number, totalBytes: number | null): void => {
    calls[i].resolveFetch({
      ok: true,
      status: 200,
      totalBytes,
      consume: (onChunk) =>
        new Promise<void>((resolve, reject) => {
          calls[i].pushChunk = (n: number): void => onChunk(u8(n))
          calls[i].finish = (): void => resolve()
          calls[i].fail = (e: Error): void => reject(e)
        }),
      cancel: () => {
        calls[i].cancelled++
      }
    })
  }
  return { fetchStream, calls, respond }
}

/** 假时钟 + 一次性定时器：advance 后触发所有到期 fn（fn 内再 arm 会追加新定时器） */
function makeClock(startAt = 0) {
  let t = startAt
  const timers: Array<{ fn: () => void; at: number; off: boolean }> = []
  return {
    now: () => t,
    schedule: (fn: () => void, ms: number) => {
      const timer = { fn, at: t + ms, off: false }
      timers.push(timer)
      return () => {
        timer.off = true
      }
    },
    advance: (ms: number) => {
      t += ms
      for (const timer of [...timers]) {
        if (!timer.off && timer.at <= t) {
          timer.off = true
          timer.fn()
        }
      }
    }
  }
}

function makeDownloader(opts: { platform?: string; listing?: Record<string, number>; chunks?: number[]; totalBytes?: number | null } = {}) {
  const fsEnv = makeFs(opts.listing)
  const stream = makeStream(opts.chunks ?? [1, 2, 3], { totalBytes: opts.totalBytes })
  const clock = makeClock()
  const snaps: UpdateDownloadSnapshot[] = []
  const dl = createUpdateDownloader({
    fetchStream: stream.fetchStream,
    fs: fsEnv.fs,
    dir: DIR,
    platform: opts.platform ?? 'win32',
    now: clock.now,
    schedule: clock.schedule,
    onProgress: (s) => snaps.push(s)
  })
  return { dl, fs: fsEnv.state, sinks: fsEnv.sinks, stream, clock, snaps }
}

describe('update-downloader 文件名校验', () => {
  it('空尾段（URL 解析 .. / 尾斜杠）、解码后含斜杠、段内 ..、平台扩展名不符均拒绝且磁盘零变化', async () => {
    const env = makeDownloader({ chunks: [1] })
    const dotdot = await env.dl.start('https://github.com/Genmer/GTools/releases/download/v9.9.9/..')
    expect(dotdot).toEqual({ ok: false, error: '安装包文件名异常：' })
    const trailing = await env.dl.start('https://github.com/Genmer/GTools/releases/download/v9.9.9/')
    expect(trailing).toEqual({ ok: false, error: '安装包文件名异常：' })
    const decodedSlash = await env.dl.start('https://github.com/Genmer/GTools/releases/download/v9.9.9/a%2Fb.exe')
    expect(decodedSlash).toEqual({ ok: false, error: '安装包文件名异常：a%2Fb.exe' })
    const dotSegment = await env.dl.start(`${WIN_URL.replace('.exe', '')}..Setup.exe`)
    expect(dotSegment.ok).toBe(false)
    const wrongExt = await env.dl.start(MAC_URL)
    expect(wrongExt).toEqual({ ok: false, error: '安装包文件名异常：GTools-9.9.9.dmg' })
    expect(env.stream.fetchStream).not.toHaveBeenCalled()
    expect(env.fs.mkdirs).toEqual([])
    expect(env.sinks).toEqual([])
    expect(env.dl.status().state).toBe('idle')
  })

  it('URL 编码文件名解码正确（%20 → 空格）', async () => {
    const env = makeDownloader({ chunks: [1] })
    const r = await env.dl.start('https://github.com/Genmer/GTools/releases/download/v9.9.9/GTools%20Setup.exe')
    expect(r.ok).toBe(true)
    expect(env.dl.status().fileName).toBe('GTools Setup.exe')
  })

  it('darwin 平台只认 .dmg', async () => {
    const env = makeDownloader({ platform: 'darwin', chunks: [1] })
    const exe = await env.dl.start(WIN_URL)
    expect(exe.ok).toBe(false)
    const dmg = await env.dl.start(MAC_URL)
    expect(dmg.ok).toBe(true)
  })
})

describe('update-downloader 成功流', () => {
  it('3 chunk：快照 received 递增、终态 downloaded、rename 落位、.part 消失、installerPath 正确', async () => {
    const env = makeDownloader({ chunks: [10, 20, 30], totalBytes: 60 })
    const r = await env.dl.start(WIN_URL)
    expect(r.ok).toBe(true)
    const partPath = join(DIR, 'GTools.Setup.9.9.9.exe.part')
    const finalPath = join(DIR, 'GTools.Setup.9.9.9.exe')
    expect(env.fs.renamed).toEqual([[partPath, finalPath]])
    expect(env.sinks[0].byteLengths).toEqual([10, 20, 30])
    expect(env.sinks[0].closed).toBe(true)
    expect(env.fs.listing.has('GTools.Setup.9.9.9.exe.part')).toBe(false)
    const s = env.dl.status()
    expect(s.state).toBe('downloaded')
    expect(s.installerPath).toBe(finalPath)
    expect(s.fileName).toBe('GTools.Setup.9.9.9.exe')
    expect(s.receivedBytes).toBe(60)
    expect(s.totalBytes).toBe(60)
    expect(s.error).toBeNull()
    expect(s.speedBps).toBeNull()
    expect(env.snaps.map((x) => x.receivedBytes)).toEqual([0, 10, 30, 60, 60])
    expect(env.snaps.at(-1)?.state).toBe('downloaded')
  })
})

describe('update-downloader start 幂等', () => {
  it('downloading 中再 start 不重开流；downloaded 同 url 复用快照、不同 url 允许重下', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(100)
    const clock = makeClock()
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const first = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(50)
    const again = await dl.start(WIN_URL)
    expect(again.ok && again.data.state).toBe('downloading')
    expect(hang.fetchStream).toHaveBeenCalledTimes(1)
    hang.pushChunk(50)
    hang.finish()
    const done = await first
    expect(done.ok && done.data.state).toBe('downloaded')
    const replay = await dl.start(WIN_URL)
    expect(replay.ok && replay.data.state).toBe('downloaded')
    expect(hang.fetchStream).toHaveBeenCalledTimes(1)
    const otherP = dl.start(WIN_URL2)
    await tick()
    expect(hang.fetchStream).toHaveBeenCalledTimes(2)
    hang.pushChunk(100)
    hang.finish()
    const other = await otherP
    expect(other.ok && other.data.state).toBe('downloaded')
    // 旧包清理规则：重下不同 url 时保留 mtime 最新的旧安装包
    expect(fsEnv.state.rm).not.toContain(join(DIR, 'GTools.Setup.9.9.9.exe'))
  })
})

describe('update-downloader cancel', () => {
  it('downloading 中 cancel：流取消、sink 关、.part 删、idle 终态快照；非 downloading no-op', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(50)
    const clock = makeClock()
    const snaps: UpdateDownloadSnapshot[] = []
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule,
      onProgress: (s) => snaps.push(s)
    })
    const p = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(10)
    const snap = dl.cancel()
    expect(snap.state).toBe('idle')
    expect(hang.cancelled.count).toBe(1)
    await tick()
    expect(fsEnv.state.rm).toContain(join(DIR, 'GTools.Setup.9.9.9.exe.part'))
    expect(fsEnv.sinks[0].closed).toBe(true)
    expect(snaps.at(-1)?.state).toBe('idle')
    hang.fail(new Error('aborted'))
    const r = await p
    expect(r.ok && r.data.state).toBe('idle')
    // 非 downloading：cancel no-op，不再触流取消
    const noop = dl.cancel()
    expect(noop.state).toBe('idle')
    expect(hang.cancelled.count).toBe(1)
  })
})

describe('update-downloader 停滞检测', () => {
  it('31s 无字节进展 → failed 停滞文案、.part 删除、后续流 reject 不改终态', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(50)
    const clock = makeClock()
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const p = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(10)
    clock.advance(31_000)
    await tick()
    expect(dl.status().state).toBe('failed')
    expect(dl.status().error).toBe('下载停滞（30 秒无数据），请重试')
    expect(fsEnv.state.rm).toContain(join(DIR, 'GTools.Setup.9.9.9.exe.part'))
    hang.fail(new Error('aborted'))
    const r = await p
    expect(r).toEqual({ ok: false, error: '下载停滞（30 秒无数据），请重试' })
  })

  it('停滞触发后流随 cancel reject（真实生产时序）：文案为停滞且 .part 删除', async () => {
    const fsEnv = makeFs()
    const clock = makeClock()
    let rejectConsume: ((err: Error) => void) | null = null
    const fetchStream = vi.fn(async (): Promise<StreamFetchResponse> => ({
      ok: true,
      status: 200,
      totalBytes: 50,
      consume: () =>
        new Promise<void>((_resolve, reject) => {
          rejectConsume = reject
        }),
      cancel: () => {
        rejectConsume?.(new Error('aborted')) // 真实流形态：controller.abort 使 for await 以 reject 收尾
      }
    }))
    const dl = createUpdateDownloader({
      fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const p = dl.start(WIN_URL)
    await tick()
    clock.advance(31_000) // 停滞触发：cancel → consume reject，consume catch 与停滞兜底清理协程竞速
    const r = await p
    expect(r).toEqual({ ok: false, error: '下载停滞（30 秒无数据），请重试' })
    expect(dl.status().state).toBe('failed')
    expect(dl.status().error).toBe('下载停滞（30 秒无数据），请重试')
    expect(fsEnv.sinks[0].closed).toBe(true)
    expect(fsEnv.state.rm).toContain(join(DIR, 'GTools.Setup.9.9.9.exe.part'))
  })

  it('有字节进展不复判停滞（5s 内推进重置计时）', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(null)
    const clock = makeClock()
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const p = dl.start(WIN_URL)
    await tick()
    for (let i = 0; i < 8; i++) {
      clock.advance(4000)
      hang.pushChunk(1)
    }
    expect(dl.status().state).toBe('downloading')
    hang.finish()
    const r = await p
    expect(r.ok && r.data.state).toBe('downloaded')
  })
})

describe('update-downloader 完整性与空内容', () => {
  it('字节数不符：删 .part 落中文错误', async () => {
    const env = makeDownloader({ chunks: [MB / 2, MB / 2], totalBytes: 2 * MB })
    const r = await env.dl.start(WIN_URL)
    expect(r).toEqual({ ok: false, error: '下载不完整（应为 2.0 MB，实收 1.0 MB），请重试' })
    expect(env.fs.rm).toContain(join(DIR, 'GTools.Setup.9.9.9.exe.part'))
    expect(env.dl.status().state).toBe('failed')
  })

  it('totalBytes 为 null 跳过完整性校验', async () => {
    const env = makeDownloader({ chunks: [1, 2], totalBytes: null })
    const r = await env.dl.start(WIN_URL)
    expect(r.ok && r.data.state).toBe('downloaded')
  })

  it('空内容失败并删 .part', async () => {
    const env = makeDownloader({ chunks: [], totalBytes: 0 })
    const r = await env.dl.start(WIN_URL)
    expect(r).toEqual({ ok: false, error: '下载内容为空' })
    expect(env.fs.rm).toContain(join(DIR, 'GTools.Setup.9.9.9.exe.part'))
  })

  it('HTTP 非 2xx：不开 .part 即 failed', async () => {
    const fsEnv = makeFs()
    const stream = makeStream([1], { status: 404 })
    const clock = makeClock()
    const dl = createUpdateDownloader({
      fetchStream: stream.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const r = await dl.start(WIN_URL)
    expect(r).toEqual({ ok: false, error: '下载失败（HTTP 404）' })
    expect(fsEnv.sinks).toEqual([])
  })
})

describe('update-downloader 下载前清理', () => {
  it('删全部 .part；旧安装包只留 mtime 最新一个；目标同名文件不动', async () => {
    const env = makeDownloader({
      chunks: [5],
      listing: { 'a.part': 1, 'B.PART': 2, 'old1.exe': 100, 'old2.exe': 200, 'new.exe': 50 }
    })
    const r = await env.dl.start('https://github.com/Genmer/GTools/releases/download/v9.9.9/new.exe')
    expect(r.ok).toBe(true)
    expect(env.fs.rm).toContain(join(DIR, 'a.part'))
    expect(env.fs.rm).toContain(join(DIR, 'B.PART'))
    expect(env.fs.rm).toContain(join(DIR, 'old1.exe'))
    expect(env.fs.rm).not.toContain(join(DIR, 'old2.exe'))
    expect(env.fs.rm).not.toContain(join(DIR, 'new.exe'))
    expect([...env.fs.listing.keys()].sort()).toEqual(['new.exe', 'old2.exe'])
  })
})

describe('update-downloader 节流与测速', () => {
  it('200ms 内多次小进度只推首帧 + 终态必发', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(null)
    const clock = makeClock()
    const snaps: UpdateDownloadSnapshot[] = []
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule,
      onProgress: (s) => snaps.push(s)
    })
    const p = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(1)
    hang.pushChunk(1)
    hang.pushChunk(1)
    expect(snaps.map((s) => s.state)).toEqual(['downloading'])
    hang.finish()
    const r = await p
    expect(r.ok && r.data.state).toBe('downloaded')
    expect(snaps.map((s) => s.state)).toEqual(['downloading', 'downloaded'])
  })

  it('百分比跳变 ≥1% 立即推（时钟未走）', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(1000)
    const clock = makeClock()
    const snaps: UpdateDownloadSnapshot[] = []
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule,
      onProgress: (s) => snaps.push(s)
    })
    const p = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(10) // 1% 跳变
    hang.pushChunk(20) // 2% 跳变
    expect(snaps.map((s) => s.receivedBytes)).toEqual([0, 10, 30])
    hang.pushChunk(970)
    hang.finish()
    const r = await p
    expect(r.ok && r.data.state).toBe('downloaded')
    expect(snaps.map((s) => s.receivedBytes)).toEqual([0, 10, 30, 1000, 1000])
  })

  it('测速：1MB / 2s → ~524288 B/s；跨度 <1s 为 null', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(null)
    const clock = makeClock()
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const p = dl.start(WIN_URL)
    await tick()
    expect(dl.status().speedBps).toBeNull() // 只有基线样本
    clock.advance(500)
    hang.pushChunk(MB / 2)
    expect(dl.status().speedBps).toBeNull() // 跨度 500ms < 1s
    clock.advance(1500)
    hang.pushChunk(MB / 2)
    expect(dl.status().speedBps).toBeCloseTo(MB / 2, 5) // 1048576B / 2s
    hang.finish()
    const r = await p
    expect(r.ok && r.data.state).toBe('downloaded')
    expect(dl.status().speedBps).toBeNull() // 终态不再测速
  })
})

describe('update-downloader 网络中断与重试', () => {
  it('网络断（consume reject、非主动 cancel）→ failed 中文文案、.part 删除、sink 关闭（与 cancel 回 idle 区分）', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(50)
    const clock = makeClock()
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const p = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(10)
    hang.fail(new Error('ECONNRESET'))
    const r = await p
    expect(r).toEqual({ ok: false, error: '网络连接中断，下载失败' })
    expect(dl.status().state).toBe('failed')
    expect(fsEnv.state.rm).toContain(join(DIR, 'GTools.Setup.9.9.9.exe.part'))
    expect(fsEnv.sinks[0].closed).toBe(true)
  })

  it('fetchStream 本身抛错（连不上）→ failed 网络中断文案，未开 .part', async () => {
    const fsEnv = makeFs()
    const clock = makeClock()
    const dl = createUpdateDownloader({
      fetchStream: async () => {
        throw new Error('net::ERR_CONNECTION_REFUSED')
      },
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const r = await dl.start(WIN_URL)
    expect(r).toEqual({ ok: false, error: '网络连接中断，下载失败' })
    expect(dl.status().state).toBe('failed')
    expect(fsEnv.sinks).toEqual([])
  })

  it('停滞判 failed 后再次 start 能成功（failed 可重试）', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(60)
    const clock = makeClock()
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const p1 = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(10)
    clock.advance(31_000)
    await tick()
    expect(dl.status().state).toBe('failed')
    hang.fail(new Error('aborted'))
    await p1
    const p2 = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(60)
    hang.finish()
    const r2 = await p2
    expect(r2.ok && r2.data.state).toBe('downloaded')
    expect(r2.ok && r2.data.installerPath).toBe(join(DIR, 'GTools.Setup.9.9.9.exe'))
    expect(fsEnv.state.renamed).toEqual([[join(DIR, 'GTools.Setup.9.9.9.exe.part'), join(DIR, 'GTools.Setup.9.9.9.exe')]])
  })
})

describe('update-downloader 会话代次（cancel 与重启竞态）', () => {
  it('握手期 cancel：立即回 idle；迟到的 fetchStream resolve 被丢弃并 response.cancel，无磁盘动作、无 failed 广播', async () => {
    const fsEnv = makeFs()
    const hs = makeHandshakeStream()
    const clock = makeClock()
    const snaps: UpdateDownloadSnapshot[] = []
    const dl = createUpdateDownloader({
      fetchStream: hs.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule,
      onProgress: (s) => snaps.push(s)
    })
    const p = dl.start(WIN_URL)
    await tick() // 预清理完成，fetchStream 已发起且挂起（res 尚 null）
    const snap = dl.cancel()
    expect(snap.state).toBe('idle')
    expect(hs.calls[0].cancelled).toBe(0) // 握手期 res 为 null，触不到流取消
    hs.respond(0, 50) // 迟到的握手响应
    const r = await p
    expect(r.ok && r.data.state).toBe('idle')
    expect(dl.status().state).toBe('idle')
    expect(hs.calls[0].cancelled).toBe(1) // 迟到响应被丢弃时主动断流
    expect(fsEnv.sinks).toEqual([])
    expect(fsEnv.state.rm).toEqual([])
    expect(fsEnv.state.renamed).toEqual([])
    expect(snaps.map((s) => s.state)).toEqual(['downloading', 'idle'])
  })

  it('握手期 cancel 后 fetchStream reject：不落 failed，保持 idle', async () => {
    const fsEnv = makeFs()
    const hs = makeHandshakeStream()
    const clock = makeClock()
    const dl = createUpdateDownloader({
      fetchStream: hs.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const p = dl.start(WIN_URL)
    await tick()
    dl.cancel()
    hs.calls[0].rejectFetch(new Error('ECONNRESET'))
    const r = await p
    expect(r.ok && r.data.state).toBe('idle')
    expect(dl.status().state).toBe('idle')
    expect(dl.status().error).toBeNull()
    expect(fsEnv.sinks).toEqual([])
  })

  it('下载中 cancel 后立即重开新会话：旧会话迟到的 consume reject 不影响新会话完成', async () => {
    const fsEnv = makeFs()
    const hs = makeHandshakeStream()
    const clock = makeClock()
    const snaps: UpdateDownloadSnapshot[] = []
    const dl = createUpdateDownloader({
      fetchStream: hs.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule,
      onProgress: (s) => snaps.push(s)
    })
    const pa = dl.start(WIN_URL)
    await tick()
    hs.respond(0, 50)
    await tick() // 会话 A：res/sink 就绪，consume 挂起
    hs.calls[0].pushChunk(10)
    dl.cancel()
    const pb = dl.start(WIN_URL) // 同 URL 立即重开（会话 B）
    await tick()
    hs.respond(1, 50)
    await tick() // 会话 B：consume 挂起
    hs.calls[0].fail(new Error('aborted')) // A 的迟到 reject
    await pa
    hs.calls[1].pushChunk(50)
    hs.calls[1].finish()
    const rb = await pb
    expect(rb.ok && rb.data.state).toBe('downloaded')
    expect(dl.status().state).toBe('downloaded')
    expect(dl.status().receivedBytes).toBe(50)
    expect(hs.fetchStream).toHaveBeenCalledTimes(2)
    expect(fsEnv.state.renamed).toEqual([[join(DIR, 'GTools.Setup.9.9.9.exe.part'), join(DIR, 'GTools.Setup.9.9.9.exe')]])
    expect(fsEnv.sinks[0].closed).toBe(true) // A 的 sink 由 cancel 关闭
    expect(fsEnv.sinks[1].closed).toBe(true)
    expect(snaps.some((s) => s.state === 'failed')).toBe(false)
  })

  it('下载中 cancel 后立即重开新会话：旧会话迟到的 consume resolve 不落 downloaded、不影响新会话', async () => {
    const fsEnv = makeFs()
    const hs = makeHandshakeStream()
    const clock = makeClock()
    const dl = createUpdateDownloader({
      fetchStream: hs.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const pa = dl.start(WIN_URL)
    await tick()
    hs.respond(0, 50)
    await tick()
    hs.calls[0].pushChunk(10)
    dl.cancel()
    const pb = dl.start(WIN_URL2)
    await tick()
    hs.respond(1, 80)
    await tick()
    hs.calls[0].finish() // A 的迟到 resolve（fake 流 cancel 后不 reject）
    const ra = await pa
    expect(ra.ok && ra.data.state).toBe('downloading') // B 进行中，A 不落 downloaded/failed
    expect(hs.calls[0].cancelled).toBe(2) // cancel 一次 + 丢弃迟到流一次
    expect(fsEnv.state.renamed).toEqual([]) // A 未曾 rename
    hs.calls[1].pushChunk(80)
    hs.calls[1].finish()
    const rb = await pb
    expect(rb.ok && rb.data.state).toBe('downloaded')
    expect(dl.status().fileName).toBe('GTools.Setup.9.9.8.exe')
  })

  it('停滞清理期间 cancel：终态保持 idle（用户取消）不落 failed', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(50)
    const clock = makeClock()
    let releaseClose: (() => void) | null = null
    const slowFs: UpdateDownloaderFs = {
      ...fsEnv.fs,
      createSink: async (p) => {
        const s = await fsEnv.fs.createSink(p)
        return {
          write: (c: Uint8Array) => s.write(c),
          close: () =>
            new Promise<void>((r) => {
              releaseClose = r
            })
        }
      }
    }
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: slowFs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const p = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(10)
    clock.advance(31_000) // 停滞触发：cleanupPart 的 sink.close 被卡住
    await tick()
    expect(dl.status().state).toBe('downloading') // 仍在停滞清理窗口内
    dl.cancel()
    expect(dl.status().state).toBe('idle')
    releaseClose!()
    hang.fail(new Error('aborted'))
    const r = await p
    expect(r.ok && r.data.state).toBe('idle')
    expect(dl.status().state).toBe('idle')
    expect(dl.status().error).toBeNull()
  })
})

describe('update-downloader 对抗复测（复测轮新增）', () => {
  // BUG（本轮发现，业务代码未改）：写盘链 read 的是模块级 sink 而非代次校验——
  // 旧会话在 cancel 前已排队的 chunk 写，若在新会话装好 sink 后才执行，会写入新会话的 .part
  it('cancel 后旧会话仍在排队的 chunk 写不得落入新会话的 .part（写盘链须校验会话归属）', async () => {
    const fsEnv = makeFs()
    const hs = makeHandshakeStream()
    const clock = makeClock()
    let releaseFirstWrite: (() => void) | null = null
    const baseCreateSink = fsEnv.fs.createSink
    let sinkCount = 0
    const slowWriteFs: UpdateDownloaderFs = {
      ...fsEnv.fs,
      createSink: async (p) => {
        const s = await baseCreateSink(p)
        const isSessionA = sinkCount === 0
        let first = true
        sinkCount++
        return {
          write: (c: Uint8Array) => {
            if (isSessionA && first) {
              first = false
              return new Promise<void>((r) => {
                releaseFirstWrite = r
              })
            }
            return s.write(c)
          },
          close: () => s.close()
        }
      }
    }
    const dl = createUpdateDownloader({
      fetchStream: hs.fetchStream,
      fs: slowWriteFs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const pa = dl.start(WIN_URL)
    await tick()
    hs.respond(0, 15)
    await tick() // 会话 A：sink 就绪，consume 挂起
    hs.calls[0].pushChunk(10)
    await tick() // A 的首个写盘已执行并挂起（受控放行），模拟真实磁盘/杀软拖慢
    hs.calls[0].pushChunk(5) // 排队等在挂起写之后的 A chunk
    dl.cancel()
    const pb = dl.start(WIN_URL2) // 立即重开（会话 B，不同 URL 不同 .part）
    await tick()
    hs.respond(1, 80)
    await tick() // 会话 B：自己的 sink 已装好
    releaseFirstWrite!() // 放行 A 的首个写：其后排队的 A chunk 写链开始执行
    await tick()
    hs.calls[0].finish() // A 的流迟到结束
    await pa
    hs.calls[1].pushChunk(80)
    hs.calls[1].finish()
    const rb = await pb
    expect(rb.ok && rb.data.state).toBe('downloaded')
    // B 的 .part 只能含 B 自己的 80 字节：A 迟到的 5 字节一旦混入，安装包被污染且 receivedBytes 校验发现不了
    expect(fsEnv.sinks[1].byteLengths).toEqual([80])
  })

  it('成功收尾窗口 cancel（sink.close 挂起时）：终态 idle、.part 已删、不 rename 不落 downloaded', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(30)
    const clock = makeClock()
    let releaseClose: (() => void) | null = null
    let closeP: Promise<void> | null = null
    const slowCloseFs: UpdateDownloaderFs = {
      ...fsEnv.fs,
      createSink: async (p) => {
        const s = await fsEnv.fs.createSink(p)
        return {
          write: (c: Uint8Array) => s.write(c),
          close: () => {
            closeP ??= new Promise<void>((r) => {
              releaseClose = r
            })
            return closeP
          }
        }
      }
    }
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: slowCloseFs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const p = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(30)
    hang.finish() // 流正常收尾 → 成功路径走到 await sink.close() 挂起
    await tick()
    expect(dl.status().state).toBe('downloading') // 仍在收尾窗口，未落 downloaded
    dl.cancel()
    expect(dl.status().state).toBe('idle')
    releaseClose!()
    await tick()
    const r = await p
    expect(r.ok && r.data.state).toBe('idle')
    expect(dl.status().state).toBe('idle')
    expect(dl.status().error).toBeNull()
    expect(fsEnv.state.renamed).toEqual([]) // close 期间取消：rename 不再执行
    expect(fsEnv.state.rm).toContain(join(DIR, 'GTools.Setup.9.9.9.exe.part'))
  })

  // 终测轮新增：停滞兜底协程的 rm 挂起（磁盘/杀软卡）窗口内用户 cancel——终态只能落 idle 一次，兜底不得再写 failed
  it('停滞兜底 rm 挂起窗口内 cancel：终态 idle 唯一，兜底协程不得落 failed', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(50)
    const clock = makeClock()
    const part = join(DIR, 'GTools.Setup.9.9.9.exe.part')
    let releaseRm: (() => void) | null = null
    const slowRmFs: UpdateDownloaderFs = {
      ...fsEnv.fs,
      rm: (p, o) =>
        p === part
          ? new Promise<void>((r) => {
              releaseRm = () => {
                void fsEnv.fs.rm(p, o).then(r)
              }
            })
          : fsEnv.fs.rm(p, o)
    }
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: slowRmFs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    const p = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(10)
    clock.advance(31_000) // 停滞触发：close 立即完成，兜底协程卡在 rm
    await tick()
    expect(dl.status().state).toBe('downloading') // rm 挂起中，终态尚未落定
    dl.cancel()
    expect(dl.status().state).toBe('idle')
    releaseRm!() // 兜底 rm 完成：gen 已失效，不得再写状态
    await tick()
    hang.fail(new Error('aborted')) // 迟到的流 reject 也不得改终态
    const r = await p
    expect(r.ok && r.data.state).toBe('idle')
    expect(dl.status().state).toBe('idle')
    expect(dl.status().error).toBeNull()
    expect(fsEnv.sinks[0].closed).toBe(true)
  })

  // 终测轮新增：停滞兜底协程的 rm 与新会话竞速——真实场景是 close 在途（杀软扫描拖长）期间
  // cancel + 立即重开同 URL，兜底协程随后的 rm 若不查接管会删掉新会话正在写的 .part
  it('停滞兜底 close 在途时新会话接管同路径：兜底 rm 被接管守卫跳过，不得删新会话 .part', async () => {
    const fsEnv = makeFs()
    const hs = makeHandshakeStream()
    const clock = makeClock()
    const part = join(DIR, 'GTools.Setup.9.9.9.exe.part')
    const ops: string[] = []
    let heldRelease: (() => void) | null = null
    let firstSinkHooked = false
    const holdFs: UpdateDownloaderFs = {
      ...fsEnv.fs,
      rm: (p, o) => {
        ops.push(`rm:${p}`)
        return fsEnv.fs.rm(p, o)
      },
      createSink: async (p) => {
        const s = await fsEnv.fs.createSink(p)
        ops.push(`sink:${p}`)
        // 首个 sink 的 close 挂起：模拟停滞兜底协程被杀软扫描拖长，放行时新会话已接管同路径
        if (!firstSinkHooked) {
          firstSinkHooked = true
          const realClose = s.close.bind(s)
          return {
            write: (c: Uint8Array) => s.write(c),
            close: () =>
              new Promise<void>((r) => {
                heldRelease = () => {
                  void realClose().then(r)
                }
              })
          }
        }
        return s
      }
    }
    const dl = createUpdateDownloader({
      fetchStream: hs.fetchStream,
      fs: holdFs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule
    })
    // A 会话的 consume 在测试结束前不会 settle（cancel 不使 hs 流 reject），不可 await，void 挂起即可
    void dl.start(WIN_URL)
    await tick()
    hs.respond(0, 50)
    await tick() // 会话 A：sink 就绪，consume 挂起
    hs.calls[0].pushChunk(10)
    clock.advance(31_000) // 停滞触发：兜底协程在 close 上被测试扣住
    await tick()
    dl.cancel() // 回 idle（A 的 sink/.part 引用已归兜底协程）
    const pb = dl.start(WIN_URL) // 立即重开同 URL（同 .part 路径）：预清扫删 A 的 .part，建自己的新 .part
    await tick()
    hs.respond(1, 50)
    await tick() // 会话 B：同步赋 partPath 接管同路径 + createSink 完成
    heldRelease!() // 放行兜底 close：随后 rm 决策须被 partPath 接管守卫跳过
    await tick()
    expect(ops.lastIndexOf(`rm:${part}`)).toBeLessThan(ops.lastIndexOf(`sink:${part}`))
    hs.calls[1].pushChunk(50)
    hs.calls[1].finish()
    const rb = await pb
    expect(rb.ok && rb.data.state).toBe('downloaded')
    expect(fsEnv.sinks[1].byteLengths).toEqual([50]) // B 只收到自己的字节
  })
})

describe('update-downloader 终态快照完整性', () => {
  it('节流跳过的中间帧不影响终帧：downloaded 终态快照字段完整（total 未知也照常累计字节）', async () => {
    const fsEnv = makeFs()
    const hang = makeHangingStream(null) // Content-Length 缺失
    const clock = makeClock()
    const snaps: UpdateDownloadSnapshot[] = []
    const dl = createUpdateDownloader({
      fetchStream: hang.fetchStream,
      fs: fsEnv.fs,
      dir: DIR,
      platform: 'win32',
      now: clock.now,
      schedule: clock.schedule,
      onProgress: (s) => snaps.push(s)
    })
    const p = dl.start(WIN_URL)
    await tick()
    hang.pushChunk(10)
    hang.pushChunk(10) // 200ms 内且无百分比基准，被节流
    hang.pushChunk(10)
    hang.finish()
    const r = await p
    expect(r.ok).toBe(true)
    expect(snaps.at(-1)).toEqual({
      state: 'downloaded',
      receivedBytes: 30,
      totalBytes: null,
      speedBps: null,
      fileName: 'GTools.Setup.9.9.9.exe',
      installerPath: join(DIR, 'GTools.Setup.9.9.9.exe'),
      error: null
    })
  })
})

describe('sweepUpdateCache', () => {
  it('删目录内全部 .part（大小写不敏感），其余文件不动', async () => {
    const fsEnv = makeFs({ 'a.part': 1, 'b.exe': 2, 'c.PART': 3 })
    await sweepUpdateCache(fsEnv.fs, DIR)
    expect(fsEnv.state.rm).toEqual([join(DIR, 'a.part'), join(DIR, 'c.PART')])
  })

  it('目录不存在静默返回（不抛错）', async () => {
    const rm = vi.fn(async () => {})
    const fs = {
      readdir: async (): Promise<string[]> => {
        throw new Error('ENOENT')
      },
      rm
    }
    await expect(sweepUpdateCache(fs, DIR)).resolves.toBeUndefined()
    expect(rm).not.toHaveBeenCalled()
  })
})
