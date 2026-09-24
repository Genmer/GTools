import { describe, expect, it } from 'vitest'
import {
  MIN_ITERATIONS,
  PBKDF2_ITERATIONS,
  SALT_BYTES,
  VaultError,
  base64ToBytes,
  bytesToBase64,
  decodeJsonText,
  deriveVaultKey,
  encodeJson,
  openSealed,
  randomBytes,
  sealVault
} from '../../../../src/plugins/password-vault/logic/crypto'
import type { VaultKey } from '../../../../src/plugins/password-vault/logic/crypto'

async function key(password: string, iterations: number = MIN_ITERATIONS): Promise<VaultKey> {
  return deriveVaultKey(password, randomBytes(SALT_BYTES), iterations)
}

describe('base64 助手', () => {
  it('任意字节 roundtrip', () => {
    for (let i = 0; i < 20; i++) {
      const b = randomBytes(1 + i * 7)
      const back = base64ToBytes(bytesToBase64(b))
      expect(back).not.toBeNull()
      expect([...back!]).toEqual([...b])
    }
  })
  it('非法 base64 返回 null 而非抛异常', () => {
    expect(base64ToBytes('%%%非法%%%')).toBeNull()
  })
})

describe('AES-GCM seal/open', () => {
  it('同密钥 roundtrip（含中文与 emoji）', async () => {
    const k = await key('主密码🔑')
    const sealed = await sealVault(k, encodeJson({ s: '站点', pw: 'p@ss🔥' }))
    const out = await openSealed(k, sealed.iv, sealed.data)
    expect(decodeJsonText(out)).toEqual({ s: '站点', pw: 'p@ss🔥' })
  })

  it('每次 seal 生成不同 IV（base64 形式非空且互异）', async () => {
    const k = await key('pw')
    const a = await sealVault(k, encodeJson([1]))
    const b = await sealVault(k, encodeJson([1]))
    expect(a.iv).not.toBe(b.iv)
    expect(base64ToBytes(a.iv)).not.toBeNull()
  })

  it('错误密钥解密抛 VaultError BAD_MASTER', async () => {
    const k1 = await key('right')
    const k2 = await key('wrong')
    const sealed = await sealVault(k1, encodeJson('secret'))
    await expect(openSealed(k2, sealed.iv, sealed.data)).rejects.toBeInstanceOf(VaultError)
    await expect(openSealed(k2, sealed.iv, sealed.data)).rejects.toMatchObject({ code: 'BAD_MASTER' })
  })

  it('密文或 IV 被篡改后解密失败', async () => {
    const k = await key('pw')
    const sealed = await sealVault(k, encodeJson('secret'))
    const bytes = base64ToBytes(sealed.data)!
    bytes[bytes.length - 1] ^= 0xff // 翻转 GCM 认证 tag 末字节
    const tampered = { ...sealed, data: bytesToBase64(bytes) }
    await expect(openSealed(k, tampered.iv, tampered.data)).rejects.toMatchObject({ code: 'BAD_MASTER' })
  })

  it('非法 base64 抛 CORRUPT', async () => {
    const k = await key('pw')
    await expect(openSealed(k, '!!!', '???')).rejects.toMatchObject({ code: 'CORRUPT' })
  })
})

describe('PBKDF2 派生', () => {
  it('同密码同盐同迭代派生可用密钥（可互解密）；缺省参数（600k）可用', async () => {
    const salt = randomBytes(SALT_BYTES)
    const k1 = await deriveVaultKey('pw', salt, MIN_ITERATIONS)
    const k2 = await deriveVaultKey('pw', salt, MIN_ITERATIONS)
    const sealed = await sealVault(k1, encodeJson('x'))
    await expect(openSealed(k2, sealed.iv, sealed.data)).resolves.toBeInstanceOf(Uint8Array)

    const realWorld = await deriveVaultKey('pw', salt, PBKDF2_ITERATIONS)
    const s2 = await sealVault(realWorld, encodeJson('y'))
    await expect(openSealed(realWorld, s2.iv, s2.data)).resolves.toBeInstanceOf(Uint8Array)
  })

  it('不同盐派生的密钥互不可解', async () => {
    const k1 = await deriveVaultKey('pw', randomBytes(SALT_BYTES), MIN_ITERATIONS)
    const k2 = await deriveVaultKey('pw', randomBytes(SALT_BYTES), MIN_ITERATIONS)
    const sealed = await sealVault(k1, encodeJson('x'))
    await expect(openSealed(k2, sealed.iv, sealed.data)).rejects.toBeInstanceOf(VaultError)
  })

  it('密码做 NFKC 归一：全角与半角等效输入派生同结果', async () => {
    const salt = randomBytes(SALT_BYTES)
    const k1 = await deriveVaultKey('ａｂｃ', salt, MIN_ITERATIONS)
    const k2 = await deriveVaultKey('ａｂｃ'.normalize('NFKC'), salt, MIN_ITERATIONS)
    const sealed = await sealVault(k1, encodeJson('x'))
    await expect(openSealed(k2, sealed.iv, sealed.data)).resolves.toBeInstanceOf(Uint8Array)
  })
})
