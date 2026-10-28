import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as nodeFs from 'node:fs/promises'
import { PluginStorageService } from '../src/main/services/storage'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gtools-storage-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('PluginStorageService dumpAll / replaceAll（备份配套）', () => {
  it('dumpAll 汇总各插件 KV，空命名空间跳过', async () => {
    const svc = new PluginStorageService(root)
    await svc.set('clipboard', 'state', { records: [1, 2] })
    await svc.set('launcher', 'cache', 'x')
    await svc.set('empty-plugin', 'k', 'v')
    await svc.remove('empty-plugin', 'k')
    const all = await svc.dumpAll()
    expect(all).toEqual({
      clipboard: { state: { records: [1, 2] } },
      launcher: { cache: 'x' }
    })
  })

  it('replaceAll 整体替换（导入方向），传 {} 即清空', async () => {
    const svc = new PluginStorageService(root)
    await svc.set('clipboard', 'state', { old: true })
    await svc.replaceAll('clipboard', { state: { new: 1 }, extra: 'y' })
    expect(await svc.get('clipboard', 'state')).toEqual({ new: 1 })
    expect(await svc.keys('clipboard')).toEqual(['state', 'extra'])
    await svc.replaceAll('clipboard', {})
    expect(await svc.keys('clipboard')).toEqual([])
    // 换回原实现读写仍正常（原子写路径一致）
    await svc.set('clipboard', 'again', 1)
    expect(await nodeFs.readFile(join(root, 'clipboard', 'kv.json'), 'utf-8')).toContain('again')
  })

  it('根目录不存在时 dumpAll 返回空对象', async () => {
    const svc = new PluginStorageService(join(root, 'not-exist'))
    expect(await svc.dumpAll()).toEqual({})
  })

  it('单插件读失败只跳过该插件留痕，好插件照常进备份（不炸整包）', async () => {
    const svc = new PluginStorageService(root)
    await svc.set('good', 'k', 'v')
    // bad 插件的 kv.json 换成目录：readFile 必失败（win32 报 EPERM、POSIX 报 EISDIR，均非 ENOENT）
    await mkdir(join(root, 'bad', 'kv.json'), { recursive: true })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const all = await svc.dumpAll()
    expect(all).toEqual({ good: { k: 'v' } })
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]![0])).toContain('bad')
    warnSpy.mockRestore()
  })
})
