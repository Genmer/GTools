// 非明文插件偏好（自动上锁时长、生成器选项）——不含任何机密，与加密库分开存放
import { DEFAULT_GENERATOR_OPTIONS, normalizeGeneratorOptions } from './generator'
import type { GeneratorOptions } from './generator'
import { normalizeAutoLockMinutes } from './idle-lock'
import type { AutoLockChoice } from './idle-lock'

export const PREFS_STORAGE_KEY = 'prefs'

export interface VaultPrefs {
  autoLockMin: AutoLockChoice
  gen: GeneratorOptions
}

export const DEFAULT_PREFS: VaultPrefs = {
  autoLockMin: 5,
  gen: { ...DEFAULT_GENERATOR_OPTIONS }
}

export function normalizePrefs(raw: unknown): VaultPrefs {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<VaultPrefs>
  return {
    autoLockMin: normalizeAutoLockMinutes(o.autoLockMin),
    gen: normalizeGeneratorOptions(o.gen)
  }
}
