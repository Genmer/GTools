// 保险库文件格式与条目操作：格式校验宽容读取、严格写入；条目按 updatedAt 倒序（最近编辑在前）
import {
  MAX_ITERATIONS,
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
} from './crypto'
import type { VaultKey } from './crypto'

export const VAULT_FORMAT = 'gtools-password-vault'
export const VAULT_VERSION = 1
export const VAULT_STORAGE_KEY = 'vault'

export interface VaultEntry {
  id: string
  site: string
  username: string
  password: string
  notes: string
  createdAt: number
  updatedAt: number
}

export interface VaultKdfParams {
  name: 'PBKDF2'
  hash: 'SHA-256'
  iterations: number
  salt: string
}

export interface VaultFile {
  format: typeof VAULT_FORMAT
  version: number
  kdf: VaultKdfParams
  iv: string
  data: string
}

const FIELD_MAX: Record<'site' | 'username' | 'password' | 'notes', number> = {
  site: 200,
  username: 200,
  password: 4096,
  notes: 8192
}

/** 严格校验存储里的密文库信封；任何字段非法返回 null（绝不抛异常） */
export function parseVaultFile(raw: unknown): VaultFile | null {
  if (typeof raw !== 'object' || raw === null) return null
  const f = raw as Record<string, unknown>
  if (f.format !== VAULT_FORMAT) return null
  if (f.version !== VAULT_VERSION) return null
  const k = f.kdf
  if (typeof k !== 'object' || k === null) return null
  const kdf = k as Record<string, unknown>
  if (kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256') return null
  const iterations = kdf.iterations
  if (
    typeof iterations !== 'number' ||
    !Number.isInteger(iterations) ||
    iterations < MIN_ITERATIONS ||
    iterations > MAX_ITERATIONS
  ) {
    return null
  }
  if (typeof kdf.salt !== 'string') return null
  const salt = base64ToBytes(kdf.salt)
  if (salt === null || salt.length < 8 || salt.length > 64) return null
  if (typeof f.iv !== 'string' || typeof f.data !== 'string' || f.data === '') return null
  const iv = base64ToBytes(f.iv)
  if (iv === null || iv.length !== 12) return null
  if (base64ToBytes(f.data) === null) return null
  return { format: VAULT_FORMAT, version: VAULT_VERSION, kdf: { ...kdf, iterations }, iv: f.iv, data: f.data } as VaultFile
}

/** 解密后的明文 payload 校验；整体结构非法返回 null，单条损坏丢弃该条（宽容读取，宁可少读不可全丢） */
export function parseEntries(payload: unknown): VaultEntry[] | null {
  if (typeof payload !== 'object' || payload === null) return null
  const arr = (payload as { entries?: unknown }).entries
  if (!Array.isArray(arr)) return null
  const out: VaultEntry[] = []
  for (const item of arr) {
    const e = parseEntry(item)
    if (e !== null) out.push(e)
  }
  return out
}

function parseEntry(item: unknown): VaultEntry | null {
  if (typeof item !== 'object' || item === null) return null
  const e = item as Record<string, unknown>
  if (
    typeof e.id !== 'string' ||
    e.id === '' ||
    typeof e.site !== 'string' ||
    typeof e.username !== 'string' ||
    typeof e.password !== 'string' ||
    typeof e.notes !== 'string' ||
    typeof e.createdAt !== 'number' ||
    typeof e.updatedAt !== 'number'
  ) {
    return null
  }
  return {
    id: e.id,
    site: e.site.slice(0, FIELD_MAX.site),
    username: e.username.slice(0, FIELD_MAX.username),
    password: e.password.slice(0, FIELD_MAX.password),
    notes: e.notes.slice(0, FIELD_MAX.notes),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt
  }
}

export function newEntryId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${randomBytes(6).length.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  )
}

/** 新建加密库（首次设置主密码）：随机盐 + 新派生密钥 */
export async function createVaultFile(
  password: string,
  entries: VaultEntry[],
  iterations: number = PBKDF2_ITERATIONS
): Promise<{ file: VaultFile; key: VaultKey }> {
  const salt = randomBytes(SALT_BYTES)
  const key = await deriveVaultKey(password, salt, iterations)
  const sealed = await sealVault(key, encodeJson({ entries }))
  return {
    file: {
      format: VAULT_FORMAT,
      version: VAULT_VERSION,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: bytesToBase64(salt) },
      iv: sealed.iv,
      data: sealed.data
    },
    key
  }
}

/** 用主密码解锁：派生密钥 + 解密 + 解析条目；失败抛 VaultError */
export async function openVaultFile(
  password: string,
  file: VaultFile
): Promise<{ key: VaultKey; entries: VaultEntry[] }> {
  const salt = base64ToBytes(file.kdf.salt)
  if (salt === null) throw new VaultError('CORRUPT', '库文件盐值非法')
  const key = await deriveVaultKey(password, salt, file.kdf.iterations)
  const plaintext = await openSealed(key, file.iv, file.data)
  const entries = parseEntries(decodeJsonText(plaintext))
  if (entries === null) throw new VaultError('CORRUPT', '库内数据结构损坏')
  return { key, entries }
}

/** 保存：复用已派生密钥（免再跑 PBKDF2），保留 kdf 参数、换新 IV */
export async function saveVaultFile(
  key: VaultKey,
  file: VaultFile,
  entries: VaultEntry[]
): Promise<VaultFile> {
  const sealed = await sealVault(key, encodeJson({ entries }))
  return { ...file, iv: sealed.iv, data: sealed.data }
}

/** 大小写不敏感子串过滤（站点/用户名/备注），保持 updatedAt 倒序 */
export function filterEntries(entries: readonly VaultEntry[], query: string): VaultEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...entries]
  return entries.filter(
    (e) =>
      e.site.toLowerCase().includes(q) ||
      e.username.toLowerCase().includes(q) ||
      e.notes.toLowerCase().includes(q)
  )
}

/** 编辑器输入归一：trim + 截断；站点与用户名至少一项非空才有效 */
export function normalizeEntryInput(input: {
  site: string
  username: string
  password: string
  notes: string
}): { site: string; username: string; password: string; notes: string } | null {
  const site = input.site.trim().slice(0, FIELD_MAX.site)
  const username = input.username.trim().slice(0, FIELD_MAX.username)
  // 密码不 trim：前后空格可能是密码的一部分
  const password = input.password.slice(0, FIELD_MAX.password)
  const notes = input.notes.trim().slice(0, FIELD_MAX.notes)
  if (site === '' && username === '') return null
  return { site, username, password, notes }
}

/** 新增或更新条目：更新保持 id/createdAt；结果按 updatedAt 倒序（编辑过的顶到最前）。输入无效返回 null */
export function upsertEntry(
  entries: readonly VaultEntry[],
  input: { site: string; username: string; password: string; notes: string },
  editingId: string | null,
  now: number
): VaultEntry[] | null {
  const normalized = normalizeEntryInput(input)
  if (normalized === null) return null
  const next: VaultEntry[] = []
  let saved: VaultEntry | null = null
  for (const e of entries) {
    if (editingId !== null && e.id === editingId) saved = { ...e, ...normalized, updatedAt: now }
    else next.push(e)
  }
  if (saved === null) saved = { id: newEntryId(), ...normalized, createdAt: now, updatedAt: now }
  next.unshift(saved)
  return next
}

export function removeEntry(entries: readonly VaultEntry[], id: string): VaultEntry[] {
  return entries.filter((e) => e.id !== id)
}
