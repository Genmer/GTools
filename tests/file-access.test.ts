import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { FileAccessService, PathGuard } from '../src/main/services/file-access'
import type { FileAccessFs } from '../src/main/services/file-access'

describe('PathGuard 授权判定（posix 分隔符）', () => {
  it('文件授权精确匹配，父目录与兄弟路径不可访问', () => {
    const g = new PathGuard('/', false)
    g.grant('p', ['/tmp/share/a.txt'])
    expect(g.canAccess('p', '/tmp/share/a.txt')).toBe(true)
    expect(g.canAccess('p', '/tmp/share')).toBe(false)
    expect(g.canAccess('p', '/tmp/share/b.txt')).toBe(false)
    expect(g.canAccess('p', '/tmp/share/a.txt.evil')).toBe(false)
  })

  it('目录授权覆盖整棵子树', () => {
    const g = new PathGuard('/', false)
    g.grant('p', ['/tmp/share'])
    expect(g.canAccess('p', '/tmp/share/a.txt')).toBe(true)
    expect(g.canAccess('p', '/tmp/share/sub/deep/c.txt')).toBe(true)
    expect(g.canAccess('p', '/tmp/other/a.txt')).toBe(false)
    // 前缀字符串相同但非路径边界
    expect(g.canAccess('p', '/tmp/share-evil/a.txt')).toBe(false)
  })

  it('授权按插件隔离', () => {
    const g = new PathGuard('/', false)
    g.grant('p', ['/tmp/share'])
    expect(g.canAccess('q', '/tmp/share/a.txt')).toBe(false)
  })

  it('大小写不敏感模式（win/mac 文件系统）', () => {
    const g = new PathGuard('\\', true)
    g.grant('p', ['C:\\Users\\x\\Share'])
    expect(g.canAccess('p', 'c:\\users\\x\\share\\a.txt')).toBe(true)
    expect(g.canAccess('p', 'C:\\Users\\x\\Other\\a.txt')).toBe(false)
  })

  it('rename：同目录放行，跨目录须目标已授权', () => {
    const g = new PathGuard('/', false)
    g.grant('p', ['/tmp/share/a.txt'])
    expect(g.canRename('p', '/tmp/share/a.txt', '/tmp/share/a(1).txt')).toBe(true)
    expect(g.canRename('p', '/tmp/share/a.txt', '/tmp/other/a.txt')).toBe(false)

    g.grant('p', ['/tmp/dest'])
    expect(g.canRename('p', '/tmp/share/a.txt', '/tmp/dest/a.txt')).toBe(true)
  })
})

function fakeFs(files: Record<string, string | Buffer> = {}): FileAccessFs & {
  writeFileCalls: Array<{ path: string; data: string | Buffer; opts?: { encoding?: string; flag?: string } }>
  renameCalls: Array<{ from: string; to: string }>
  rmCalls: string[]
  mkdirCalls: string[]
  dirs: Record<string, Array<{ name: string; isDirectory(): boolean }>>
} {
  const writeFileCalls: Array<{ path: string; data: string | Buffer; opts?: { encoding?: string; flag?: string } }> = []
  const renameCalls: Array<{ from: string; to: string }> = []
  const rmCalls: string[] = []
  const mkdirCalls: string[] = []
  const dirs: Record<string, Array<{ name: string; isDirectory(): boolean }>> = {}
  const fs = {
    async readFile(path: string, opts?: { encoding?: string }) {
      const v = files[path]
      if (v === undefined) throw new Error('ENOENT')
      if (opts?.encoding === 'utf-8') return typeof v === 'string' ? v : v.toString('utf-8')
      return typeof v === 'string' ? Buffer.from(v) : v
    },
    async writeFile(path: string, data: string | Buffer, opts?: { encoding?: string; flag?: string }) {
      writeFileCalls.push({ path, data, opts })
      files[path] = data
    },
    async rename(from: string, to: string) {
      renameCalls.push({ from, to })
    },
    async rm(path: string) {
      rmCalls.push(path)
    },
    async stat(path: string) {
      const v = files[path]
      if (v === undefined) {
        const d = dirs[path]
        if (d === undefined) throw new Error('ENOENT')
        return { isFile: () => false, isDirectory: () => true, size: 0, mtimeMs: 1 }
      }
      return { isFile: () => true, isDirectory: () => false, size: v.length, mtimeMs: 2 }
    },
    async readdir(path: string) {
      return dirs[path] ?? []
    },
    async mkdir(path: string) {
      mkdirCalls.push(path)
    },
    async realpath(path: string) {
      return path
    }
  }
  return Object.assign(fs as FileAccessFs, { writeFileCalls, renameCalls, rmCalls, mkdirCalls, dirs })
}

describe('FileAccessService', () => {
  // resolve/join 让测试路径跟随平台分隔符，与服务层 resolve() 归一化结果一致（win 反斜杠 / posix 正斜杠）
  const ROOT = resolve('/tmp/gtools-fa')

  it('grant 后可读：utf-8 与 base64 两种编码', async () => {
    const fs = fakeFs({ [join(ROOT, 'a.txt')]: 'hello' })
    const svc = new FileAccessService(fs)
    await svc.grant('p', [join(ROOT, 'a.txt')])
    expect(await svc.read('p', join(ROOT, 'a.txt'))).toBe('hello')
    expect(await svc.read('p', join(ROOT, 'a.txt'), { encoding: 'base64' })).toBe(Buffer.from('hello').toString('base64'))
  })

  it('未授权路径读写抛错（含 .. 逃逸归一化后判定）', async () => {
    const fs = fakeFs({ [join(ROOT, 'a.txt')]: 'x', [resolve('/etc/passwd')]: 'secret' })
    const svc = new FileAccessService(fs)
    await svc.grant('p', [join(ROOT, 'a.txt')])
    await expect(svc.read('p', resolve('/etc/passwd'))).rejects.toThrow(/未授权/)
    await expect(svc.write('p', join(ROOT, '../evil.txt'), 'x')).rejects.toThrow(/未授权/)
    // grant 只接受绝对路径
    await expect(svc.grant('p', ['relative/x.txt'])).rejects.toThrow(/绝对路径/)
  })

  it('write：base64 二进制 / append / createDir', async () => {
    const fs = fakeFs()
    const svc = new FileAccessService(fs)
    await svc.grant('p', [join(ROOT, 'out')])
    await svc.write('p', join(ROOT, 'out', 'img.png'), 'aGVsbG8=', { encoding: 'base64' })
    expect(fs.writeFileCalls[0].data).toEqual(Buffer.from('hello'))
    await svc.write('p', join(ROOT, 'out', 'log.txt'), 'line1\n', { append: true })
    expect(fs.writeFileCalls[1].opts).toEqual({ flag: 'a' })
    await svc.write('p', join(ROOT, 'out', 'new', 'd.txt'), 'x', { createDir: true })
    expect(fs.mkdirCalls).toContain(join(ROOT, 'out', 'new'))
  })

  it('rename：同目录放行、跨目录未授权拒绝', async () => {
    const fs = fakeFs()
    const svc = new FileAccessService(fs)
    await svc.grant('p', [join(ROOT, 'a.txt')])
    await svc.rename('p', join(ROOT, 'a.txt'), join(ROOT, 'a(1).txt'))
    expect(fs.renameCalls).toEqual([{ from: join(ROOT, 'a.txt'), to: join(ROOT, 'a(1).txt') }])
    await expect(svc.rename('p', join(ROOT, 'a.txt'), resolve('/tmp/elsewhere/a.txt'))).rejects.toThrow(/重命名/)
  })

  it('stat 不存在返回 null 而非抛错', async () => {
    const fs = fakeFs()
    const svc = new FileAccessService(fs)
    await svc.grant('p', [join(ROOT, 'gone.txt')])
    expect(await svc.stat('p', join(ROOT, 'gone.txt'))).toMatchObject({ exists: false })
  })

  it('list 目录授权后可列（含递归与 size 探测）', async () => {
    const fs = fakeFs({ [join(ROOT, 'd', 'b.txt')]: '12345' })
    fs.dirs[join(ROOT, 'd')] = [
      { name: 'sub', isDirectory: () => true },
      { name: 'b.txt', isDirectory: () => false }
    ]
    fs.dirs[join(ROOT, 'd', 'sub')] = [{ name: 'c.md', isDirectory: () => false }]
    const svc = new FileAccessService(fs)
    await svc.grant('p', [join(ROOT, 'd')])
    const flat = await svc.list('p', join(ROOT, 'd'))
    expect(flat.map((e) => e.name)).toEqual(['b.txt', 'sub'])
    expect(flat.find((e) => e.name === 'b.txt')).toMatchObject({ size: 5, isDirectory: false })
    const deep = await svc.list('p', join(ROOT, 'd'), { recursive: true })
    expect(deep.map((e) => e.path)).toEqual([join(ROOT, 'd', 'b.txt'), join(ROOT, 'd', 'sub'), join(ROOT, 'd', 'sub', 'c.md')])
  })

  it('mkdir 要求父目录已授权', async () => {
    const fs = fakeFs()
    const svc = new FileAccessService(fs)
    await svc.grant('p', [join(ROOT, 'd')])
    await svc.mkdir('p', join(ROOT, 'd', 'new', 'sub'))
    expect(fs.mkdirCalls).toEqual([join(ROOT, 'd', 'new', 'sub')])
    await expect(svc.mkdir('p', resolve('/tmp/elsewhere/x'))).rejects.toThrow(/未授权/)
  })

  it('remove 走递归 rm 且要求授权', async () => {
    const fs = fakeFs()
    const svc = new FileAccessService(fs)
    await svc.grant('p', [join(ROOT, 'd')])
    await svc.remove('p', join(ROOT, 'd', 'sub'))
    expect(fs.rmCalls).toEqual([join(ROOT, 'd', 'sub')])
    await expect(svc.remove('p', resolve('/tmp/elsewhere'))).rejects.toThrow(/未授权/)
  })
})
