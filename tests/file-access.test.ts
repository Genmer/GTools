import { describe, expect, it } from 'vitest'
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
  const ROOT = '/tmp/gtools-fa'

  it('grant 后可读：utf-8 与 base64 两种编码', async () => {
    const fs = fakeFs({ [`${ROOT}/a.txt`]: 'hello' })
    const svc = new FileAccessService(fs)
    await svc.grant('p', [`${ROOT}/a.txt`])
    expect(await svc.read('p', `${ROOT}/a.txt`)).toBe('hello')
    expect(await svc.read('p', `${ROOT}/a.txt`, { encoding: 'base64' })).toBe(Buffer.from('hello').toString('base64'))
  })

  it('未授权路径读写抛错（含 .. 逃逸归一化后判定）', async () => {
    const fs = fakeFs({ [`${ROOT}/a.txt`]: 'x', ['/etc/passwd']: 'secret' })
    const svc = new FileAccessService(fs)
    await svc.grant('p', [`${ROOT}/a.txt`])
    await expect(svc.read('p', '/etc/passwd')).rejects.toThrow(/未授权/)
    await expect(svc.write('p', `${ROOT}/../evil.txt`, 'x')).rejects.toThrow(/未授权/)
    // grant 只接受绝对路径
    await expect(svc.grant('p', ['relative/x.txt'])).rejects.toThrow(/绝对路径/)
  })

  it('write：base64 二进制 / append / createDir', async () => {
    const fs = fakeFs()
    const svc = new FileAccessService(fs)
    await svc.grant('p', [`${ROOT}/out`])
    await svc.write('p', `${ROOT}/out/img.png`, 'aGVsbG8=', { encoding: 'base64' })
    expect(fs.writeFileCalls[0].data).toEqual(Buffer.from('hello'))
    await svc.write('p', `${ROOT}/out/log.txt`, 'line1\n', { append: true })
    expect(fs.writeFileCalls[1].opts).toEqual({ flag: 'a' })
    await svc.write('p', `${ROOT}/out/new/d.txt`, 'x', { createDir: true })
    expect(fs.mkdirCalls).toContain(`${ROOT}/out/new`)
  })

  it('rename：同目录放行、跨目录未授权拒绝', async () => {
    const fs = fakeFs()
    const svc = new FileAccessService(fs)
    await svc.grant('p', [`${ROOT}/a.txt`])
    await svc.rename('p', `${ROOT}/a.txt`, `${ROOT}/a(1).txt`)
    expect(fs.renameCalls).toEqual([{ from: `${ROOT}/a.txt`, to: `${ROOT}/a(1).txt` }])
    await expect(svc.rename('p', `${ROOT}/a.txt`, '/tmp/elsewhere/a.txt')).rejects.toThrow(/重命名/)
  })

  it('stat 不存在返回 null 而非抛错', async () => {
    const fs = fakeFs()
    const svc = new FileAccessService(fs)
    await svc.grant('p', [`${ROOT}/gone.txt`])
    expect(await svc.stat('p', `${ROOT}/gone.txt`)).toMatchObject({ exists: false })
  })

  it('list 目录授权后可列（含递归与 size 探测）', async () => {
    const fs = fakeFs({ [`${ROOT}/d/b.txt`]: '12345' })
    fs.dirs[`${ROOT}/d`] = [
      { name: 'sub', isDirectory: () => true },
      { name: 'b.txt', isDirectory: () => false }
    ]
    fs.dirs[`${ROOT}/d/sub`] = [{ name: 'c.md', isDirectory: () => false }]
    const svc = new FileAccessService(fs)
    await svc.grant('p', [`${ROOT}/d`])
    const flat = await svc.list('p', `${ROOT}/d`)
    expect(flat.map((e) => e.name)).toEqual(['b.txt', 'sub'])
    expect(flat.find((e) => e.name === 'b.txt')).toMatchObject({ size: 5, isDirectory: false })
    const deep = await svc.list('p', `${ROOT}/d`, { recursive: true })
    expect(deep.map((e) => e.path)).toEqual([`${ROOT}/d/b.txt`, `${ROOT}/d/sub`, `${ROOT}/d/sub/c.md`])
  })

  it('mkdir 要求父目录已授权', async () => {
    const fs = fakeFs()
    const svc = new FileAccessService(fs)
    await svc.grant('p', [`${ROOT}/d`])
    await svc.mkdir('p', `${ROOT}/d/new/sub`)
    expect(fs.mkdirCalls).toEqual([`${ROOT}/d/new/sub`])
    await expect(svc.mkdir('p', '/tmp/elsewhere/x')).rejects.toThrow(/未授权/)
  })

  it('remove 走递归 rm 且要求授权', async () => {
    const fs = fakeFs()
    const svc = new FileAccessService(fs)
    await svc.grant('p', [`${ROOT}/d`])
    await svc.remove('p', `${ROOT}/d/sub`)
    expect(fs.rmCalls).toEqual([`${ROOT}/d/sub`])
    await expect(svc.remove('p', '/tmp/elsewhere')).rejects.toThrow(/未授权/)
  })
})
