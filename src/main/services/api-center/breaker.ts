/** 每引擎独立熔断：auth/quota/http 类失败后冷却 120s，期间该引擎不进容灾候选
 *  （显式指定 providerId 仍直连不受限；全候选熔断时忽略熔断硬试兜底） */
export class ProviderBreaker {
  private readonly tripped = new Map<string, { until: number; reason: string }>()

  constructor(
    private readonly now: () => number = Date.now,
    private readonly cooldownMs = 120_000
  ) {}

  trip(id: string, reason: string): void {
    this.tripped.set(id, { until: this.now() + this.cooldownMs, reason })
  }

  isOpen(id: string): boolean {
    const t = this.tripped.get(id)
    if (t === undefined) return false
    if (this.now() >= t.until) {
      this.tripped.delete(id)
      return false
    }
    return true
  }

  lastReason(id: string): string | null {
    return this.tripped.get(id)?.reason ?? null
  }

  clear(id: string): void {
    this.tripped.delete(id)
  }

  /** 备份导入整体换配置后清空：熔断记录按 provider id 存，同 id 新配置（已换 endpoint/key）不该继承旧冷却 */
  reset(): void {
    this.tripped.clear()
  }
}
