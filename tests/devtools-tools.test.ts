import { describe, expect, it } from 'vitest'
import { validate, format, minify } from '../src/plugins/devtools/views/logic/json'
import { tsToDate, dateToTs } from '../src/plugins/devtools/views/logic/time'
import { uuidV4, uuidBatch } from '../src/plugins/devtools/views/logic/uuid'
import { encode, decode, tryDecode } from '../src/plugins/devtools/views/logic/base64'
import { runPattern, buildRegex } from '../src/plugins/devtools/views/logic/regex'
import { parseColor, hexToRgb, rgbToHsl, hslToRgb, rgbToHex } from '../src/plugins/devtools/views/logic/color'
import { decodeJwt } from '../src/plugins/devtools/views/logic/jwt'

describe('JSON 工具', () => {
  it('合法 JSON 校验/格式化/压缩', () => {
    const r = validate('{"a":1}')
    expect(r.ok).toBe(true)
    expect(format('{"a": [1,2]}', 2)).toMatchObject({ ok: true, text: '{\n  "a": [\n    1,\n    2\n  ]\n}' })
    expect(minify('{ "a" : 1 }')).toMatchObject({ ok: true, text: '{"a":1}' })
  })

  it('非法 JSON 返回行列定位且不抛异常', () => {
    const r = validate('{\n  "a": tru\n}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.line).toBe(2)
      expect(r.column).toBeGreaterThan(0)
      expect(r.message).toBeTruthy()
    }
    const r2 = validate('not json at all')
    expect(r2.ok).toBe(false)
  })
})

describe('时间戳工具', () => {
  it('秒/毫秒时间戳转日期', () => {
    expect(tsToDate(1_700_000_000, 's').getTime()).toBe(1_700_000_000_000)
    expect(tsToDate(1_700_000_000_000, 'ms').getTime()).toBe(1_700_000_000_000)
  })

  it('日期转时间戳返回秒/毫秒双值', () => {
    const d = new Date('2026-01-01T00:00:00Z')
    expect(dateToTs(d)).toEqual({ s: 1_767_225_600, ms: 1_767_225_600_000 })
  })
})

describe('UUID 工具', () => {
  it('v4 格式正确且随机', () => {
    const a = uuidV4()
    const b = uuidV4()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })

  it('批量 1-1000 限幅', () => {
    expect(uuidBatch(5)).toHaveLength(5)
    expect(uuidBatch(0)).toHaveLength(1)
    expect(uuidBatch(9999)).toHaveLength(1000)
  })
})

describe('Base64 工具', () => {
  it('UTF-8 中文双向正确（你好 ↔ 5L2g5aW9）', () => {
    expect(encode('你好')).toBe('5L2g5aW9')
    expect(decode('5L2g5aW9')).toBe('你好')
    expect(decode(encode('hello GTools 中文混合'))).toBe('hello GTools 中文混合')
  })

  it('非法输入不抛异常，返回错误', () => {
    const r = tryDecode('!!!not-base64###')
    expect(r.ok).toBe(false)
  })
})

describe('正则工具', () => {
  it('语法错误返回信息不抛异常', () => {
    expect(buildRegex('(', '')).toHaveProperty('error')
    const r = runPattern('[', 'g', 'abc')
    expect(r.ok).toBe(false)
  })

  it('matchAll 列出匹配与分组，无 g 标志自动补', () => {
    const r = runPattern('(\\w+)@(\\w+)', '', 'a@x b@y')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.matches).toHaveLength(2)
      expect(r.matches[0].groups).toEqual(['a', 'x'])
      expect(r.matches[1].match).toBe('b@y')
    }
  })
})

describe('颜色工具', () => {
  it('HEX/RGB/HSL 三向互转', () => {
    const rgb = hexToRgb('#4493f8')!
    expect(rgb).toEqual({ r: 68, g: 147, b: 248 })
    expect(rgbToHex(rgb)).toBe('#4493f8')
    const hsl = rgbToHsl(rgb)
    const back = hslToRgb(hsl)
    // HSL 往返存在取整误差，容差 1
    expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1)
    expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1)
  })

  it('parseColor 支持 #abc、rgb()、hsl()，非法输入不抛异常', () => {
    expect(parseColor('#abc').ok).toBe(true)
    expect(parseColor('rgb(1, 2, 3)')).toMatchObject({ ok: true })
    expect(parseColor('hsl(120, 50%, 50%)').ok).toBe(true)
    expect(parseColor('nope').ok).toBe(false)
    expect(parseColor('rgb(300, 0, 0)').ok).toBe(false)
  })
})

describe('JWT 工具', () => {
  const mkJwt = (payload: object): string => {
    const enc = (o: object): string =>
      encode(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.sig`
  }

  it('解码 header/payload（含中文）并换算 iat/exp', () => {
    const now = 1_800_000_000_000
    const token = mkJwt({ sub: '用户A', iat: 1_700_000_000, exp: 1_900_000_000 })
    const r = decodeJwt(token, now)
    expect(r.ok).toBe(true)
    expect(r.payload?.sub).toBe('用户A')
    expect(r.header?.alg).toBe('HS256')
    expect(r.expired).toBe(false)
  })

  it('exp 早于 now 标注已过期', () => {
    const now = 1_800_000_000_000
    const r = decodeJwt(mkJwt({ exp: 1_700_000_000 }), now)
    expect(r.ok).toBe(true)
    expect(r.expired).toBe(true)
  })

  it('非法 token 不抛异常', () => {
    expect(decodeJwt('garbage').ok).toBe(false)
    expect(decodeJwt('a.b').ok).toBe(false)
  })
})
