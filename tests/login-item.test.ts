import { describe, expect, it, vi } from 'vitest'
import { syncLoginItem, syncMacLoginItem, type LoginItemApp } from '../src/main/login-item'

function fakeApp(over: Partial<LoginItemApp> = {}): LoginItemApp & { set: ReturnType<typeof vi.fn> } {
  const set = vi.fn()
  return {
    isPackaged: true,
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
    // 删+建仍被 if not hasItem 门控：同 path 项已存在 → noop 不动
    expect(script.indexOf('if not hasItem then')).toBeLessThan(delIdx)
  })

  it('want=false：保持按 path 与按 name 双删', () => {
    const runner = vi.fn().mockReturnValue('applied')
    syncMacLoginItem('/Applications/GTools.app', false, runner)
    const script = runner.mock.calls[0][1][1] as string
    expect(script).toContain('delete (every login item whose path is itemPath)')
    expect(script.indexOf('delete (every login item whose name is itemName)')).toBeGreaterThan(-1)
  })
})
