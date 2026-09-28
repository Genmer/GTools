import { describe, expect, it, vi } from 'vitest'
import { syncLoginItem, type LoginItemApp } from '../src/main/login-item'

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
    expect(syncLoginItem(app, true)).toBe('noop')
    expect(app.set).not.toHaveBeenCalled()
  })

  it('状态不一致时写入目标值', () => {
    const app = fakeApp()
    expect(syncLoginItem(app, true)).toBe('applied')
    expect(app.set).toHaveBeenCalledWith({ openAtLogin: true })
  })

  it('OS 写入异常原样向上抛，由调用方决定呈现', () => {
    const app = fakeApp({ setLoginItemSettings: () => { throw new Error('registry denied') } })
    expect(() => syncLoginItem(app, true)).toThrow('registry denied')
  })
})
