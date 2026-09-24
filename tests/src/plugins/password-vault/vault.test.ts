import { describe, expect, it } from 'vitest'
import {
  MIN_ITERATIONS,
  PBKDF2_ITERATIONS,
  base64ToBytes,
  bytesToBase64,
  deriveVaultKey,
  encodeJson,
  randomBytes,
  sealVault
} from '../../../../src/plugins/password-vault/logic/crypto'
import {
  VAULT_FORMAT,
  VAULT_STORAGE_KEY,
  VAULT_VERSION,
  createVaultFile,
  filterEntries,
  normalizeEntryInput,
  openVaultFile,
  parseVaultFile,
  removeEntry,
  saveVaultFile,
  upsertEntry
} from '../../../../src/plugins/password-vault/logic/vault'
import type { VaultEntry, VaultFile } from '../../../../src/plugins/password-vault/logic/vault'

function entry(p: Partial<VaultEntry> = {}): VaultEntry {
  return {
    id: p.id ?? 'id-1',
    site: p.site ?? 'site',
    username: p.username ?? 'user',
    password: p.password ?? 'pw',
    notes: p.notes ?? '',
    createdAt: p.createdAt ?? 1000,
    updatedAt: p.updatedAt ?? 1000
  }
}

function validFile(over: Partial<VaultFile> = {}): VaultFile {
  return {
    format: 'gtools-password-vault',
    version: VAULT_VERSION,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: MIN_ITERATIONS, salt: bytesToBase64(randomBytes(16)) },
    iv: bytesToBase64(randomBytes(12)),
    data: bytesToBase64(randomBytes(48)),
    ...over
  }
}

describe('parseVaultFile', () => {
  it('合法信封通过且字段归一', () => {
    const f = validFile()
    expect(parseVaultFile(f)).toEqual(f)
  })
  it('非对象 / format / version 非法拒绝', () => {
    expect(parseVaultFile(null)).toBeNull()
    expect(parseVaultFile('x')).toBeNull()
    expect(parseVaultFile(validFile({ format: 'other' as typeof VAULT_FORMAT }))).toBeNull()
    expect(parseVaultFile(validFile({ version: 2 }))).toBeNull()
  })
  it('kdf 字段非法拒绝（算法、hash、迭代数越界/非整数、盐过短/非法）', () => {
    expect(parseVaultFile(validFile({ kdf: { ...validFile().kdf, name: 'Argon2' as 'PBKDF2' } }))).toBeNull()
    expect(parseVaultFile(validFile({ kdf: { ...validFile().kdf, hash: 'SHA-1' as 'SHA-256' } }))).toBeNull()
    expect(parseVaultFile(validFile({ kdf: { ...validFile().kdf, iterations: 1000 } }))).toBeNull()
    expect(parseVaultFile(validFile({ kdf: { ...validFile().kdf, iterations: 100_000_000 } }))).toBeNull()
    expect(parseVaultFile(validFile({ kdf: { ...validFile().kdf, iterations: 60000.5 } }))).toBeNull()
    expect(parseVaultFile(validFile({ kdf: { ...validFile().kdf, salt: bytesToBase64(randomBytes(4)) } }))).toBeNull()
    expect(parseVaultFile(validFile({ kdf: { ...validFile().kdf, salt: '%%%' } }))).toBeNull()
  })
  it('iv 必须 12 字节、data 必须非空且为合法 base64', () => {
    expect(parseVaultFile(validFile({ iv: bytesToBase64(randomBytes(16)) }))).toBeNull()
    expect(parseVaultFile(validFile({ data: '' }))).toBeNull()
    expect(parseVaultFile(validFile({ data: '###' }))).toBeNull()
  })
})

describe('创建 / 解锁 / 保存', () => {
  it('创建→解锁 roundtrip（快迭代）', async () => {
    const es = [entry({ site: 'github.com', username: 'a', password: 's3cret' }), entry({ id: 'e2', site: '码农站', password: '', notes: '只有备注' })]
    const { file, key } = await createVaultFile('主密码', es, MIN_ITERATIONS)
    expect(parseVaultFile(file)).toEqual(file)
    const opened = await openVaultFile('主密码', file)
    expect(opened.entries).toEqual(es)
    expect(key).toBeDefined()
  })

  it('缺省参数（600k 迭代）创建与解锁可用', async () => {
    const { file } = await createVaultFile('pw', [entry({ site: 'x' })], PBKDF2_ITERATIONS)
    await expect(openVaultFile('pw', file)).resolves.toMatchObject({ entries: [expect.objectContaining({ site: 'x' })] })
  })

  it('错误主密码抛 BAD_MASTER，正确密码可用', async () => {
    const { file } = await createVaultFile('right', [entry()], MIN_ITERATIONS)
    await expect(openVaultFile('wrong', file)).rejects.toMatchObject({ code: 'BAD_MASTER' })
    await expect(openVaultFile('right', file)).resolves.toMatchObject({ entries: [entry()] })
  })

  it('saveVaultFile 复用密钥：保留 kdf、换新 IV、新密文可用原主密码解锁', async () => {
    const { file, key } = await createVaultFile('pw', [entry({ site: 'a' })], MIN_ITERATIONS)
    const next = await saveVaultFile(key, file, [entry({ site: 'b' }), entry({ site: 'c' })])
    expect(next.kdf).toEqual(file.kdf)
    expect(next.iv).not.toBe(file.iv)
    const re = await openVaultFile('pw', next)
    expect(re.entries.map((e) => e.site)).toEqual(['b', 'c'])
  })

  it('解密成功但 payload 结构损坏报 CORRUPT', async () => {
    const { file } = await createVaultFile('pw', [], MIN_ITERATIONS)
    const k = await deriveVaultKey('pw', base64ToBytes(file.kdf.salt)!, file.kdf.iterations)
    const sealed = await sealVault(k, encodeJson({ nope: 1 }))
    await expect(openVaultFile('pw', { ...file, iv: sealed.iv, data: sealed.data })).rejects.toMatchObject({ code: 'CORRUPT' })
  })
})

describe('条目操作', () => {
  const es = [
    entry({ id: '1', site: 'GitHub', username: 'octocat', notes: '工作号', updatedAt: 3000 }),
    entry({ id: '2', site: 'example.com', username: 'test@example.com', updatedAt: 2000 }),
    entry({ id: '3', site: '豆瓣', username: 'douban-user', notes: 'GITHUB 关联', updatedAt: 1000 })
  ]

  it('filterEntries：空查询原样返回；大小写不敏感命中 站点/用户名/备注；保持原顺序', () => {
    expect(filterEntries(es, '  ')).toEqual(es)
    expect(filterEntries(es, 'github').map((e) => e.id)).toEqual(['1', '3'])
    expect(filterEntries(es, 'OCTOCAT').map((e) => e.id)).toEqual(['1'])
    expect(filterEntries(es, 'example.com').map((e) => e.id)).toEqual(['2'])
    expect(filterEntries(es, '工作').map((e) => e.id)).toEqual(['1'])
    expect(filterEntries(es, '不存在')).toEqual([])
  })

  it('normalizeEntryInput：trim、超长截断；站点与用户名全空返回 null；密码允许为空', () => {
    expect(normalizeEntryInput({ site: '  x ', username: '', password: '', notes: ' n ' })).toEqual({
      site: 'x', username: '', password: '', notes: 'n'
    })
    expect(normalizeEntryInput({ site: '', username: ' ', password: 'p', notes: '' })).toBeNull()
    const long = 'a'.repeat(500)
    expect(normalizeEntryInput({ site: long, username: '', password: 'b'.repeat(5000), notes: long })).toEqual({
      site: 'a'.repeat(200), username: '', password: 'b'.repeat(4096), notes: 'a'.repeat(500)
    })
  })

  it('upsertEntry 新增：新 id、置顶、双空输入返回 null', () => {
    const next = upsertEntry(es, { site: '新站', username: 'u', password: 'p', notes: '' }, null, 9000)
    expect(next).not.toBeNull()
    expect(next![0]).toMatchObject({ site: '新站', createdAt: 9000, updatedAt: 9000 })
    expect(next!.map((e) => e.id)).toEqual([next![0]!.id, '1', '2', '3'])
    expect(upsertEntry(es, { site: '', username: '', password: '', notes: '' }, null, 9000)).toBeNull()
  })

  it('upsertEntry 编辑：保 id/createdAt、更新 updatedAt、置顶', () => {
    const next = upsertEntry(es, { site: 'GitHub2', username: 'octocat', password: 'p2', notes: '' }, '1', 9000)
    expect(next![0]).toMatchObject({ id: '1', site: 'GitHub2', createdAt: 1000, updatedAt: 9000 })
    expect(next!.map((e) => e.id)).toEqual(['1', '2', '3'])
  })

  it('removeEntry 删除目标', () => {
    expect(removeEntry(es, '2').map((e) => e.id)).toEqual(['1', '3'])
    expect(removeEntry(es, 'nope')).toEqual(es)
  })

  it('VAULT_STORAGE_KEY 为简单键名（storage 按插件隔离）', () => {
    expect(VAULT_STORAGE_KEY).toBe('vault')
  })
})
