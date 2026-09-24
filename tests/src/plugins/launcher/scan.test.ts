import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appNameFromPlist } from '../../../../src/plugins/launcher/plist-name'
import {
  defaultDarwinRoots,
  defaultWin32Roots,
  parseRegAppPaths,
  scanApps,
  scanDarwin,
  scanWin32
} from '../../../../src/plugins/launcher/scan'
import {
  isCacheStale,
  joinPath,
  parseCache,
  type AppsCache,
  type FsLike,
  type ScanDeps
} from '../../../../src/plugins/launcher/types'

const realFs: FsLike = {
  readdir: (dir) => readdir(dir, { withFileTypes: true }),
  readFile: (path) => readFile(path, { encoding: 'utf-8' })
}

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gtools-launcher-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const mk = (...parts: string[]): Promise<string | undefined> => mkdir(join(dir, ...parts), { recursive: true })
// 末位参数是写入内容，不参与路径拼接
const wf = (...partsAndContent: string[]): Promise<void> => {
  const content = partsAndContent[partsAndContent.length - 1]
  const parts = partsAndContent.slice(0, -1)
  return writeFile(join(dir, ...parts), content)
}

function plistXml(name: string, display?: string): string {
  const displayTag = display ? `<key>CFBundleDisplayName</key><string>${display}</string>` : ''
  return `<?xml version="1.0"?><plist><dict><key>CFBundleName</key><string>${name}</string>${displayTag}</dict></plist>`
}

describe('darwin 扫描', () => {
  it('扫 .app（plist 名优先、目录名兜底、深度 2 嵌套），忽略非 .app', async () => {
    await mk('Applications', 'Safari.app', 'Contents')
    await wf('Applications', 'Safari.app', 'Contents', 'Info.plist', plistXml('Safari'))
    await mk('Applications', 'WeChat.app', 'Contents')
    await wf('Applications', 'WeChat.app', 'Contents', 'Info.plist', plistXml('WeChat', '微信'))
    await mk('Applications', 'NoPlist.app')
    await mk('Applications', 'Utilities')
    await mk('Applications', 'Utilities', 'Terminal.app', 'Contents')
    await wf('Applications', 'Utilities', 'Terminal.app', 'Contents', 'Info.plist', plistXml('Terminal'))
    await wf('Applications', 'readme.txt', 'not an app')
    await mk('HomeApps', 'Extra.app')

    const apps = await scanDarwin({
      platform: 'darwin',
      homeDir: dir,
      env: {},
      fs: realFs,
      darwinRoots: [join(dir, 'Applications'), join(dir, 'HomeApps')]
    })

    expect(apps.map((a) => a.name).sort()).toEqual(['Extra', 'NoPlist', 'Safari', 'Terminal', '微信'])
    const wechat = apps.find((a) => a.path.endsWith('WeChat.app'))
    expect(wechat?.name).toBe('微信') // CFBundleDisplayName 优先于 CFBundleName
    expect(apps.every((a) => a.path.endsWith('.app'))).toBe(true)
  })

  it('二进制 plist 回退目录名', async () => {
    await mk('Applications', 'Bin.app', 'Contents')
    await wf('Applications', 'Bin.app', 'Contents', 'Info.plist', 'bplist00xxxx')
    const apps = await scanDarwin({
      platform: 'darwin',
      homeDir: dir,
      env: {},
      fs: realFs,
      darwinRoots: [join(dir, 'Applications')]
    })
    expect(apps).toEqual([{ name: 'Bin', path: joinPath(join(dir, 'Applications'), 'Bin.app') }])
  })

  it('根目录不存在返回空数组不抛异常；重复根不重复收录', async () => {
    const root = join(dir, 'Applications')
    await mk('Applications', 'A.app')
    const deps: ScanDeps = {
      platform: 'darwin',
      homeDir: dir,
      env: {},
      fs: realFs,
      darwinRoots: [root, root, join(dir, 'NotExist')]
    }
    const apps = await scanDarwin(deps)
    expect(apps).toHaveLength(1)
  })

  it('默认根含 /Applications、~/Applications 与 /System/Applications', () => {
    expect(defaultDarwinRoots('/Users/u')).toEqual(['/Applications', '/Users/u/Applications', '/System/Applications'])
  })
})

describe('win32 扫描（本机为 macOS，真机行为未实测）', () => {
  it('递归收开始菜单 .lnk，名称去扩展名，忽略其他文件', async () => {
    await mk('Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs')
    await wf('Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Chrome.lnk', '')
    await mk('AllUsers', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Sub')
    await wf('AllUsers', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Sub', 'Edge.lnk', '')
    await wf('AllUsers', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'readme.txt', '')

    const apps = await scanWin32({
      platform: 'win32',
      homeDir: dir,
      env: { APPDATA: join(dir, 'Roaming'), PROGRAMDATA: join(dir, 'AllUsers') },
      fs: realFs
    })

    expect(apps.map((a) => a.name).sort()).toEqual(['Chrome', 'Edge'])
    expect(apps.every((a) => a.path.toLowerCase().endsWith('.lnk'))).toBe(true)
  })

  it('注册表 App Paths 输出解析：取键后首条 SZ 值，无值跳过', () => {
    const stdout = [
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      '    (Default)    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      '    Path    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application',
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\code.exe',
      '    (默认)    REG_SZ    C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
      '',
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\novalue.exe',
      '    (Default)    REG_SZ    ',
      ''
    ].join('\r\n')

    expect(parseRegAppPaths(stdout)).toEqual([
      { name: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
      { name: 'code', path: 'C:\\Users\\u\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe' }
    ])
  })

  it('注册表与 .lnk 同名应用按名称统一去重（.lnk 优先），注册表独有应用保留；reg 失败仅保留 .lnk', async () => {
    const regStdout =
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\foo.exe\r\n' +
      '    (Default)    REG_SZ    C:\\Apps\\Foo\\foo.exe\r\n' +
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\only.exe\r\n' +
      '    (Default)    REG_SZ    C:\\Apps\\Only\\only.exe\r\n'
    const base: ScanDeps = {
      platform: 'win32',
      homeDir: dir,
      env: {},
      fs: realFs,
      win32Roots: [join(dir, 'Programs')]
    }
    await mk('Programs')
    await wf('Programs', 'Foo.lnk', '')

    const ok = await scanWin32({
      ...base,
      exec: { execFile: async () => ({ stdout: regStdout, stderr: '' }) }
    })
    expect(ok).toHaveLength(2)
    expect(ok.map((a) => a.name).sort()).toEqual(['Foo', 'only'])
    expect(ok.find((a) => a.name === 'Foo')?.path.toLowerCase().endsWith('.lnk')).toBe(true)

    const failing = await scanWin32({
      ...base,
      exec: { execFile: async () => { throw new Error('reg 不可用') } }
    })
    expect(failing.map((a) => a.name)).toEqual(['Foo'])
  })

  it('用户/全局开始菜单的同名 .lnk 只保留先扫到的（用户级优先）', async () => {
    await mk('Roaming', 'Programs')
    await mk('AllUsers', 'Programs')
    await wf('Roaming', 'Programs', 'App.lnk', '')
    await wf('AllUsers', 'Programs', 'App.lnk', '')
    const apps = await scanWin32({
      platform: 'win32',
      homeDir: dir,
      env: {},
      fs: realFs,
      win32Roots: [join(dir, 'Roaming', 'Programs'), join(dir, 'AllUsers', 'Programs')]
    })
    expect(apps).toHaveLength(1)
    expect(apps[0]?.path.startsWith(join(dir, 'Roaming'))).toBe(true)
  })

  it('默认根由 APPDATA/PROGRAMDATA 推导', () => {
    expect(defaultWin32Roots({ APPDATA: 'C:\\Users\\u\\AppData\\Roaming', PROGRAMDATA: 'C:\\ProgramData' })).toEqual([
      'C:\\Users\\u\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs',
      'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs'
    ])
    expect(defaultWin32Roots({})).toEqual([])
  })
})

describe('平台分派与缓存工具', () => {
  it('scanApps 按 platform 分派', async () => {
    const deps: ScanDeps = { platform: 'win32', homeDir: dir, env: {}, fs: realFs, win32Roots: [join(dir, 'none')] }
    await expect(scanApps(deps)).resolves.toEqual([])
    const darwin = await scanApps({ ...deps, platform: 'darwin', darwinRoots: [join(dir, 'none2')] })
    expect(darwin).toEqual([])
  })

  it('joinPath 按首段分隔符拼接、忽略空段与尾斜杠', () => {
    expect(joinPath('/Applications', 'Safari.app')).toBe('/Applications/Safari.app')
    expect(joinPath('/Applications/', 'Safari.app')).toBe('/Applications/Safari.app')
    expect(joinPath('C:\\ProgramData', 'Microsoft', 'a.lnk')).toBe('C:\\ProgramData\\Microsoft\\a.lnk')
    expect(joinPath('', 'x')).toBe('x')
  })

  it('parseCache 校验形状，坏数据返回 null', () => {
    const good: AppsCache = { version: 1, scannedAt: 123, apps: [{ name: 'A', path: '/a' }] }
    expect(parseCache(good)).toEqual(good)
    expect(parseCache(null)).toBeNull()
    expect(parseCache({ version: 2, scannedAt: 1, apps: [] })).toBeNull()
    expect(parseCache({ version: 1, scannedAt: 'x', apps: [] })).toBeNull()
    expect(parseCache({ version: 1, scannedAt: 1, apps: [{ name: '', path: '/a' }, { name: 'B', path: '/b' }] })?.apps).toEqual([
      { name: 'B', path: '/b' }
    ])
  })

  it('isCacheStale：缺缓存即过期，24h 阈值', () => {
    expect(isCacheStale(null, 0)).toBe(true)
    expect(isCacheStale({ version: 1, scannedAt: 1000, apps: [] }, 1000 + 24 * 3600 * 1000 + 1)).toBe(true)
    expect(isCacheStale({ version: 1, scannedAt: 1000, apps: [] }, 1000 + 24 * 3600 * 1000 - 1)).toBe(false)
  })
})

describe('plist 名提取', () => {
  it('XML 实体解码与空白容忍', () => {
    expect(appNameFromPlist('<plist><key>CFBundleName</key>\n <string> A&amp;B </string></plist>')).toBe('A&B')
    expect(appNameFromPlist('<plist><key>CFBundleName</key><string></string></plist>')).toBeNull()
    expect(appNameFromPlist('<plist></plist>')).toBeNull()
  })
})
