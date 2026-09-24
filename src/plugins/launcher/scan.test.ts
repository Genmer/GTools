// 应用扫描单测：fs/exec 全部注入内存 fixture，不触真实磁盘与注册表。
import { describe, expect, it } from 'vitest'
import type { DirentLike, FsLike, ScanDeps } from './types'
import { defaultDarwinRoots, defaultWin32Roots, parseRegAppPaths, scanApps, scanDarwin, scanWin32 } from './scan'

// spec: 路径 → { 子名: 'dir' | 文件内容 }
function makeFs(spec: Record<string, Record<string, 'dir' | string>>): FsLike {
  return {
    async readdir(dir: string): Promise<DirentLike[]> {
      const node = spec[dir]
      if (!node) throw new Error(`ENOENT: ${dir}`)
      return Object.entries(node).map(([name, v]) => ({ name, isDirectory: () => v === 'dir' }))
    },
    async readFile(path: string): Promise<string> {
      const parent = path.slice(0, path.lastIndexOf('/'))
      const name = path.slice(path.lastIndexOf('/') + 1)
      const v = spec[parent]?.[name]
      if (typeof v !== 'string') throw new Error(`ENOENT: ${path}`)
      return v
    }
  }
}

const plistXml = (name: string): string =>
  `<?xml version="1.0"?><plist><dict><key>CFBundleName</key><string>${name}</string></dict></plist>`

describe('darwin 扫描', () => {
  const fs = makeFs({
    '/apps': { 'A.app': 'dir', 'B.App.app': 'dir', Group: 'dir', 'Not.app': 'file-content', '.app': 'dir' },
    '/apps/A.app': { Contents: 'dir' }, // 无 Info.plist → 目录名兜底
    '/apps/B.App.app': { Contents: 'dir' },
    '/apps/B.App.app/Contents': { 'Info.plist': plistXml('Bname') },
    '/apps/Group': { 'Deep.app': 'dir', Nested: 'dir' },
    '/apps/Group/Deep.app': { Contents: 'dir' },
    '/apps/Group/Deep.app/Contents': { 'Info.plist': `<?xml?><plist><dict><key>CFBundleDisplayName</key><string>DeepApp</string></dict></plist>` },
    '/apps/Group/Nested': { 'Deeper.app': 'dir' }, // 深度 3，不扫
    '/apps2': { 'A.app': 'dir' } // 同名不同路径 → 两条都保留
  })

  it('一级/二级 .app 均收录；plist 名优先，读不到回退目录名；文件型 .app 忽略', async () => {
    const apps = await scanDarwin({ platform: 'darwin', homeDir: '/h', env: {}, fs, darwinRoots: ['/apps', '/apps2', '/missing'] })
    expect(apps.map((a) => a.name).sort()).toEqual(['A', 'A', 'Bname', 'DeepApp'])
    expect(apps.find((a) => a.name === 'DeepApp')?.path).toBe('/apps/Group/Deep.app')
    expect(apps.some((a) => a.path.endsWith('Deeper.app'))).toBe(false) // 深度超限
    expect(apps.some((a) => a.name === '')).toBe(false) // '.app' 空名跳过
    expect(apps.some((a) => a.path === '/apps/Not.app')).toBe(false) // 非目录忽略
  })

  it('结果按名排序（同名按路径），不可读根目录视为空', async () => {
    const apps = await scanDarwin({ platform: 'darwin', homeDir: '/h', env: {}, fs, darwinRoots: ['/missing'] })
    expect(apps).toEqual([])
  })

  it('defaultDarwinRoots 含系统与用户 Applications', () => {
    expect(defaultDarwinRoots('/Users/x')).toEqual(['/Applications', '/Users/x/Applications', '/System/Applications'])
  })
})

describe('win32 扫描', () => {
  const fs = makeFs({
    '/programs': { 'a.lnk': 'x', Sub: 'dir' },
    '/programs/Sub': { 'b.LNK': 'x', L1: 'dir' },
    '/programs/Sub/L1': { L2: 'dir' },
    '/programs/Sub/L1/L2': { L3: 'dir' },
    '/programs/Sub/L1/L2/L3': { 'x.lnk': 'x', L4: 'dir' }, // 深度 4 目录内的 lnk 收录
    '/programs/Sub/L1/L2/L3/L4': { 'y.lnk': 'x' } // 深度 5 → 超限不收
  })

  const regStdout = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\code.exe',
    '    (Default)    REG_SZ    C:\\Users\\u\\App\\Code.exe',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\old.exe',
    '    (Default)    REG_EXPAND_SZ    %ProgramFiles%\\old\\old.exe',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\subb.exe',
    '    (Default)    REG_SZ    /programs/SUB/B.LNK', // 与 .lnk 路径小写相同 → 去重
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\novalue.exe',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\dupe.exe',
    '    (Default)    REG_SZ    /programs/a.lnk' // 与 a.lnk 小写相同 → 去重
  ].join('\r\n')

  const deps = (exec?: ScanDeps['exec']): ScanDeps => ({
    platform: 'win32',
    homeDir: '/h',
    env: {},
    fs,
    exec,
    win32Roots: ['/programs']
  })

  it('.lnk 递归收集（大小写扩展名、深度上限 4）+ 注册表 App Paths 合并去重', async () => {
    const apps = await scanWin32(
      deps({
        execFile: async (cmd, args) => {
          if (args.join(' ').includes('HKCU')) throw new Error('access denied') // HKCU 失败被容忍
          expect(cmd).toBe('reg')
          return { stdout: regStdout, stderr: '' }
        }
      })
    )
    const names = apps.map((a) => a.name).sort()
    expect(names).toEqual(['a', 'b', 'code', 'old', 'x']) // y 超深度；subb/dupe 去重
    const code = apps.find((a) => a.name === 'code')
    expect(code?.path).toBe('C:\\Users\\u\\App\\Code.exe')
    const b = apps.find((a) => a.name === 'b')
    expect(b?.path).toBe('/programs/Sub/b.LNK') // 保留首个（.lnk 原始大小写）
  })

  it('无 exec 时只扫开始菜单 .lnk', async () => {
    const apps = await scanWin32(deps())
    expect(apps.map((a) => a.name).sort()).toEqual(['a', 'b', 'x'])
  })

  it('defaultWin32Roots 依赖 APPDATA/PROGRAMDATA，缺失则少根', () => {
    expect(defaultWin32Roots({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming', PROGRAMDATA: 'C:\\ProgramData' })).toEqual([
      'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs',
      'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs'
    ])
    expect(defaultWin32Roots({})).toEqual([])
  })
})

describe('parseRegAppPaths', () => {
  it('键头后第一条 SZ 值为目标路径；无值键跳过；路径去重', () => {
    const out = parseRegAppPaths(
      [
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\one.exe',
        '    (Default)    REG_SZ    C:\\One\\One.exe',
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\two.exe',
        '    (Default)    REG_SZ    c:\\one\\one.exe', // 小写重复 → 去重
        'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\empty.exe' // 无 SZ 值
      ].join('\n')
    )
    expect(out).toEqual([{ name: 'one', path: 'C:\\One\\One.exe' }])
  })

  it('非 App Paths 行与垃圾输入返回空', () => {
    expect(parseRegAppPaths('')).toEqual([])
    expect(parseRegAppPaths('HKEY_LOCAL_MACHINE\\SOFTWARE\\Some\\Other\\Key\r\n    REG_SZ    C:\\x.exe')).toEqual([])
  })
})

describe('scanApps 平台分发', () => {
  it('win32 走开始菜单分支，其余走 darwin 分支', async () => {
    const wfs = makeFs({ '/w': { 'only.lnk': 'x' } })
    const win = await scanApps({ platform: 'win32', homeDir: '/h', env: {}, fs: wfs, win32Roots: ['/w'] })
    expect(win.map((a) => a.name)).toEqual(['only'])

    const mfs = makeFs({ '/m': { 'Only.app': 'dir' } })
    const mac = await scanApps({ platform: 'darwin', homeDir: '/h', env: {}, fs: mfs, darwinRoots: ['/m'] })
    expect(mac.map((a) => a.name)).toEqual(['Only'])
  })
})
