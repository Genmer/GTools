// 飞窗锚定几何冻结样例（F14 侦查样例输入锁定）+ 换边/双败 clamp/压高/负坐标/marginPolicy 变体
import { describe, expect, it } from 'vitest'
import {
  FLYOUT_GAP,
  PANEL_BELOW_W,
  PANEL_H_DEFAULT,
  PANEL_H_MAX,
  PANEL_H_MIN,
  PANEL_SIDE_W,
  anchorFlyout,
  applyFlyoutOffset,
  contentRectOfMain,
  flyOsBounds
} from '../src/main/clipboard-flyout-geometry'
import { MARGIN_BOTTOM, MARGIN_TOP, MARGIN_X } from '../src/main/detached-window-geometry'

// 冻结输入（F14）：主窗 OS (1288,403,864,640)、workArea (0,0,3440,1440)、透明档
const MAIN_OS = { x: 1288, y: 403, width: 864, height: 640 }
const WA = { x: 0, y: 0, width: 3440, height: 1440 }

describe('常数契约', () => {
  it('GAP/面板尺寸/输入框顶offset 冻结', () => {
    expect(FLYOUT_GAP).toBe(6)
    expect(PANEL_SIDE_W).toBe(300)
    expect(PANEL_BELOW_W).toBe(640)
    expect(PANEL_H_DEFAULT).toBe(420)
    expect(PANEL_H_MIN).toBe(240)
    expect(PANEL_H_MAX).toBe(560)
    // MARGIN 32/32/48 依赖锁定（单源 detached-window-geometry，飞窗环同源）
    expect(MARGIN_X).toBe(32)
    expect(MARGIN_TOP).toBe(32)
    expect(MARGIN_BOTTOM).toBe(48)
  })
})

describe('contentRectOfMain / flyOsBounds', () => {
  it('透明档内容口径 = OS 内缩 32/32/48；不透明恒等', () => {
    expect(contentRectOfMain(MAIN_OS, true)).toEqual({ x: 1320, y: 435, width: 800, height: 560 })
    expect(contentRectOfMain(MAIN_OS, false)).toEqual(MAIN_OS)
  })

  it('有环 OS=(x−32,y−32,w+64,h+80)；无环恒等', () => {
    expect(flyOsBounds(2126, 435, 300, 420, true)).toEqual({ x: 2094, y: 403, width: 364, height: 500 })
    expect(flyOsBounds(2126, 435, 300, 420, false)).toEqual({ x: 2126, y: 435, width: 300, height: 420 })
  })
})

describe('anchorFlyout 冻结样例（透明主窗，全环）', () => {
  it('right 档：卡 (2126,435,300,420) / OS (2094,403,364,500)，与侦查样例逐位一致', () => {
    expect(
      anchorFlyout({ mainBounds: MAIN_OS, transparentMain: true, withMargin: true, position: 'right', panelH: PANEL_H_DEFAULT, workArea: WA })
    ).toEqual({
      side: 'right',
      card: { x: 2126, y: 435, width: 300, height: 420 },
      os: { x: 2094, y: 403, width: 364, height: 500 }
    })
  })

  it('left 档同源：卡贴内容左缘外 6px，OS 对称加环', () => {
    expect(
      anchorFlyout({ mainBounds: MAIN_OS, transparentMain: true, withMargin: true, position: 'left', panelH: PANEL_H_DEFAULT, workArea: WA })
    ).toEqual({
      side: 'left',
      card: { x: 1014, y: 435, width: 300, height: 420 },
      os: { x: 982, y: 403, width: 364, height: 500 }
    })
  })

  it('below 档窗外锚定：卡顶=内容底缘+6，w=min(640,wa.width) 居中，h=clamp(panelH,240,560) 与下方空间取小', () => {
    expect(
      anchorFlyout({ mainBounds: MAIN_OS, transparentMain: true, withMargin: true, position: 'below', panelH: PANEL_H_DEFAULT, workArea: WA })
    ).toEqual({
      side: 'below',
      card: { x: 1400, y: 1001, width: 640, height: 420 },
      os: { x: 1368, y: 969, width: 704, height: 500 }
    })
  })
})

describe('anchorFlyout 不透明主窗（无环恒等口径）', () => {
  it('OS=卡片逐字段恒等，right 仍贴缝 6px', () => {
    const r = anchorFlyout({ mainBounds: MAIN_OS, transparentMain: false, withMargin: false, position: 'right', panelH: PANEL_H_DEFAULT, workArea: WA })
    expect(r.os).toEqual(r.card)
    expect(r.card.x).toBe(1288 + 864 + FLYOUT_GAP)
  })

  it('darwin 式「透明但无环」：OS=卡片（wantsDetachedMargin=false 组合）', () => {
    const r = anchorFlyout({ mainBounds: MAIN_OS, transparentMain: true, withMargin: false, position: 'left', panelH: PANEL_H_DEFAULT, workArea: WA })
    expect(r.os).toEqual(r.card)
  })
})

describe('anchorFlyout 换边与硬 clamp', () => {
  const waRight = { x: 0, y: 0, width: 1366, height: 728 }

  it('贴右缘：right 越 wa 右缘换 left（x=content 左缘−6−300）', () => {
    // 不透明主窗内容 (1040,100,300,400)：right x=1346+300=1646 > 1366 → left x=1040−306=734
    const r = anchorFlyout({ mainBounds: { x: 1040, y: 100, width: 300, height: 400 }, transparentMain: false, withMargin: false, position: 'right', panelH: 400, workArea: waRight })
    expect(r.side).toBe('left')
    expect(r.card).toEqual({ x: 734, y: 100, width: 300, height: 400 })
  })

  it('贴左缘对称：left 越 wa 左缘换 right', () => {
    const r = anchorFlyout({ mainBounds: { x: 24, y: 100, width: 300, height: 400 }, transparentMain: false, withMargin: false, position: 'left', panelH: 400, workArea: waRight })
    expect(r.side).toBe('right')
    expect(r.card.x).toBe(24 + 300 + FLYOUT_GAP)
  })

  it('1366 宽双败硬 clamp：right 出界、left 负 → 钉回 wa 右缘（x=wa.x+wa.width−300）', () => {
    // 内容右缘 1334：right x=1340 出界；left x=1028−306=−278 < 0 → 硬 clamp
    const r = anchorFlyout({ mainBounds: { x: 32, y: 32, width: 1302, height: 664 }, transparentMain: false, withMargin: false, position: 'right', panelH: 400, workArea: waRight })
    expect(r.side).toBe('right')
    expect(r.card.x).toBe(1366 - PANEL_SIDE_W)
    expect(r.card.x).toBeGreaterThanOrEqual(waRight.x)
  })
})

describe('anchorFlyout 高度钳制与矮屏', () => {
  it('side 档 h=clamp(min(panelH,content.h),240,560)，y 顶对齐内容且 clamp 进 wa', () => {
    const tall = anchorFlyout({ mainBounds: MAIN_OS, transparentMain: true, withMargin: true, position: 'right', panelH: 2000, workArea: WA })
    expect(tall.card.height).toBe(PANEL_H_MAX)
    const short = anchorFlyout({ mainBounds: MAIN_OS, transparentMain: true, withMargin: true, position: 'right', panelH: 100, workArea: WA })
    expect(short.card.height).toBe(PANEL_H_MIN)
  })

  it('below 下方空间不足 PANEL_H_MIN → 整板翻转到主窗上方（y=内容顶−6−h）', () => {
    const wa = { x: 0, y: 0, width: 1920, height: 500 }
    // content 底 930 → belowY=936 出界；aboveY=430−6−420=4 ≥ wa.y → 翻转
    const r = anchorFlyout({ mainBounds: { x: 32, y: 430, width: 800, height: 500 }, transparentMain: false, withMargin: false, position: 'below', panelH: 420, workArea: wa })
    expect(r.side).toBe('below')
    expect(r.card).toEqual({ x: Math.round(32 + (800 - 640) / 2), y: 4, width: 640, height: 420 })
    expect(r.card.y + r.card.height).toBeLessThanOrEqual(430)
  })

  it('below 剩余空间够 MIN 但不够整高 → 压高到 spaceBelow', () => {
    // content 底 520 → belowY=526，spaceBelow=274 ∈ [240,420)
    const r = anchorFlyout({ mainBounds: { x: 32, y: 100, width: 800, height: 420 }, transparentMain: false, withMargin: false, position: 'below', panelH: 420, workArea: { x: 0, y: 0, width: 1920, height: 800 } })
    expect(r.card).toEqual({ x: 112, y: 526, width: 640, height: 274 })
  })

  it('below 双败（下方/上方都放不下）→ 硬 clamp 钉 wa 下缘压到 MIN（无窗内回抬）', () => {
    // belowY=456 空间 44 < 240；aboveY=−326 < 0 → y=500−240=260
    const r = anchorFlyout({ mainBounds: { x: 32, y: 100, width: 800, height: 350 }, transparentMain: false, withMargin: false, position: 'below', panelH: 420, workArea: { x: 0, y: 0, width: 1920, height: 500 } })
    expect(r.card).toEqual({ x: 112, y: 500 - PANEL_H_MIN, width: 640, height: PANEL_H_MIN })
  })

  it('below 高度不再随主窗内容高钳制（窗外锚定）：矮窗也取整高', () => {
    const r = anchorFlyout({ mainBounds: { x: 0, y: 0, width: 1000, height: 200 }, transparentMain: false, withMargin: false, position: 'below', panelH: 420, workArea: { x: 0, y: 0, width: 1920, height: 1080 } })
    expect(r.card.height).toBe(420)
    expect(r.card.y).toBe(206)
  })
})

describe('anchorFlyout 负坐标副屏与窄屏 below', () => {
  it('负坐标 workArea：right 落位为负 x 且整体在 wa 内，y clamp 随 wa.y 平移', () => {
    const wa = { x: -1920, y: 0, width: 1920, height: 1080 }
    const r = anchorFlyout({ mainBounds: { x: -1900, y: 40, width: 800, height: 560 }, transparentMain: false, withMargin: false, position: 'right', panelH: 420, workArea: wa })
    // right x=-1900+800+6=-1094，卡右缘 -794 ≤ wa 右缘 0 → right 原位成立
    expect(r.side).toBe('right')
    expect(r.card).toEqual({ x: -1094, y: 40, width: 300, height: 420 })
    expect(r.card.x).toBeGreaterThanOrEqual(wa.x)
    expect(r.card.x + r.card.width).toBeLessThanOrEqual(wa.x + wa.width)
  })

  it('负坐标副屏贴右缘换边：left 出 wa 左缘 → 双败硬 clamp 钉 wa 右缘', () => {
    const wa = { x: -1920, y: 0, width: 1920, height: 1080 }
    const r = anchorFlyout({ mainBounds: { x: -1200, y: 40, width: 800, height: 560 }, transparentMain: false, withMargin: false, position: 'left', panelH: 420, workArea: wa })
    // left x=-1200-306=-1506 在 wa 内 → left 成立；构造越界样例：content 左缘=wa.x+100 → left 出界、right 出界
    expect(r.side).toBe('left')
    expect(r.card.x).toBe(-1200 - 6 - 300)
    const tight = anchorFlyout({ mainBounds: { x: -1820, y: 40, width: 1900, height: 560 }, transparentMain: false, withMargin: false, position: 'right', panelH: 420, workArea: wa })
    expect(tight.card.x).toBe(wa.x + wa.width - PANEL_SIDE_W)
  })

  it('窄屏 below 宽=wa.width（F13）且 x=wa.x', () => {
    const wa = { x: 0, y: 0, width: 500, height: 1000 }
    const r = anchorFlyout({ mainBounds: MAIN_OS, transparentMain: false, withMargin: false, position: 'below', panelH: 420, workArea: wa })
    expect(r.card.width).toBe(500)
    expect(r.card.x).toBe(0)
  })
})

describe('applyFlyoutOffset（B5 会话拖动偏移叠加）', () => {
  // 冻结样例 right 档 OS bounds（见上 describe）
  const OS = { x: 2094, y: 403, width: 364, height: 500 }

  it('零偏移恒等，尺寸不变', () => {
    expect(applyFlyoutOffset(OS, { dx: 0, dy: 0 }, WA)).toEqual(OS)
  })

  it('偏移整体平移（负 dy 向上）', () => {
    expect(applyFlyoutOffset(OS, { dx: 40, dy: -20 }, WA)).toEqual({ x: 2134, y: 383, width: 364, height: 500 })
  })

  it('拖出工作区被夹取：右/下缘钉 wa 缘，宽度高度不变', () => {
    const r = applyFlyoutOffset(OS, { dx: 100000, dy: 100000 }, WA)
    expect(r).toEqual({ x: WA.x + WA.width - OS.width, y: WA.y + WA.height - OS.height, width: 364, height: 500 })
  })

  it('左/上出界对称钉 wa 原点侧', () => {
    const r = applyFlyoutOffset(OS, { dx: -100000, dy: -100000 }, WA)
    expect(r.x).toBe(WA.x)
    expect(r.y).toBe(WA.y)
  })

  it('负坐标副屏工作区：夹取随 wa 平移', () => {
    const wa = { x: -1920, y: 0, width: 1920, height: 1080 }
    const os = { x: -1094, y: 40, width: 300, height: 420 }
    expect(applyFlyoutOffset(os, { dx: 5000, dy: 0 }, wa)).toEqual({ ...os, x: wa.x + wa.width - os.width })
    expect(applyFlyoutOffset(os, { dx: -5000, dy: 0 }, wa)).toEqual({ ...os, x: wa.x })
  })

  it('退化窄屏（面板宽于 wa）：上下界倒挂时钉在 wa.x 不出 NaN', () => {
    const r = applyFlyoutOffset({ x: 100, y: 0, width: 704, height: 500 }, { dx: 50, dy: 0 }, { x: 0, y: 0, width: 500, height: 800 })
    expect(r.x).toBe(0)
    expect(Number.isFinite(r.y)).toBe(true)
  })

  it('小数偏移取整（防差分累积漂移）', () => {
    const r = applyFlyoutOffset(OS, { dx: 10.4, dy: -0.6 }, WA)
    expect(r.x).toBe(OS.x + 10)
    expect(r.y).toBe(OS.y - 1)
  })
})

describe("anchorFlyout marginPolicy:'exceptFacingMain'（F10 变体，贴主窗侧不留环）", () => {
  const base = { mainBounds: MAIN_OS, transparentMain: true, withMargin: true, panelH: PANEL_H_DEFAULT, workArea: WA, marginPolicy: 'exceptFacingMain' as const }

  it('right 档 OS 左缘=card.x−6，其余侧维持全环', () => {
    const r = anchorFlyout({ ...base, position: 'right' })
    expect(r.os).toEqual({ x: 2126 - FLYOUT_GAP, y: 435 - MARGIN_TOP, width: 300 + FLYOUT_GAP + MARGIN_X, height: 420 + MARGIN_TOP + MARGIN_BOTTOM })
  })

  it('left 档 OS 右缘=card 右缘+6', () => {
    const r = anchorFlyout({ ...base, position: 'left' })
    expect(r.os).toEqual({ x: 1014 - MARGIN_X, y: 435 - MARGIN_TOP, width: 300 + MARGIN_X + FLYOUT_GAP, height: 420 + MARGIN_TOP + MARGIN_BOTTOM })
    expect(r.os.x + r.os.width).toBe(1014 + 300 + FLYOUT_GAP)
  })

  it('below 档正挂 OS 上缘=card.y−6；翻转档贴缝环落到下缘', () => {
    const r = anchorFlyout({ ...base, position: 'below' })
    expect(r.os).toEqual({ x: 1400 - MARGIN_X, y: 1001 - FLYOUT_GAP, width: 640 + MARGIN_X * 2, height: 420 + FLYOUT_GAP + MARGIN_BOTTOM })
    // 翻转样例：透明主窗内容 (64,462,736,420)，belowY=888 出界 → 卡在内容上方，贴缝环落到 OS 下缘
    const flipped = anchorFlyout({
      mainBounds: { x: 32, y: 430, width: 800, height: 500 },
      transparentMain: true,
      withMargin: true,
      marginPolicy: 'exceptFacingMain',
      position: 'below',
      panelH: PANEL_H_DEFAULT,
      workArea: { x: 0, y: 0, width: 1920, height: 500 }
    })
    expect(flipped.card).toEqual({ x: 112, y: 36, width: 640, height: 420 })
    expect(flipped.os).toEqual({ x: 112 - MARGIN_X, y: 36 - MARGIN_TOP, width: 640 + MARGIN_X * 2, height: 420 + MARGIN_TOP + FLYOUT_GAP })
    expect(flipped.os.y + flipped.os.height).toBe(36 + 420 + FLYOUT_GAP)
  })

  it('不透明窗（无环）下 policy 无作用：OS=卡片', () => {
    const r = anchorFlyout({ mainBounds: MAIN_OS, transparentMain: false, withMargin: false, marginPolicy: 'exceptFacingMain', position: 'right', panelH: PANEL_H_DEFAULT, workArea: WA })
    expect(r.os).toEqual(r.card)
  })
})
