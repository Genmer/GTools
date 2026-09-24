// 保险库加密原语：PBKDF2-SHA256 派生 AES-256-GCM 密钥，整库单密文 blob（vault 体量小，无需逐条加密）

export const PBKDF2_ITERATIONS = 600_000
export const MIN_ITERATIONS = 50_000
export const MAX_ITERATIONS = 10_000_000
export const SALT_BYTES = 16
export const IV_BYTES = 12

export type VaultErrorCode = 'BAD_MASTER' | 'CORRUPT'

export class VaultError extends Error {
  constructor(readonly code: VaultErrorCode, message: string) {
    super(message)
    this.name = 'VaultError'
  }
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

// 非法 base64 返回 null（存储可能被外部改动，解析不得抛异常）
export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

// 测试跑在无 DOM lib 的 tsc 上下文（tsconfig.node.json），CryptoKey/SubtleCrypto 无全局名，
// 自带结构等价最小类型（DOM 与 node webcrypto 的实现都满足）
export interface VaultKey {
  readonly type: string
  readonly extractable: boolean
  readonly algorithm: { name: string }
  readonly usages: readonly string[]
}

interface SubtleLike {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: 'PBKDF2',
    extractable: false,
    usages: ['deriveKey']
  ): Promise<VaultKey>
  deriveKey(
    algorithm: { name: 'PBKDF2'; hash: 'SHA-256'; salt: Uint8Array; iterations: number },
    baseKey: VaultKey,
    derivedKeyType: { name: 'AES-GCM'; length: 256 },
    extractable: false,
    usages: ['encrypt', 'decrypt']
  ): Promise<VaultKey>
  encrypt(
    algorithm: { name: 'AES-GCM'; iv: Uint8Array },
    key: VaultKey,
    plaintext: Uint8Array
  ): Promise<ArrayBuffer>
  decrypt(
    algorithm: { name: 'AES-GCM'; iv: Uint8Array },
    key: VaultKey,
    ciphertext: Uint8Array
  ): Promise<ArrayBuffer>
}

function subtle(): SubtleLike {
  const s = globalThis.crypto?.subtle
  if (s === undefined) throw new VaultError('CORRUPT', '当前环境无 WebCrypto（crypto.subtle）')
  return s as unknown as SubtleLike
}

// 密码先做 NFKC 归一，保证同密码在任何输入法/平台派生出同一密钥
export async function deriveVaultKey(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<VaultKey> {
  const material = await subtle().importKey(
    'raw',
    textEncoder.encode(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// 整库加密；每次落盘都换新 IV（GCM 同 key+IV 复用是灾难性的）
export async function sealVault(
  key: VaultKey,
  plaintext: Uint8Array
): Promise<{ iv: string; data: string }> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(ct)) }
}

// 解密失败无法区分「主密码错」与「密文被改」（GCM 认证一并失败），统一报 BAD_MASTER 由上层提示
export async function openSealed(key: VaultKey, ivB64: string, dataB64: string): Promise<Uint8Array> {
  const iv = base64ToBytes(ivB64)
  const data = base64ToBytes(dataB64)
  if (iv === null || data === null) throw new VaultError('CORRUPT', '密文 base64 非法')
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv }, key, data)
    return new Uint8Array(pt)
  } catch (err) {
    if (err instanceof VaultError) throw err
    throw new VaultError('BAD_MASTER', '主密码错误或数据已损坏')
  }
}

export function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

export function encodeJson(v: unknown): Uint8Array {
  return textEncoder.encode(JSON.stringify(v))
}

export function decodeJsonText(bytes: Uint8Array): unknown {
  return JSON.parse(textDecoder.decode(bytes)) as unknown
}
