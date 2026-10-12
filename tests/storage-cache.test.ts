import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginStorageService } from '../src/main/services/storage'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gtools-storage-cache-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('PluginStorageService 内存缓存与写串行', () => {
  it('并发 set/remove 经 per-plugin 串行读改写，不互相覆盖', async () => {
    const svc = new PluginStorageService(root)
    await Promise.all([
      svc.set('p', 'a', 1),
      svc.set('p', 'b', 2),
      svc.set('p', 'c', 3),
      svc.remove('p', 'a')
    ])
    expect(await svc.get('p', 'a')).toBeNull()
    expect(await svc.get('p', 'b')).toBe(2)
    expect(await svc.get('p', 'c')).toBe(3)
    // 落盘与内存一致（最终态写入全量缓存）
    const onDisk = JSON.parse(await readFile(join(root, 'p', 'kv.json'), 'utf-8'))
    expect(onDisk).toEqual({ b: 2, c: 3 })
  })

  it('get 走缓存：外部改动文件后内存态不受影响（同进程单一事实源）', async () => {
    const svc = new PluginStorageService(root)
    await svc.set('p', 'k', 'mem')
    await writeFile(join(root, 'p', 'kv.json'), JSON.stringify({ k: 'disk' }), 'utf-8')
    expect(await svc.get('p', 'k')).toBe('mem')
  })

  it('replaceAll 同步换缓存：后续 get 立即读到新值', async () => {
    const svc = new PluginStorageService(root)
    await svc.set('p', 'a', 1)
    await svc.replaceAll('p', { b: 2 })
    expect(await svc.get('p', 'a')).toBeNull()
    expect(await svc.get('p', 'b')).toBe(2)
    expect(JSON.parse(await readFile(join(root, 'p', 'kv.json'), 'utf-8'))).toEqual({ b: 2 })
  })
})

describe('PluginStorageService 损坏留证', () => {
  it('kv.json 非法 JSON：原文件 rename 为 .corrupt-<时间戳> 留证，数据按空重新开始', async () => {
    await mkdir(join(root, 'p'), { recursive: true })
    await writeFile(join(root, 'p', 'kv.json'), '{broken', 'utf-8')
    const svc = new PluginStorageService(root)
    expect(await svc.get('p', 'old')).toBeNull()
    await svc.set('p', 'k', 'v')
    const names = await readdir(join(root, 'p'))
    const evidence = names.find((n) => /^kv\.json\.corrupt-\d{8}-\d{6}$/.test(n))
    expect(evidence).toBeTruthy()
    expect(await readFile(join(root, 'p', evidence!), 'utf-8')).toBe('{broken') // 残余保留
    expect(JSON.parse(await readFile(join(root, 'p', 'kv.json'), 'utf-8'))).toEqual({ k: 'v' })
  })

  it('kv.json 为非对象 JSON（数组）：同样按损坏留证处理', async () => {
    await mkdir(join(root, 'p2'), { recursive: true })
    await writeFile(join(root, 'p2', 'kv.json'), '[1,2]', 'utf-8')
    const svc = new PluginStorageService(root)
    expect(await svc.keys('p2')).toEqual([])
    const names = await readdir(join(root, 'p2'))
    expect(names.some((n) => n.startsWith('kv.json.corrupt-'))).toBe(true)
  })

  it('留证只发生一次：损坏读取入缓存后不再重复 rename', async () => {
    await mkdir(join(root, 'p3'), { recursive: true })
    await writeFile(join(root, 'p3', 'kv.json'), 'oops', 'utf-8')
    const svc = new PluginStorageService(root)
    await svc.get('p3', 'k')
    await svc.get('p3', 'k2')
    await svc.keys('p3')
    const names = await readdir(join(root, 'p3'))
    expect(names.filter((n) => n.startsWith('kv.json.corrupt-'))).toHaveLength(1)
  })
})
