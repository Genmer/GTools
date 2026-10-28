// 剪贴板敏感指纹豁免表：宿主自己经 writeTextEphemeral 写入的敏感内容（vault 密码/用户名），
// 在 TTL 内不被两个采集器（clipboard 插件 backend + 主进程 ClipboardHistoryService）采进历史。
// 正则检测拦不住任意形态的密码，故用「写入时登记指纹、采集时查指纹」的闭环。

/** 40s = vault CLEAR_DELAY_MS(30s，见 src/plugins/password-vault/logic/clipboard-clear.ts) + 10s 缓冲，覆盖清除前全部 1s 轮询周期；改 vault 延时须同步这里 */
export const EXEMPT_DEFAULT_TTL_MS = 40_000

export type Sha256Hex = (text: string) => string

export interface ClipboardExemptions {
  /** 登记文本指纹，ttlMs 缺省用 EXEMPT_DEFAULT_TTL_MS；空串无意义不登记 */
  register(text: string, ttlMs?: number): void
  isExempted(text: string): boolean
  /** 当前登记条数（含尚未被查询清理的过期项），测试观察惰性清理用 */
  size(): number
}

export function createClipboardExemptions(hash: Sha256Hex): ClipboardExemptions {
  const expiresAt = new Map<string, number>()
  return {
    register(text, ttlMs) {
      if (text === '') return
      const ttl = typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : EXEMPT_DEFAULT_TTL_MS
      expiresAt.set(hash(text), Date.now() + ttl)
    },
    isExempted(text) {
      if (text === '') return false
      const key = hash(text)
      const deadline = expiresAt.get(key)
      if (deadline === undefined) return false
      if (deadline <= Date.now()) {
        expiresAt.delete(key) // 惰性清理：查询即删除过期项，无需定时器
        return false
      }
      return true
    },
    size() {
      return expiresAt.size
    }
  }
}
