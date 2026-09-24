import { chance, pick, randInt, randomDigits, randomLetters, type Rng } from './random'
import {
  COMPANY_BRANDS,
  COMPANY_CITY_PREFIXES,
  COMPANY_INDUSTRIES,
  COMPANY_SUFFIXES,
  EMAIL_DOMAINS,
  ESTATES,
  GENDERS,
  GIVEN_CHARS,
  ID_AREAS,
  JOBS,
  PHONE_PREFIXES,
  REGIONS,
  STREETS,
  SURNAMES,
  URL_PATHS,
  URL_TLDS,
  URL_WORDS
} from './dict'

export interface FieldDef {
  id: string
  label: string
  gen(rng: Rng, record: Record<string, string>): string
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

// ---- 身份证（GB 11643-1999 校验位） ----
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const
const ID_CHECK_CHARS = '10X98765432'

/** 由前 17 位算第 18 位校验码（测试里用独立实现交叉验证） */
export function idCheckDigit(body17: string): string {
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(body17[i]) * ID_WEIGHTS[i]
  return ID_CHECK_CHARS[sum % 11]
}

export function isValidIdCard(id: string): boolean {
  if (!/^\d{17}[\dX]$/.test(id)) return false
  return idCheckDigit(id.slice(0, 17)) === id[17]
}

function genIdCard(rng: Rng): string {
  const area = pick(rng, ID_AREAS)
  // 日上限取 28，规避大小月合法性判断（假数据够用）
  const year = randInt(rng, 1950, 2005)
  const month = randInt(rng, 1, 12)
  const day = randInt(rng, 1, 28)
  const seq = pad(randInt(rng, 1, 999), 3)
  const body = `${area}${year}${pad(month)}${pad(day)}${seq}`
  return body + idCheckDigit(body)
}

function genAddress(rng: Rng): string {
  const r = pick(rng, REGIONS)
  const street = `${pick(rng, STREETS)}${randInt(rng, 1, 999)}号`
  const estate = `${pick(rng, ESTATES)}${randInt(rng, 1, 30)}栋${randInt(rng, 1, 6)}单元${randInt(rng, 101, 3204)}室`
  return `${r.p}${r.c}${r.d}${street}${estate}`
}

function genCompany(rng: Rng): string {
  const prefix = chance(rng, 0.7) ? pick(rng, COMPANY_CITY_PREFIXES) : ''
  return `${prefix}${pick(rng, COMPANY_BRANDS)}${pick(rng, COMPANY_INDUSTRIES)}${pick(rng, COMPANY_SUFFIXES)}`
}

function genDatetime(rng: Rng): string {
  // 用 UTC 拼，避免测试机器时区影响格式
  const ts = randInt(rng, Date.UTC(2000, 0, 1), Date.UTC(2030, 11, 31, 23, 59, 59))
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

function genAmount(rng: Rng): string {
  return (randInt(rng, 1, 9_999_999) / 100).toFixed(2)
}

function genPassword(rng: Rng): string {
  const lowers = 'abcdefghijkmnpqrstuvwxyz'
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const digits = '23456789'
  const symbols = '!@#$%^&*'
  const all = lowers + uppers + digits + symbols
  const len = randInt(rng, 10, 16)
  // 各类至少一枚再随机补齐，保证强度下限
  const chars = [
    lowers[randInt(rng, 0, lowers.length - 1)],
    uppers[randInt(rng, 0, uppers.length - 1)],
    digits[randInt(rng, 0, digits.length - 1)],
    symbols[randInt(rng, 0, symbols.length - 1)]
  ]
  for (let i = chars.length; i < len; i++) chars.push(all[randInt(rng, 0, all.length - 1)])
  // Fisher-Yates 打乱，避免前四位固定是四类各一
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

export function uuidV4(rng: Rng): string {
  const hex = '0123456789abcdef'
  let s = ''
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'
    else if (i === 14) s += '4'
    else if (i === 19) s += hex[8 + Math.floor(rng() * 4)]
    else s += hex[Math.floor(rng() * 16)]
  }
  return s
}

function genEmail(rng: Rng): string {
  return `${randomLetters(rng, 6, 12)}${chance(rng, 0.7) ? randomDigits(rng, randInt(rng, 1, 4)) : ''}@${pick(rng, EMAIL_DOMAINS)}`
}

function genIp(rng: Rng): string {
  return `${randInt(rng, 1, 223)}.${randInt(rng, 0, 255)}.${randInt(rng, 0, 255)}.${randInt(rng, 1, 254)}`
}

function genUrl(rng: Rng): string {
  return `https://www.${pick(rng, URL_WORDS)}${chance(rng, 0.3) ? randomDigits(rng, randInt(rng, 1, 3)) : ''}.${pick(rng, URL_TLDS)}/${pick(rng, URL_PATHS)}`
}

export const FIELD_DEFS: readonly FieldDef[] = [
  { id: 'name', label: '姓名', gen: (rng) => `${pick(rng, SURNAMES)}${pick(rng, GIVEN_CHARS)}${chance(rng, 0.55) ? pick(rng, GIVEN_CHARS) : ''}` },
  { id: 'gender', label: '性别', gen: (rng) => pick(rng, GENDERS) },
  { id: 'phone', label: '手机号', gen: (rng) => `${pick(rng, PHONE_PREFIXES)}${randomDigits(rng, 8)}` },
  { id: 'idcard', label: '身份证号', gen: (rng) => genIdCard(rng) },
  { id: 'email', label: '邮箱', gen: (rng) => genEmail(rng) },
  { id: 'address', label: '地址', gen: (rng) => genAddress(rng) },
  { id: 'company', label: '公司名', gen: (rng) => genCompany(rng) },
  { id: 'job', label: '职位', gen: (rng) => pick(rng, JOBS) },
  { id: 'datetime', label: '时间', gen: (rng) => genDatetime(rng) },
  { id: 'amount', label: '金额', gen: (rng) => genAmount(rng) },
  { id: 'username', label: '用户名', gen: (rng) => `${randomLetters(rng, 5, 10)}${chance(rng, 0.7) ? randomDigits(rng, randInt(rng, 2, 4)) : ''}` },
  { id: 'password', label: '密码', gen: (rng) => genPassword(rng) },
  { id: 'uuid', label: 'UUID', gen: (rng) => uuidV4(rng) },
  { id: 'ip', label: 'IP 地址', gen: (rng) => genIp(rng) },
  { id: 'url', label: '网址', gen: (rng) => genUrl(rng) }
]

export const DEFAULT_FIELD_IDS: readonly string[] = ['name', 'gender', 'phone', 'idcard', 'email']

export function fieldById(id: string): FieldDef | undefined {
  return FIELD_DEFS.find((f) => f.id === id)
}

/** 全量字段 id（模板合法性过滤用） */
export function allFieldIds(): string[] {
  return FIELD_DEFS.map((f) => f.id)
}

/** 单条记录：按 FIELD_DEFS 固定顺序生成勾选字段，value 均为字符串 */
export function generateRecord(fieldIds: readonly string[], rng: Rng): Record<string, string> {
  const wanted = new Set(fieldIds)
  const record: Record<string, string> = {}
  for (const def of FIELD_DEFS) {
    if (wanted.has(def.id)) record[def.id] = def.gen(rng, record)
  }
  return record
}

export const MAX_BATCH = 100

export function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.max(1, Math.min(MAX_BATCH, Math.floor(n)))
}

export function generateBatch(fieldIds: readonly string[], count: number, rng: Rng): Record<string, string>[] {
  const n = clampCount(count)
  return Array.from({ length: n }, () => generateRecord(fieldIds, rng))
}
