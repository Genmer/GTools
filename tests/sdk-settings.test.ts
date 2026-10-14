import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  OUTLINE_CUSTOM_COLOR_DEFAULT,
  OUTLINE_FLOW_SPEED_DEFAULT,
  OUTLINE_FLOW_SPEED_MAX,
  OUTLINE_FLOW_SPEED_MIN,
  OUTLINE_WIDTH_MAX,
  OUTLINE_WIDTH_MIN,
  isOutlineColor,
  rimFlowPeriodSeconds,
  sanitizeOutlineCustomColor,
  sanitizeOutlineFlowSpeed,
  sanitizeAppLogSkin,
  sanitizeAppLogoSkin,
  sanitizeOutlineWidth
} from '../sdk/settings'

describe('sdk/settings：轮廓环宽纯函数 sanitizeOutlineWidth', () => {
  it('默认值与边界常量：outlineWidth=3 / outlineColor=auto / outlineCustomColor=#42a5f5 / outlineFlowSpeed=3 / 宽 MIN=0 MAX=5 / 速 MIN=1 MAX=10', () => {
    expect(DEFAULT_SETTINGS.outlineWidth).toBe(3)
    expect(DEFAULT_SETTINGS.outlineColor).toBe('auto')
    expect(DEFAULT_SETTINGS.outlineEnabled).toBe(true)
    expect(DEFAULT_SETTINGS.outlineCustomColor).toBe(OUTLINE_CUSTOM_COLOR_DEFAULT)
    expect(DEFAULT_SETTINGS.outlineFlowSpeed).toBe(3)
    expect(OUTLINE_CUSTOM_COLOR_DEFAULT).toBe('#42a5f5')
    expect(OUTLINE_WIDTH_MIN).toBe(0)
    expect(OUTLINE_WIDTH_MAX).toBe(5)
    expect(OUTLINE_FLOW_SPEED_MIN).toBe(1)
    expect(OUTLINE_FLOW_SPEED_MAX).toBe(10)
    expect(OUTLINE_FLOW_SPEED_DEFAULT).toBe(3)
  })

  it('边界值 0 与 5 本身合法原样返回（夹取不伤端点）', () => {
    expect(sanitizeOutlineWidth(0)).toBe(0)
    expect(sanitizeOutlineWidth(5)).toBe(5)
  })

  it('越界夹取：上限方向 6/9/1e9/极大有限数→5，下限方向 -0.1/-1/-3/-1e9→0', () => {
    for (const v of [6, 9, 1e9, Number.MAX_VALUE, Number.MAX_SAFE_INTEGER]) {
      expect(sanitizeOutlineWidth(v)).toBe(5)
    }
    for (const v of [-0.1, -1, -3, -1e9, -Number.MAX_VALUE]) {
      expect(sanitizeOutlineWidth(v)).toBe(0)
    }
  })

  it('小数四舍五入（round 半值向上）：2.4→2、2.6→3、0.5→1、4.5→5、2.5→3', () => {
    expect(sanitizeOutlineWidth(2.4)).toBe(2)
    expect(sanitizeOutlineWidth(2.6)).toBe(3)
    expect(sanitizeOutlineWidth(0.5)).toBe(1)
    expect(sanitizeOutlineWidth(4.5)).toBe(5)
    expect(sanitizeOutlineWidth(2.5)).toBe(3)
  })

  it('负半值 -0.5 归 0 且为正零（round(-0.5)=-0，经 max 夹取不产生 -0）', () => {
    const r = sanitizeOutlineWidth(-0.5)
    expect(r).toBe(0)
    expect(Object.is(r, -0)).toBe(false)
  })

  it('极小正数四舍五入归 0：MIN_VALUE→0', () => {
    expect(sanitizeOutlineWidth(Number.MIN_VALUE)).toBe(0)
  })

  it('非有限数与非 number 一律返回 null（调用方剔除回退现值）', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'x', '3', null, undefined, true, false, {}, []]) {
      expect(sanitizeOutlineWidth(bad)).toBeNull()
    }
  })
})

describe('sdk/settings：轮廓环色谓词 isOutlineColor', () => {
  it('六枚举 auto/white/black/rainbow/rainbow-gradient/custom 全部命中', () => {
    for (const v of ['auto', 'white', 'black', 'rainbow', 'rainbow-gradient', 'custom'] as const) {
      expect(isOutlineColor(v)).toBe(true)
    }
  })

  it('非枚举值全部拒绝：red/rainbow 近似拼写/大小写变体/空串/非字符串', () => {
    for (const bad of ['red', 'AUTO', 'White', 'Rainbow-Gradient', 'rainbow_grad', 'gradients', '', 0, 3, null, undefined, true, {}, []]) {
      expect(isOutlineColor(bad)).toBe(false)
    }
  })
})

describe('sdk/settings：自定义环色 sanitizeOutlineCustomColor', () => {
  it('#rrggbb 合法原样返回（大小写规范化为小写）', () => {
    expect(sanitizeOutlineCustomColor('#aabbcc')).toBe('#aabbcc')
    expect(sanitizeOutlineCustomColor('#AABBCC')).toBe('#aabbcc')
    expect(sanitizeOutlineCustomColor('#42a5f5')).toBe('#42a5f5')
    expect(sanitizeOutlineCustomColor('#000000')).toBe('#000000')
    expect(sanitizeOutlineCustomColor('#FFFFFF')).toBe('#ffffff')
  })

  it('#rgb 三位扩位为 #rrggbb 并小写化', () => {
    expect(sanitizeOutlineCustomColor('#abc')).toBe('#aabbcc')
    expect(sanitizeOutlineCustomColor('#ABC')).toBe('#aabbcc')
    expect(sanitizeOutlineCustomColor('#f0a')).toBe('#ff00aa')
  })

  it('非法输入一律返回 null：非字符串/无 #/位数不对/非 hex 字符/空串', () => {
    for (const bad of ['red', 'aabbcc', '#aabbc', '#aabbccd', '#aabbcdd', '#GGG', '#12g', '#', '', ' #aabbcc', 42, null, undefined, true, {}, []]) {
      expect(sanitizeOutlineCustomColor(bad)).toBeNull()
    }
  })
})

describe('sdk/settings：流动速度 sanitizeOutlineFlowSpeed 与时长 rimFlowPeriodSeconds', () => {
  it('端点 1 与 10 合法原样返回（夹取不伤端点）', () => {
    expect(sanitizeOutlineFlowSpeed(1)).toBe(1)
    expect(sanitizeOutlineFlowSpeed(10)).toBe(10)
  })

  it('越界夹取与四舍五入：0/-3/1e9→1 或 10，2.4→2、2.6→3、9.5→10', () => {
    expect(sanitizeOutlineFlowSpeed(0)).toBe(1)
    expect(sanitizeOutlineFlowSpeed(-3)).toBe(1)
    expect(sanitizeOutlineFlowSpeed(1e9)).toBe(10)
    expect(sanitizeOutlineFlowSpeed(2.4)).toBe(2)
    expect(sanitizeOutlineFlowSpeed(2.6)).toBe(3)
    expect(sanitizeOutlineFlowSpeed(9.5)).toBe(10)
  })

  it('非有限数与非 number 一律返回 null', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 'x', '3', null, undefined, true, {}, []]) {
      expect(sanitizeOutlineFlowSpeed(bad)).toBeNull()
    }
  })

  it('时长公式 36/s：默认 3 档 = 12s（与 themes.css 兜底一致），1 档 36s、10 档 3.6s', () => {
    expect(rimFlowPeriodSeconds(3)).toBe(12)
    expect(rimFlowPeriodSeconds(OUTLINE_FLOW_SPEED_DEFAULT)).toBe(12)
    expect(rimFlowPeriodSeconds(1)).toBe(36)
    expect(rimFlowPeriodSeconds(10)).toBe(3.6)
  })

  it('时长对非 number/非有限回退 12s；越界数值先夹取再代入（0/-5→1 档 36s，1e9→10 档 3.6s）', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 'x', null, undefined]) {
      expect(rimFlowPeriodSeconds(bad)).toBe(12)
    }
    expect(rimFlowPeriodSeconds(0)).toBe(36)
    expect(rimFlowPeriodSeconds(-5)).toBe(36)
    expect(rimFlowPeriodSeconds(1e9)).toBe(3.6)
  })
})

describe('sdk/settings：应用日志底色 sanitizeAppLogSkin', () => {
  it('默认 appLogSkin=black', () => {
    expect(DEFAULT_SETTINGS.appLogSkin).toBe('black')
  })

  it('只放行 black/white，其余返回 null', () => {
    expect(sanitizeAppLogSkin('black')).toBe('black')
    expect(sanitizeAppLogSkin('white')).toBe('white')
    for (const bad of ['', 'dark', 'Black', 1, null, undefined, {}, []]) {
      expect(sanitizeAppLogSkin(bad)).toBeNull()
    }
  })
})

describe('sdk/settings：应用 logo 底色 sanitizeAppLogoSkin', () => {
  it('默认 appLogoSkin=black', () => {
    expect(DEFAULT_SETTINGS.appLogoSkin).toBe('black')
  })

  it('只放行 black/white，其余返回 null', () => {
    expect(sanitizeAppLogoSkin('black')).toBe('black')
    expect(sanitizeAppLogoSkin('white')).toBe('white')
    for (const bad of ['', 'dark', 'White', 1, null, undefined, {}, []]) {
      expect(sanitizeAppLogoSkin(bad)).toBeNull()
    }
  })
})
