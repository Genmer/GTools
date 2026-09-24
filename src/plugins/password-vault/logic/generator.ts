// 随机密码生成器：crypto.getRandomValues 拒绝采样（无取模偏差），每类至少 1 字符后整体洗牌
export interface GeneratorOptions {
  length: number
  lowercase: boolean
  uppercase: boolean
  digits: boolean
  symbols: boolean
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  length: 16,
  lowercase: true,
  uppercase: true,
  digits: true,
  symbols: true
}

export const MIN_PASSWORD_LENGTH = 4
export const MAX_PASSWORD_LENGTH = 128

// 去掉引号/反斜杠/反引号/竖线等易在 shell 与表单里惹麻烦的可打印符号
export const SYMBOL_CHARS = '!@#$%^&*()-_=+[]{}<>?.,;:~'
const LOWER_CHARS = 'abcdefghijklmnopqrstuvwxyz'
const UPPER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGIT_CHARS = '0123456789'

/** [0, maxExclusive) 无偏随机整数；max 必须为正 */
export type RandomInt = (maxExclusive: number) => number

export const cryptoRandomInt: RandomInt = (maxExclusive) => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error('maxExclusive 必须为正整数')
  const limit = 0x1_0000_0000 - (0x1_0000_0000 % maxExclusive)
  for (;;) {
    const v = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
    if (v < limit) return v % maxExclusive
  }
}

/** 选项归一：长度夹取；无选项对象回默认；对象里全不勾回退为小写+数字（不允许生成空字符集） */
export function normalizeGeneratorOptions(raw: unknown): GeneratorOptions {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_GENERATOR_OPTIONS }
  const o = raw as Partial<GeneratorOptions>
  const length =
    typeof o.length === 'number' && Number.isFinite(o.length)
      ? Math.min(MAX_PASSWORD_LENGTH, Math.max(MIN_PASSWORD_LENGTH, Math.round(o.length)))
      : DEFAULT_GENERATOR_OPTIONS.length
  const lowercase = o.lowercase === true
  const uppercase = o.uppercase === true
  const digits = o.digits === true
  const symbols = o.symbols === true
  if (!lowercase && !uppercase && !digits && !symbols) {
    return { length, lowercase: true, uppercase: false, digits: true, symbols: false }
  }
  return { length, lowercase, uppercase, digits, symbols }
}

function pick(pool: string, randomInt: RandomInt): string {
  return pool.charAt(randomInt(pool.length))
}

export function generatePassword(opts: GeneratorOptions, randomInt: RandomInt = cryptoRandomInt): string {
  const pools: string[] = []
  if (opts.lowercase) pools.push(LOWER_CHARS)
  if (opts.uppercase) pools.push(UPPER_CHARS)
  if (opts.digits) pools.push(DIGIT_CHARS)
  if (opts.symbols) pools.push(SYMBOL_CHARS)
  if (pools.length === 0) return ''
  const all = pools.join('')
  const chars: string[] = pools.map((p) => pick(p, randomInt))
  while (chars.length < opts.length) chars.push(pick(all, randomInt))
  // 前段每类占位是确定性的，必须洗牌打散位置
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    const t = chars[i]
    chars[i] = chars[j]
    chars[j] = t
  }
  return chars.join('')
}
