import { describe, expect, it, vi } from 'vitest'
import {
  computeLoginItemFingerprint,
  readLoginItemFingerprint,
  syncLoginItem,
  syncLoginItemWithFingerprint,
  syncMacLoginItem,
  writeLoginItemFingerprint,
  type LoginItemApp,
  type LoginItemReadFileFn,
  type LoginItemStatFn
} from '../src/main/login-item'

const FAKE_VERSION = '0.0.66'

function fakeApp(over: Partial<LoginItemApp> = {}): LoginItemApp & { set: ReturnType<typeof vi.fn> } {
  const set = vi.fn()
  return {
    isPackaged: true,
    getVersion: () => FAKE_VERSION,
    getLoginItemSettings: () => ({ openAtLogin: false }),
    setLoginItemSettings: set,
    ...over,
    set
  }
}

/** 状态化 fake：setLoginItemSettings 写入后 getLoginItemSettings 立即可见（模拟 Electron 轨写后回读生效） */
function trackingApp(initial: boolean): LoginItemApp & { set: ReturnType<typeof vi.fn> } {
  let openAtLogin = initial
  const set = vi.fn((s: { openAtLogin: boolean }) => {
    openAtLogin = s.openAtLogin
  })
  return {
    isPackaged: true,
    getVersion: () => FAKE_VERSION,
    getLoginItemSettings: () => ({ openAtLogin }),
    setLoginItemSettings: set,
    set
  }
}

describe('syncLoginItem', () => {
  it('未打包一律跳过，不读不写 OS 登录项', () => {
    const app = fakeApp({ isPackaged: false, getLoginItemSettings: vi.fn() })
    expect(syncLoginItem(app, true)).toBe('skipped-dev')
    expect(app.getLoginItemSettings).not.toHaveBeenCalled()
    expect(app.set).not.toHaveBeenCalled()
  })

  it('OS 态已一致时 no-op，不重复写注册表/SMAppService', () => {
    const app = fakeApp({ getLoginItemSettings: () => ({ openAtLogin: true }) })
    expect(syncLoginItem(app, true, { platform: 'win32' })).toBe('noop')
    expect(app.set).not.toHaveBeenCalled()
  })

  it('状态不一致时写入目标值', () => {
    const app = fakeApp()
    expect(syncLoginItem(app, true, { platform: 'win32' })).toBe('applied')
    expect(app.set).toHaveBeenCalledWith({ openAtLogin: true })
  })

  it('OS 写入异常原样向上抛，由调用方决定呈现', () => {
    const app = fakeApp({ setLoginItemSettings: () => { throw new Error('registry denied') } })
    expect(() => syncLoginItem(app, true, { platform: 'win32' })).toThrow('registry denied')
  })

  it('win32 不碰 System Events 兜底轨（runner 不被调用）', () => {
    const app = fakeApp()
    const runner = vi.fn().mockReturnValue('applied\n')
    expect(syncLoginItem(app, true, { platform: 'win32', runner })).toBe('applied')
    expect(runner).not.toHaveBeenCalled()
  })

  it('darwin Electron 轨写后回读已生效 → System Events 兜底轨不跑，防双登录项', () => {
    const app = trackingApp(false) // 轨前不一致 → 写入 → 回读生效
    const runner = vi.fn().mockReturnValue('applied\n')
    const r = syncLoginItem(app, true, {
      platform: 'darwin',
      bundlePath: '/Applications/GTools.app',
      runner
    })
    expect(r).toBe('applied')
    expect(runner).not.toHaveBeenCalled()
  })

  it('darwin 建项方向本来就一致（noop）→ 回读一致同样不跑 System Events，返回 noop', () => {
    const app = fakeApp({ getLoginItemSettings: () => ({ openAtLogin: true }) })
    const runner = vi.fn().mockReturnValue('applied\n')
    const r = syncLoginItem(app, true, {
      platform: 'darwin',
      bundlePath: '/Applications/GTools.app',
      runner
    })
    expect(r).toBe('noop')
    expect(runner).not.toHaveBeenCalled()
  })

  it('darwin Electron 轨回读未生效（未签名 app 静默失败面）→ System Events 兜底轨跑并 applied', () => {
    const app = fakeApp() // getLoginItemSettings 恒 false：写入后回读仍不一致
    const runner = vi.fn().mockReturnValue('applied\n')
    const r = syncLoginItem(app, true, {
      platform: 'darwin',
      bundlePath: '/Applications/GTools.app',
      runner
    })
    expect(r).toBe('applied')
    expect(runner).toHaveBeenCalledWith('osascript', expect.arrayContaining(['-e', expect.stringContaining('/Applications/GTools.app')]), expect.any(Object))
  })

  it('darwin 关闭方向：Electron 轨回读未生效 → System Events 兜底轨同样跑', () => {
    const app = fakeApp({ getLoginItemSettings: () => ({ openAtLogin: true }) }) // 恒 true：写入 false 后回读仍未生效
    const runner = vi.fn().mockReturnValue('applied\n')
    const r = syncLoginItem(app, false, {
      platform: 'darwin',
      bundlePath: '/Applications/GTools.app',
      runner
    })
    expect(r).toBe('applied')
    expect(runner).toHaveBeenCalledTimes(1)
    const script = runner.mock.calls[0][1][1] as string
    expect(script).toContain('if false then')
  })

  it('darwin 关闭方向：回读已一致（SMAppService 无注册面）→ System Events 清理仍无条件跑，防兜底轨旧项残留', () => {
    const app = fakeApp() // getLoginItemSettings 恒 false：want=false 时 Electron 轨一致（noop）
    const runner = vi.fn().mockReturnValue('applied\n')
    const r = syncLoginItem(app, false, {
      platform: 'darwin',
      bundlePath: '/Applications/GTools.app',
      runner
    })
    expect(r).toBe('applied')
    expect(runner).toHaveBeenCalledTimes(1)
    const script = runner.mock.calls[0][1][1] as string
    expect(script).toContain('if false then') // 关闭双删分支
  })

  it('darwin 兜底轨 runner 异常向上抛出', () => {
    const app = fakeApp()
    const runner = vi.fn().mockImplementation(() => { throw new Error('osascript failed') })
    expect(() => syncLoginItem(app, true, {
      platform: 'darwin',
      bundlePath: '/Applications/GTools.app',
      runner
    })).toThrow('osascript failed')
  })
})

describe('syncMacLoginItem', () => {
  it('正确转义路径中的双引号', () => {
    const runner = vi.fn().mockReturnValue('applied')
    syncMacLoginItem('/Applications/My "App".app', true, runner)
    const script = runner.mock.calls[0][1][1] as string
    expect(script).toContain('/Applications/My \\"App\\".app')
  })

  it('want=true：同 path 项缺失时 make 前先删同名残留（清同名异路径旧项）', () => {
    const runner = vi.fn().mockReturnValue('applied')
    syncMacLoginItem('/Applications/GTools.app', true, runner)
    const script = runner.mock.calls[0][1][1] as string
    const delIdx = script.indexOf('delete (every login item whose name is itemName)')
    const makeIdx = script.indexOf('make new login item')
    expect(delIdx).toBeGreaterThan(-1)
    expect(makeIdx).toBeGreaterThan(delIdx)
    // 删+建仍被 hasItem 门控（or false 与 not hasItem 恒等）：同 path 项已存在 → noop 不动
    expect(script.indexOf('if not hasItem or false then')).toBeLessThan(delIdx)
  })

  it('want=false：保持按 path 与按 name 双删', () => {
    const runner = vi.fn().mockReturnValue('applied')
    syncMacLoginItem('/Applications/GTools.app', false, runner)
    const script = runner.mock.calls[0][1][1] as string
    expect(script).toContain('delete (every login item whose path is itemPath)')
    expect(script.indexOf('delete (every login item whose name is itemName)')).toBeGreaterThan(-1)
  })

  it('want=false：force=true 不波及删除方向（force 只在被 if false 关死的建项分支里，仍双删）', () => {
    const runner = vi.fn().mockReturnValue('applied')
    expect(syncMacLoginItem('/Applications/GTools.app', false, runner, true)).toBe('applied')
    const script = runner.mock.calls[0][1][1] as string
    expect(script).toContain('if false then') // 外层门选中删除分支，建项分支整段关死
    // 删除方向子脚本以其独有条件语句为锚：force 不得渗入其中
    const delCond = 'if hasItem or ((count of (every login item whose name is itemName)) > 0) then'
    const deleteDir = script.slice(script.indexOf(delCond))
    expect(deleteDir).not.toContain('or true')
    expect(deleteDir).toContain('delete (every login item whose path is itemPath)')
    expect(deleteDir.indexOf('delete (every login item whose name is itemName)')).toBeGreaterThan(-1)
  })

  it('force=true：want=true 门控变 or true，hasItem 时仍走删+建并返回 applied', () => {
    const runner = vi.fn().mockReturnValue('applied')
    expect(syncMacLoginItem('/Applications/GTools.app', true, runner, true)).toBe('applied')
    const script = runner.mock.calls[0][1][1] as string
    expect(script).toContain('if not hasItem or true then')
    const delIdx = script.indexOf('delete (every login item whose name is itemName)')
    const makeIdx = script.indexOf('make new login item')
    expect(delIdx).toBeGreaterThan(-1)
    expect(makeIdx).toBeGreaterThan(delIdx)
  })
})

describe('computeLoginItemFingerprint', () => {
  it('格式为 版本|size|mtimeMs，stat 取可执行文件路径', () => {
    const stat: LoginItemStatFn = vi.fn(() => ({ size: 123, mtimeMs: 456.7 }))
    const fp = computeLoginItemFingerprint({ getVersion: () => FAKE_VERSION }, '/opt/GTools.app/Contents/MacOS/GTools', stat)
    expect(fp).toBe(`${FAKE_VERSION}|123|456.7`)
    expect(stat).toHaveBeenCalledWith('/opt/GTools.app/Contents/MacOS/GTools')
  })

  it('stat 异常原样上抛（调用方 try/catch 已接）', () => {
    const stat = vi.fn(() => { throw new Error('enoent') })
    expect(() => computeLoginItemFingerprint({ getVersion: () => FAKE_VERSION }, '/x', stat)).toThrow('enoent')
  })
})

describe('readLoginItemFingerprint', () => {
  it('文件不存在（readFile 抛错）→ null 不抛', () => {
    const readFile: LoginItemReadFileFn = vi.fn(() => { throw new Error('ENOENT') })
    expect(readLoginItemFingerprint('/tmp/login-item.json', readFile)).toBeNull()
  })

  it('非 JSON 内容 → null', () => {
    const readFile: LoginItemReadFileFn = vi.fn(() => 'not json{{{')
    expect(readLoginItemFingerprint('/tmp/login-item.json', readFile)).toBeNull()
  })

  it('fingerprint 字段非 string → null', () => {
    const readFile: LoginItemReadFileFn = vi.fn(() => '{"fingerprint":123}')
    expect(readLoginItemFingerprint('/tmp/login-item.json', readFile)).toBeNull()
  })

  it('顶层非对象（null/数组/字符串）→ null', () => {
    for (const raw of ['null', '[]', '"0.0.66|1|2"']) {
      const readFile: LoginItemReadFileFn = vi.fn(() => raw)
      expect(readLoginItemFingerprint('/tmp/login-item.json', readFile)).toBeNull()
    }
  })

  it('正常文件 → 返回指纹字符串', () => {
    const readFile: LoginItemReadFileFn = vi.fn(() => '{"fingerprint":"0.0.66|1|2"}')
    expect(readLoginItemFingerprint('/tmp/login-item.json', readFile)).toBe('0.0.66|1|2')
  })
})

describe('writeLoginItemFingerprint', () => {
  it('写入 { fingerprint: ... } JSON', () => {
    const writeFile = vi.fn()
    writeLoginItemFingerprint('/tmp/login-item.json', '0.0.66|1|2', writeFile)
    expect(writeFile).toHaveBeenCalledWith('/tmp/login-item.json', expect.any(String))
    const written = writeFile.mock.calls[0][1] as string
    expect(JSON.parse(written)).toEqual({ fingerprint: '0.0.66|1|2' })
  })

  it('写失败原样上抛', () => {
    const writeFile = vi.fn(() => { throw new Error('disk full') })
    expect(() => writeLoginItemFingerprint('/tmp/login-item.json', 'fp', writeFile)).toThrow('disk full')
  })
})

describe('syncLoginItemWithFingerprint', () => {
  const FILE = '/tmp/login-item.json'

  function deps(prev: string | null) {
    return {
      runner: vi.fn().mockReturnValue('applied\n'),
      stat: vi.fn(() => ({ size: 42, mtimeMs: 7 })),
      readFile: vi.fn(() => {
        if (prev === null) throw new Error('ENOENT')
        return JSON.stringify({ fingerprint: prev })
      }),
      writeFile: vi.fn()
    }
  }

  const CURRENT_FP = `${FAKE_VERSION}|42|7`

  it('指纹变化（含首次无文件）→ 先清同名旧项，再 forceRefresh 建 System Events 轨，并落新指纹', () => {
    for (const prev of [null, '0.0.65|40|9']) {
      const d = deps(prev)
      const app = fakeApp() // Electron 轨回读恒未生效 → System Events 轨必跑
      const r = syncLoginItemWithFingerprint(app, true, FILE, { platform: 'darwin', bundlePath: '/Applications/GTools.app', ...d })
      expect(r).toBe('applied')
      expect(d.runner).toHaveBeenCalledTimes(2)
      expect(d.runner.mock.calls[0][1][1]).toContain('if false then') // 第一跳：清理（want=false 形态）
      expect(d.runner.mock.calls[1][1][1]).toContain('if not hasItem or true then') // 第二跳：强制建项
      expect(d.writeFile).toHaveBeenCalledWith(FILE, expect.any(String))
      expect(JSON.parse(d.writeFile.mock.calls[0][1] as string).fingerprint).toBe(CURRENT_FP)
    }
  })

  it('指纹相同 → 不强制刷新（or false 门控），指纹照写维持基准', () => {
    const d = deps(CURRENT_FP)
    const app = fakeApp()
    const r = syncLoginItemWithFingerprint(app, true, FILE, { platform: 'darwin', bundlePath: '/Applications/GTools.app', ...d })
    expect(r).toBe('applied')
    expect(d.runner.mock.calls[0][1][1]).toContain('if not hasItem or false then')
    expect(d.writeFile).toHaveBeenCalledTimes(1)
  })

  it('want=false：纯删除路径不读不写指纹', () => {
    const d = deps(CURRENT_FP)
    const app = fakeApp({ getLoginItemSettings: () => ({ openAtLogin: true }) })
    const r = syncLoginItemWithFingerprint(app, false, FILE, { platform: 'darwin', bundlePath: '/Applications/GTools.app', ...d })
    expect(r).toBe('applied')
    expect(d.readFile).not.toHaveBeenCalled()
    expect(d.writeFile).not.toHaveBeenCalled()
    expect(d.runner).toHaveBeenCalledTimes(1)
  })

  it('未打包 skipped-dev → 不写指纹', () => {
    const d = deps(CURRENT_FP)
    const app = fakeApp({ isPackaged: false })
    expect(syncLoginItemWithFingerprint(app, true, FILE, d)).toBe('skipped-dev')
    expect(d.runner).not.toHaveBeenCalled()
    expect(d.writeFile).not.toHaveBeenCalled()
  })

  it('Electron 轨回读生效（签名后常态）→ System Events 不跑，但仍写指纹', () => {
    const d = deps(CURRENT_FP)
    const app = trackingApp(false) // 写入后回读立即生效 → 择一门槛短路
    const r = syncLoginItemWithFingerprint(app, true, FILE, { platform: 'darwin', bundlePath: '/Applications/GTools.app', ...d })
    expect(r).toBe('applied')
    expect(d.runner).not.toHaveBeenCalled()
    expect(JSON.parse(d.writeFile.mock.calls[0][1] as string).fingerprint).toBe(CURRENT_FP)
  })

  it('指纹变化（forceRefresh=true）+ Electron 轨回读生效 → 只跑一跳 System Events 清理，择一短路仍优先不建项（防双登录项），指纹照写', () => {
    const d = deps(null) // 无历史指纹 → prev !== fp → forceRefresh=true
    const app = trackingApp(false)
    const r = syncLoginItemWithFingerprint(app, true, FILE, { platform: 'darwin', bundlePath: '/Applications/GTools.app', ...d })
    expect(r).toBe('applied')
    expect(d.runner).toHaveBeenCalledTimes(1)
    expect(d.runner.mock.calls[0][1][1]).toContain('if false then')
    expect(JSON.parse(d.writeFile.mock.calls[0][1] as string).fingerprint).toBe(CURRENT_FP)
  })

  it('指纹变化 + Electron 轨回读恒 true（ad-hoc 更新后失效态）→ 清理 + off→on 重注册刷新 SMAppService 项，短路仍生效不建 System Events 项', () => {
    const d = deps(null)
    const app = fakeApp({ getLoginItemSettings: () => ({ openAtLogin: true }) })
    const r = syncLoginItemWithFingerprint(app, true, FILE, { platform: 'darwin', bundlePath: '/Applications/GTools.app', ...d })
    expect(r).toBe('applied')
    expect(app.set.mock.calls.map((c) => c[0].openAtLogin)).toEqual([false, true])
    expect(d.runner).toHaveBeenCalledTimes(1)
    expect(d.runner.mock.calls[0][1][1]).toContain('if false then')
    expect(d.writeFile).toHaveBeenCalledTimes(1)
  })

  it('指纹变化 + 重注册后回读仍 false（未签名 register 被拒）→ 强刷替代常规写入（只 off→on，不先 set(true)，防双通知），再走 System Events 强制建项', () => {
    const d = deps(null)
    const app = fakeApp() // 回读恒 false
    const r = syncLoginItemWithFingerprint(app, true, FILE, { platform: 'darwin', bundlePath: '/Applications/GTools.app', ...d })
    expect(r).toBe('applied')
    expect(app.set.mock.calls.map((c) => c[0].openAtLogin)).toEqual([false, true])
    expect(d.runner).toHaveBeenCalledTimes(2)
    expect(d.runner.mock.calls[0][1][1]).toContain('if false then')
    expect(d.runner.mock.calls[1][1][1]).toContain('if not hasItem or true then')
  })

  it('指纹相同（forceRefresh=false）→ 不做 off→on 重注册，Electron 轨只按回读差异写一次', () => {
    const d = deps(CURRENT_FP)
    const app = fakeApp()
    syncLoginItemWithFingerprint(app, true, FILE, { platform: 'darwin', bundlePath: '/Applications/GTools.app', ...d })
    expect(app.set.mock.calls.map((c) => c[0].openAtLogin)).toEqual([true])
  })

  it('stat 抛错 → 异常原样上抛，OS 未写、指纹文件未读写（index/ipc 的 try/catch 契约面）', () => {
    const d = { ...deps(CURRENT_FP), stat: vi.fn(() => { throw new Error('stat boom') }) }
    const app = fakeApp()
    expect(() => syncLoginItemWithFingerprint(app, true, FILE, { platform: 'darwin', bundlePath: '/Applications/GTools.app', ...d })).toThrow('stat boom')
    expect(app.set).not.toHaveBeenCalled()
    expect(d.runner).not.toHaveBeenCalled()
    expect(d.readFile).not.toHaveBeenCalled()
    expect(d.writeFile).not.toHaveBeenCalled()
  })
})
