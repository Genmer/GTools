import { describe, expect, it } from 'vitest'
import { createRng } from '../../../../src/plugins/fake-data/logic/random'
import { ID_AREAS } from '../../../../src/plugins/fake-data/logic/dict'
import {
  DEFAULT_FIELD_IDS,
  FIELD_DEFS,
  clampCount,
  fieldById,
  generateBatch,
  generateRecord,
  idCheckDigit,
  isValidIdCard,
  uuidV4
} from '../../../../src/plugins/fake-data/logic/fields'

// 独立实现的校验器（权重与映射重新写一遍，交叉验证生成器不是自我印证）
function independentCheck(id: string): boolean {
  if (!/^\d{17}[\dX]$/.test(id)) return false
  const w = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const map = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(id[i]) * w[i]
  return map[sum % 11] === id[17]
}

const rng = () => createRng(20260924)
const ALL_IDS = FIELD_DEFS.map((f) => f.id)

describe('fake-data generators', () => {
  it('已知有效身份证通过校验（11010519491231002X 为国标示例）', () => {
    expect(isValidIdCard('11010519491231002X')).toBe(true)
    expect(idCheckDigit('11010519491231002')).toBe('X')
    expect(isValidIdCard('110105194912310021')).toBe(false)
  })

  it('批量生成的身份证均通过独立校验器，且区码/生日段合法', () => {
    const areas = new Set(ID_AREAS)
    for (let i = 0; i < 300; i++) {
      const id = generateRecord(['idcard'], rng()).idcard
      expect(independentCheck(id)).toBe(true)
      expect(areas.has(id.slice(0, 6))).toBe(true)
      const year = Number(id.slice(6, 10))
      const month = Number(id.slice(10, 12))
      const day = Number(id.slice(12, 14))
      expect(year).toBeGreaterThanOrEqual(1950)
      expect(year).toBeLessThanOrEqual(2005)
      expect(month).toBeGreaterThanOrEqual(1)
      expect(month).toBeLessThanOrEqual(12)
      expect(day).toBeGreaterThanOrEqual(1)
      expect(day).toBeLessThanOrEqual(28)
    }
  })

  it('姓名/性别/手机号/邮箱形态', () => {
    for (let i = 0; i < 200; i++) {
      const r = generateRecord(['name', 'gender', 'phone', 'email'], rng())
      expect(r.name).toMatch(/^[\u4e00-\u9fa5]{2,4}$/)
      expect(r.gender === '男' || r.gender === '女').toBe(true)
      expect(r.phone).toMatch(/^1[3-9]\d{9}$/)
      expect(r.email).toMatch(/^[a-z0-9._]+@[a-z0-9.-]+\.[a-z]+$/)
    }
  })

  it('地址含行政区划+路号+门牌，公司名以公司后缀结尾', () => {
    for (let i = 0; i < 200; i++) {
      const r = generateRecord(['address', 'company', 'job'], rng())
      expect(r.address).toMatch(/(省|市|自治区)/)
      expect(r.address).toMatch(/(路|街|道)\d+号/)
      expect(r.address).toMatch(/\d+栋\d+单元\d+室/)
      expect(r.company).toMatch(/(有限公司|股份有限公司)$/)
      expect(r.job).toMatch(/^[\u4e00-\u9fa5A-Za-z ]+$/)
    }
  })

  it('时间在 2000-2030 且格式正确，金额两位小数', () => {
    for (let i = 0; i < 200; i++) {
      const r = generateRecord(['datetime', 'amount'], rng())
      expect(r.datetime).toMatch(/^20(0\d|1\d|2\d|30)-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      const y = Number(r.datetime.slice(0, 4))
      expect(y).toBeGreaterThanOrEqual(2000)
      expect(y).toBeLessThanOrEqual(2030)
      expect(r.amount).toMatch(/^\d+\.\d{2}$/)
    }
  })

  it('用户名/密码/IP/网址/UUID 形态与强度', () => {
    for (let i = 0; i < 200; i++) {
      const r = generateRecord(['username', 'password', 'ip', 'url', 'uuid'], rng())
      expect(r.username).toMatch(/^[a-z]{5,10}\d{0,4}$/)
      expect(r.password).toMatch(/^[A-Za-z0-9!@#$%^&*]{10,16}$/)
      expect(r.password).toMatch(/[a-z]/)
      expect(r.password).toMatch(/[A-Z]/)
      expect(r.password).toMatch(/\d/)
      expect(r.password).toMatch(/[!@#$%^&*]/)
      const octets = r.ip.split('.').map(Number)
      expect(octets).toHaveLength(4)
      expect(octets.every((o) => o >= 0 && o <= 255)).toBe(true)
      expect(octets[0]).toBeGreaterThanOrEqual(1)
      expect(octets[0]).toBeLessThanOrEqual(223)
      expect(r.url).toMatch(/^https:\/\/www\.[a-z0-9-]+\.[a-z]{2,3}\/[a-z0-9./_-]+$/)
      expect(r.uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  it('批量 100 个 UUID 全不重复', () => {
    const r = createRng(5)
    const list = Array.from({ length: 100 }, () => uuidV4(r))
    expect(new Set(list).size).toBe(100)
  })

  it('generateRecord 只含勾选字段且键序跟随 FIELD_DEFS', () => {
    const r = generateRecord(['url', 'name', 'phone'], rng())
    expect(Object.keys(r)).toEqual(['name', 'phone', 'url'])
  })

  it('generateBatch 条数钳制在 1-100', () => {
    const r = createRng(3)
    expect(generateBatch(ALL_IDS, 100, r)).toHaveLength(100)
    expect(generateBatch(ALL_IDS, 101, r)).toHaveLength(100)
    expect(generateBatch(ALL_IDS, 0, r)).toHaveLength(1)
    expect(generateBatch(ALL_IDS, -5, r)).toHaveLength(1)
    expect(generateBatch(ALL_IDS, 1.9, r)).toHaveLength(1)
  })

  it('clampCount 非法输入回 1，正常值闭区间钳制', () => {
    expect(clampCount(Number.NaN)).toBe(1)
    expect(clampCount(Number.POSITIVE_INFINITY)).toBe(1)
    expect(clampCount(50)).toBe(50)
    expect(clampCount(101)).toBe(100)
  })

  it('FIELD_DEFS 元数据完整：id 唯一、label 中文、默认字段均存在', () => {
    expect(new Set(FIELD_DEFS.map((f) => f.id)).size).toBe(FIELD_DEFS.length)
    for (const f of FIELD_DEFS) expect(f.label).toMatch(/^[\u4e00-\u9fa5A-Za-z ]+$/)
    for (const id of DEFAULT_FIELD_IDS) expect(fieldById(id)).toBeDefined()
    // 需求点名的常用字段全部覆盖
    for (const id of ['name', 'phone', 'email', 'idcard', 'address', 'company', 'datetime', 'amount']) {
      expect(fieldById(id)).toBeDefined()
    }
  })
})
