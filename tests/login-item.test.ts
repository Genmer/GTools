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

  it('macOS bundle 存在且 System Events 新增项时返回 applied', () => {
    const app = fakeApp({ getLoginItemSettings: () => ({ openAtLogin: true }) })
    const runner = vi.fn().mockReturnValue('applied\n')
    const r = syncLoginItem(app, true, {
      platform: 'darwin',
      bundlePath: '/Applications/GTools.app',
      runner
    })
    expect(r).toBe('applied')
    expect(runner).toHaveBeenCalledWith('osascript', expect.arrayContaining(['-e', expect.stringContaining('/Applications/GTools.app')]), expect.any(Object))
  })

  it('macOS bundle 存在且两端均一致时返回 noop', () => {
    const app = fakeApp({ getLoginItemSettings: () => ({ openAtLogin: true }) })
    const runner = vi.fn().mockReturnValue('noop\n')
    const r = syncLoginItem(app, true, {
      platform: 'darwin',
      bundlePath: '/Applications/GTools.app',
      runner
    })
    expect(r).toBe('noop')
  })

  it('macOS runner 异常向上抛出', () => {
    const app = fakeApp({ getLoginItemSettings: () => ({ openAtLogin: true }) })
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
})
