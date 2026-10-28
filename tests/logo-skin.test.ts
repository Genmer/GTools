import { tmpdir } from 'node:os'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dock = vi.hoisted(() => ({ setIcon: vi.fn() }))
const winState = vi.hoisted(() => ({ windows: [] as Array<{ setIcon: ReturnType<typeof vi.fn>; isDestroyed: () => boolean }> }))
const imageState = vi.hoisted(() => ({ empty: false }))
const appState = vi.hoisted(() => ({ isPackaged: false }))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return appState.isPackaged
    },
    getAppPath: vi.fn(() => '/fakeapp'),
    dock
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => imageState.empty }))
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => winState.windows)
  }
}))

import { applyAppLogoSkin, applyMacBundleIcon, logoIconPath, resolveAppBundlePath } from '../src/main/logo-skin'

function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

beforeEach(() => {
  dock.setIcon.mockClear()
  winState.windows = []
  imageState.empty = false
  appState.isPackaged = false
  setPlatform('darwin')
})

describe('logo-skin：运行时 logo 底色应用', () => {
  it('darwin 写 Dock 图标，路径随底色切 black/white', () => {
    applyAppLogoSkin('white')
    expect(String(dock.setIcon.mock.calls[0]?.[0]).replace(/\\/g, '/')).toContain('logo-')
    applyAppLogoSkin('black')
    expect(String(dock.setIcon.mock.lastCall?.[0]).replace(/\\/g, '/')).toBe('/fakeapp/resources/logo-black.png')
  })

  it('win32 改所有存活窗口图标，不动 Dock', () => {
    setPlatform('win32')
    const live = { setIcon: vi.fn(), isDestroyed: () => false }
    const dead = { setIcon: vi.fn(), isDestroyed: () => true }
    winState.windows = [live, dead]
    applyAppLogoSkin('white')
    expect(String(live.setIcon.mock.calls[0]?.[0]).replace(/\\/g, '/')).toContain('logo-')
    expect(dead.setIcon).not.toHaveBeenCalled()
    expect(dock.setIcon).not.toHaveBeenCalled()
  })

  it('资产缺失（nativeImage 为空）时 no-op，不写 Dock 也不动窗口', () => {
    imageState.empty = true
    const live = { setIcon: vi.fn(), isDestroyed: () => false }
    winState.windows = [live]
    applyAppLogoSkin('white')
    expect(dock.setIcon).not.toHaveBeenCalled()
    expect(live.setIcon).not.toHaveBeenCalled()
    expect(logoIconPath()).toBeNull()
  })

  it('logoIconPath：资产在时返回当前底色路径（建窗 icon 参数用）', () => {
    applyAppLogoSkin('white')
    expect((logoIconPath() ?? '').replace(/\\/g, '/')).toBe('/fakeapp/resources/logo-white.png')
  })

  it('resolveAppBundlePath：非 darwin 返回 null，darwin 打包态从 process.execPath 反推', () => {
    setPlatform('win32')
    expect(resolveAppBundlePath()).toBeNull()

    setPlatform('darwin')
    appState.isPackaged = true
    const origExec = process.execPath
    Object.defineProperty(process, 'execPath', { value: '/Applications/CustomApp.app/Contents/MacOS/CustomApp', configurable: true })
    expect(resolveAppBundlePath()).toBe('/Applications/CustomApp.app')
    Object.defineProperty(process, 'execPath', { value: origExec, configurable: true })
  })

  it('applyMacBundleIcon：非 darwin 平台直接返回 false', async () => {
    setPlatform('win32')
    const runner = vi.fn()
    const r = await applyMacBundleIcon('white', { runner })
    expect(r).toBe(false)
    expect(runner).not.toHaveBeenCalled()
  })

  it('applyMacBundleIcon：不存在的 bundle 路径返回 false', async () => {
    const runner = vi.fn()
    const r = await applyMacBundleIcon('white', { targetBundle: '/non/existent/path.app', runner })
    expect(r).toBe(false)
    expect(runner).not.toHaveBeenCalled()
  })

  it('applyMacBundleIcon：white 态执行带图标路径脚本，black 态传 $.nil 清除图标', async () => {
    // 指向真实存在的目录作为 mock bundle（tmpdir 跨平台，Windows runner 无 /tmp）
    const mockBundle = tmpdir()
    const calls: Array<{ file: string; args: string[] }> = []
    const runner = vi.fn(async (file: string, args: string[]) => {
      calls.push({ file, args })
      return { stdout: 'true\n', stderr: '' }
    })

    const rWhite = await applyMacBundleIcon('white', { targetBundle: mockBundle, runner })
    expect(rWhite).toBe(true)
    expect(calls[0].file).toBe('osascript')
    expect(calls[0].args[3]).toContain('initWithContentsOfFile')
    // bundlePath 经 JSON.stringify 进脚本：Windows 路径反斜杠被转义，须按转义后形态断言
    expect(calls[0].args[3]).toContain(JSON.stringify(mockBundle).slice(1, -1))

    const rBlack = await applyMacBundleIcon('black', { targetBundle: mockBundle, runner })
    expect(rBlack).toBe(true)
    expect(calls[1].args[3]).toContain('const img = $.nil;')

    // runner 异常时优雅回退 false
    const failRunner = vi.fn(async () => {
      throw new Error('osascript failure')
    })
    const rFail = await applyMacBundleIcon('white', { targetBundle: mockBundle, runner: failRunner })
    expect(rFail).toBe(false)
  })
})
