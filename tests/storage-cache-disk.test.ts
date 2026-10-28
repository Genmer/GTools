import { beforeEach, describe, expect, it, vi } from 'vitest'

// storage.ts 顶层 import node:fs/promises（无构造注入位），盘 I/O 只能模块级 mock；
// fake 全内存并计数，专测「缓存命中零盘读」与写队列/留证的失败分支（真实盘无法数读次数）
const mem = vi.hoisted(() => {
  const state = {
    files: new Map<string, string>(),
    reads: 0,
    writes: [] as { file: string; content: string }[],
    renames: [] as { from: string; to: string }[],
    failWrites: 0,
    failRenames: 0,
    failReads: 0
  }
  return state
})

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readdir: vi.fn(async () => [] as Array<{ name: string; isDirectory(): boolean }>),
  readFile: vi.fn(async (file: string): Promise<string> => {
    mem.reads++
    if (mem.failReads > 0) {
      mem.failReads--
      throw Object.assign(new Error(`EBUSY: read failed: ${file}`), { code: 'EBUSY' })
    }
    const content = mem.files.get(file)
    if (content === undefined) {
      const err = new Error(`ENOENT: no such file: ${file}`) as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }
    return content
  }),
  rename: vi.fn(async (from: string, to: string): Promise<void> => {
    mem.renames.push({ from, to }) // 失败也留痕，便于断言留证目标路径
    if (mem.failRenames > 0) {
      mem.failRenames--
      throw Object.assign(new Error('EBUSY: rename failed'), { code: 'EBUSY' })
    }
    const content = mem.files.get(from)
    mem.files.delete(from)
    if (content !== undefined) mem.files.set(to, content)
  }),
  writeFile: vi.fn(async (file: string, content: string): Promise<void> => {
    if (mem.failWrites > 0) {
      mem.failWrites--
      throw new Error('ENOSPC: write failed')
    }
    mem.writes.push({ file, content })
    mem.files.set(file, content)
  })
}))

import { PluginStorageService } from '../src/main/services/storage'

// 路径与实现同源 join：win32 上 join 产反斜杠，POSIX 字面量会对不上假 fs 的键（双端适配）
import { join } from 'node:path'
const ROOT = '/gtools-test/storage'
const KV = join(ROOT, 'p', 'kv.json')
const KV_TMP = join(ROOT, 'p', 'kv.json.tmp')

beforeEach(() => {
  mem.files.clear()
  mem.reads = 0
  mem.writes.length = 0
  mem.renames.length = 0
  mem.failWrites = 0
  mem.failRenames = 0
  mem.failReads = 0
})

describe('PluginStorageService 内存缓存（get 不重复读盘）', () => {
  it('首读一次后，任意次 get/keys 不再读盘', async () => {
    const svc = new PluginStorageService(ROOT)
    await svc.set('p', 'a', 1) // 首次触达：一次读（文件不存在）+ 一次写链
    expect(mem.reads).toBe(1)
    for (let i = 0; i < 6; i++) {
      expect(await svc.get('p', 'a')).toBe(1)
      expect(await svc.keys('p')).toEqual(['a'])
    }
    expect(mem.reads).toBe(1)
  })

  it('并发首读 single-flight：多个并发 get 共享同一次盘读', async () => {
    mem.files.set(KV, JSON.stringify({ a: 1, b: 2 }))
    const svc = new PluginStorageService(ROOT)
    const [a, b, keys] = await Promise.all([svc.get('p', 'a'), svc.get('p', 'b'), svc.keys('p')])
    expect(a).toBe(1)
    expect(b).toBe(2)
    expect(keys).toEqual(['a', 'b'])
    expect(mem.reads).toBe(1)
  })

  it('set 后立即可见：写完即读返回新值，且不产生新的盘读', async () => {
    const svc = new PluginStorageService(ROOT)
    await svc.set('p', 'k', 'v1')
    const readsAfterFirst = mem.reads
    expect(await svc.get('p', 'k')).toBe('v1')
    await svc.set('p', 'k', 'v2') // 写路径走缓存对象，同样不回读盘
    expect(await svc.get('p', 'k')).toBe('v2')
    expect(mem.reads).toBe(readsAfterFirst)
  })
})

describe('PluginStorageService 写队列串行化', () => {
  it('并发 set 落盘按队序全量提交：最后一笔包含前一笔的键（读改写不互覆）', async () => {
    const svc = new PluginStorageService(ROOT)
    await Promise.all([svc.set('p', 'a', 1), svc.set('p', 'b', 2)])
    const kvWrites = mem.writes.filter((w) => w.file === KV_TMP) // 落盘先写 tmp 再 rename
    expect(kvWrites).toHaveLength(2)
    // 串行证据：队尾那笔写入的是全量 {a,b}，而非只含单键的互覆结果
    expect(JSON.parse(kvWrites.at(-1)!.content)).toEqual({ a: 1, b: 2 })
    expect(await svc.get('p', 'a')).toBe(1)
    expect(await svc.get('p', 'b')).toBe(2)
  })

  it('单次写失败不传染后续：该次 set 报错，随后的 set 正常入队落盘', async () => {
    const svc = new PluginStorageService(ROOT)
    mem.failWrites = 1
    await expect(svc.set('p', 'a', 1)).rejects.toThrow('ENOSPC')
    await svc.set('p', 'b', 2)
    // 缓存是单一事实源：失败写遗留的 a 随成功写一并全量提交
    expect(await svc.get('p', 'a')).toBe(1)
    expect(await svc.get('p', 'b')).toBe(2)
    expect(JSON.parse(mem.files.get(KV)!)).toEqual({ a: 1, b: 2 })
  })
})

describe('PluginStorageService 损坏留证的失败分支', () => {
  it('留证 rename 失败：仍按空数据处理，后续读写正常（不抛错不卡缓存）', async () => {
    mem.files.set(KV, '{broken')
    mem.failRenames = 1
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const svc = new PluginStorageService(ROOT)
    await expect(svc.get('p', 'old')).resolves.toBeNull()
    expect(mem.renames).toHaveLength(1)
    expect(mem.renames[0].to).toMatch(/[/\\]kv\.json\.corrupt-\d{8}-\d{6}$/)
    await svc.set('p', 'k', 'v')
    expect(await svc.get('p', 'k')).toBe('v')
    expect(JSON.parse(mem.files.get(KV)!)).toEqual({ k: 'v' })
    errSpy.mockRestore()
  })
})

describe('PluginStorageService 读错误不污染缓存（仅 ENOENT 是无数据）', () => {
  it('EBUSY 读失败：get 拿到错误而非空，缓存不被空态污染——锁解除后 set 不以空底覆盖盘上数据', async () => {
    mem.files.set(KV, JSON.stringify({ a: 1 })) // 盘上已有数据
    mem.failReads = 1 // 首读被瞬时锁（杀软/备份软件）
    const svc = new PluginStorageService(ROOT)
    await expect(svc.get('p', 'a')).rejects.toThrow('EBUSY')
    // 修复前：读错误被当无数据，空态进缓存，set 会把盘上 {a:1} 覆盖成只剩新键
    await svc.set('p', 'b', 2)
    expect(JSON.parse(mem.files.get(KV)!)).toEqual({ a: 1, b: 2 })
  })

  it('读失败后下次触达重新读盘：成功后恢复正常缓存语义', async () => {
    mem.files.set(KV, JSON.stringify({ a: 1 }))
    mem.failReads = 1
    const svc = new PluginStorageService(ROOT)
    await expect(svc.keys('p')).rejects.toThrow('EBUSY')
    expect(await svc.get('p', 'a')).toBe(1) // 第二次读盘成功（single-flight 已随失败清空）
    expect(mem.reads).toBe(2)
  })
})

describe('PluginStorageService rename 瞬时锁退避重试', () => {
  it('第一次 EBUSY 第二次成功：写成功，rename 共尝试两次', async () => {
    const svc = new PluginStorageService(ROOT)
    mem.failRenames = 1
    await svc.set('p', 'a', 1)
    expect(mem.renames.filter((r) => r.to === KV)).toHaveLength(2)
    expect(JSON.parse(mem.files.get(KV)!)).toEqual({ a: 1 })
    expect(await svc.get('p', 'a')).toBe(1)
  })

  it('三次全失败：错误上抛，后续写不被传染', async () => {
    const svc = new PluginStorageService(ROOT)
    mem.failRenames = 3
    await expect(svc.set('p', 'a', 1)).rejects.toThrow('EBUSY')
    expect(mem.renames.filter((r) => r.to === KV)).toHaveLength(3)
    await svc.set('p', 'b', 2) // 锁解除后正常入队
    // 缓存是单一事实源：失败写遗留的 a 随成功写一并全量提交
    expect(JSON.parse(mem.files.get(KV)!)).toEqual({ a: 1, b: 2 })
  })

  it('非瞬时锁错误码（如 ENOSPC）不重试：一次失败即上抛', async () => {
    const svc = new PluginStorageService(ROOT)
    mem.failWrites = 1 // writeFile 错误不在 rename 重试范围
    await expect(svc.set('p', 'a', 1)).rejects.toThrow('ENOSPC')
    expect(mem.renames).toHaveLength(0)
  })
})
