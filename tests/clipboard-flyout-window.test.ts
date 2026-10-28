import { beforeEach, describe, expect, it, vi } from 'vitest'

// 飞窗模块直接 import electron（编排层例外），node 测试全 mock；window.ts 同理
const fakeFlyout = vi.hoisted(() => ({
  win: null as null | {
    isDestroyed: ReturnType<typeof vi.fn>
    setAlwaysOnTop: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    loadURL: ReturnType<typeof vi.fn>
    loadFile: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    setBounds: ReturnType<typeof vi.fn>
    getBounds: ReturnType<typeof vi.fn>
    showInactive: ReturnType<typeof vi.fn>
    moveTop: ReturnType<typeof vi.fn>
    webContents: { id: number; send: ReturnType<typeof vi.fn> }
  }
}))

vi.mock('electron', () => ({
  // 非 function 实现过不了 new：普通函数返回对象即替换构造实例
  BrowserWindow: vi.fn(function () {
    return fakeFlyout.win
  }),
  screen: { getDisplayMatching: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } })) }
}))

vi.mock('../src/main/window', () => ({
  currentVisualState: vi.fn(() => ({
    theme: 'dark' as const,
    tx: { enabled: false, opacity: 100, blur: false, glassFrost: 45 },
    transparent: false
  })),
  applyThemeToBrowserWindow: vi.fn(),
  bindDetachedMarginSync: vi.fn(),
  bindTransparentFlagSync: vi.fn(),
  secureWebContents: vi.fn(),
  getSearchWindow: vi.fn(() => null),
  allLiveWindows: vi.fn(() => []),
  markTransparentWindow: vi.fn()
}))

import { BrowserWindow } from 'electron'
import {
  applyThemeToClipboardFlyout,
  createClipboardFlyoutWindow,
  getClipboardFlyoutWindow,
  reanchorClipboardFlyout,
  setClipboardFlyoutPosition
} from '../src/main/clipboard-flyout-window'
import { applyThemeToBrowserWindow, getSearchWindow } from '../src/main/window'

// 主窗 (400,100,800,600) 不透明：right 锚 (1206,100,300,420)、left 锚 (94,100,300,420)
const fakeMainDef = {
  isVisible: vi.fn(() => true),
  getBounds: vi.fn((): { x: number; y: number; width: number; height: number } => ({ x: 400, y: 100, width: 800, height: 600 })),
  on: vi.fn()
}
const fakeMain = fakeMainDef as unknown as never

function makeFlyoutWin(): NonNullable<typeof fakeFlyout.win> {
  return {
    isDestroyed: vi.fn(() => false),
    setAlwaysOnTop: vi.fn(),
    on: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    destroy: vi.fn(),
    setBounds: vi.fn(),
    getBounds: vi.fn(() => ({ x: 1206, y: 100, width: 300, height: 420 })),
    showInactive: vi.fn(),
    moveTop: vi.fn(),
    webContents: { id: 7, send: vi.fn() }
  }
}

/** 取 createClipboardFlyoutWindow 挂的 'move' 处理器手动触发（mock 窗口不会自己发事件） */
function fireFlyoutMove(): void {
  const call = fakeFlyout.win?.on.mock.calls.find((c) => c[0] === 'move')
  const handler = call?.[1] as (() => void) | undefined
  expect(handler).toBeTypeOf('function')
  handler?.()
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks 不清 mockReturnValue，主窗 bounds 显式回基线防用例间串扰
  fakeMainDef.getBounds.mockReturnValue({ x: 400, y: 100, width: 800, height: 600 })
  // off 路径即 closeClipboardFlyout：连带复位模块级 position/dragOffset 与单例引用
  setClipboardFlyoutPosition('off')
  fakeFlyout.win = null
  vi.mocked(getSearchWindow).mockReturnValue(null)
})

describe('applyThemeToClipboardFlyout', () => {
  it('无飞窗时 no-op：不触原生效果也不发事件（红线18 null 全路径 no-op）', () => {
    expect(getClipboardFlyoutWindow()).toBeNull()
    applyThemeToClipboardFlyout('light', { enabled: false, opacity: 100, blur: false, glassFrost: 45 })
    expect(applyThemeToBrowserWindow).not.toHaveBeenCalled()
  })

  it('原生效果之外向本窗 webContents 发 detached:theme，载荷 theme+transparency 同独立窗', () => {
    fakeFlyout.win = makeFlyoutWin()
    vi.mocked(getSearchWindow).mockReturnValue(fakeMain)
    const tx = { enabled: true, opacity: 55, blur: true, glassFrost: 45 }
    const w = createClipboardFlyoutWindow()
    expect(w).not.toBeNull()

    applyThemeToClipboardFlyout('light', tx)

    expect(applyThemeToBrowserWindow).toHaveBeenCalledWith(w, 'light', tx, false)
    expect(fakeFlyout.win.webContents.send).toHaveBeenCalledTimes(1)
    expect(fakeFlyout.win.webContents.send).toHaveBeenCalledWith('detached:theme', {
      theme: 'light',
      transparency: tx
    })
  })

  it('载荷 glassFrost 随段自动携带（契约：transparency 整段透传，缺省由渲染层宽松回 45）', () => {
    fakeFlyout.win = makeFlyoutWin()
    vi.mocked(getSearchWindow).mockReturnValue(fakeMain)
    createClipboardFlyoutWindow()

    applyThemeToClipboardFlyout('dark', { enabled: true, opacity: 30, blur: true, glassFrost: 70 })

    const payload = fakeFlyout.win.webContents.send.mock.calls[0]?.[1] as { transparency?: { glassFrost?: number } }
    expect(payload.transparency?.glassFrost).toBe(70)
  })

  it('createClipboardFlyoutWindow 走 BrowserWindow 构造并应用创建时视觉态（惰性单例）', () => {
    fakeFlyout.win = makeFlyoutWin()
    vi.mocked(getSearchWindow).mockReturnValue(fakeMain)
    const first = createClipboardFlyoutWindow()
    const second = createClipboardFlyoutWindow()
    expect(first).toBe(second)
    expect(BrowserWindow).toHaveBeenCalledTimes(1)
    expect(applyThemeToBrowserWindow).toHaveBeenCalledWith(first, 'dark', expect.anything(), false)
  })
})

describe('B5 会话拖动偏移（review medium 修法 b）', () => {
  it('初始态 position=off：reanchor 直接 no-op 不触 setBounds', () => {
    fakeFlyout.win = makeFlyoutWin()
    vi.mocked(getSearchWindow).mockReturnValue(fakeMain)
    createClipboardFlyoutWindow()
    reanchorClipboardFlyout()
    expect(fakeFlyout.win.setBounds).not.toHaveBeenCalled()
  })

  it('启用即按预设锚定（零偏移）：right 档 OS=(1206,100,300,420)（不透明无环）', () => {
    fakeFlyout.win = makeFlyoutWin()
    vi.mocked(getSearchWindow).mockReturnValue(fakeMain)
    setClipboardFlyoutPosition('right')
    expect(fakeFlyout.win.setBounds).toHaveBeenCalledTimes(1)
    expect(fakeFlyout.win.setBounds).toHaveBeenCalledWith({ x: 1206, y: 100, width: 300, height: 420 })
    expect(fakeFlyout.win.showInactive).toHaveBeenCalled()
  })

  it('用户拖动（move 差分）记录偏移；主窗移动重锚叠加偏移，不弹回预设方位', () => {
    fakeFlyout.win = makeFlyoutWin()
    vi.mocked(getSearchWindow).mockReturnValue(fakeMain)
    setClipboardFlyoutPosition('right')
    // 用户拖到 (1246,80)：move 处理器按「当前 bounds − 新鲜锚点」差分记录 (40,-20)
    fakeFlyout.win.getBounds.mockReturnValue({ x: 1246, y: 80, width: 300, height: 420 })
    fireFlyoutMove()
    // 主窗右移 100 → 新锚 (1306,100)，重锚须叠加用户偏移
    fakeMainDef.getBounds.mockReturnValue({ x: 500, y: 100, width: 800, height: 600 })
    reanchorClipboardFlyout()
    expect(fakeFlyout.win.setBounds).toHaveBeenLastCalledWith({ x: 1346, y: 80, width: 300, height: 420 })
  })

  it('程序化重锚后的 move 回写同值：偏移稳定无反馈环、无累积漂移', () => {
    fakeFlyout.win = makeFlyoutWin()
    vi.mocked(getSearchWindow).mockReturnValue(fakeMain)
    setClipboardFlyoutPosition('right')
    fakeFlyout.win.getBounds.mockReturnValue({ x: 1246, y: 80, width: 300, height: 420 })
    fireFlyoutMove() // 记录 (40,-20)
    fakeMainDef.getBounds.mockReturnValue({ x: 500, y: 100, width: 800, height: 600 })
    reanchorClipboardFlyout() // 程序化落位 (1346,80)
    // 系统对程序化 setBounds 补发 move：回写差分应仍为 (40,-20)
    fakeFlyout.win.getBounds.mockReturnValue({ x: 1346, y: 80, width: 300, height: 420 })
    fireFlyoutMove()
    fakeMainDef.getBounds.mockReturnValue({ x: 450, y: 100, width: 800, height: 600 })
    reanchorClipboardFlyout()
    expect(fakeFlyout.win.setBounds).toHaveBeenLastCalledWith({ x: 1296, y: 80, width: 300, height: 420 })
  })

  it('换预设偏移归零：left 档按新预设原点锚定（不带旧偏移）', () => {
    fakeFlyout.win = makeFlyoutWin()
    vi.mocked(getSearchWindow).mockReturnValue(fakeMain)
    setClipboardFlyoutPosition('right')
    fakeFlyout.win.getBounds.mockReturnValue({ x: 1246, y: 80, width: 300, height: 420 })
    fireFlyoutMove() // 偏移 (40,-20)
    setClipboardFlyoutPosition('left')
    expect(fakeFlyout.win.setBounds).toHaveBeenLastCalledWith({ x: 94, y: 100, width: 300, height: 420 })
  })

  it('显窗路径（showClipboardFlyout→reanchor）同样叠加既有偏移：隐藏再唤起位置保持', () => {
    fakeFlyout.win = makeFlyoutWin()
    vi.mocked(getSearchWindow).mockReturnValue(fakeMain)
    setClipboardFlyoutPosition('right')
    fakeFlyout.win.getBounds.mockReturnValue({ x: 1246, y: 80, width: 300, height: 420 })
    fireFlyoutMove() // 偏移 (40,-20)
    // 主窗未动，再次显窗（如隐藏后唤起）仍锚在用户偏移位
    reanchorClipboardFlyout()
    expect(fakeFlyout.win.setBounds).toHaveBeenLastCalledWith({ x: 1246, y: 80, width: 300, height: 420 })
  })

  it('拖出工作区：重锚按 workArea 夹取（防拖出屏）', () => {
    fakeFlyout.win = makeFlyoutWin()
    vi.mocked(getSearchWindow).mockReturnValue(fakeMain)
    setClipboardFlyoutPosition('right')
    // 拖到屏幕右缘外（wa 1920×1040）：x 夹到 1920−300=1620
    fakeFlyout.win.getBounds.mockReturnValue({ x: 3000, y: 80, width: 300, height: 420 })
    fireFlyoutMove()
    reanchorClipboardFlyout()
    expect(fakeFlyout.win.setBounds).toHaveBeenLastCalledWith({ x: 1620, y: 80, width: 300, height: 420 })
  })
})
