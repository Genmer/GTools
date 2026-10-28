import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXEMPT_DEFAULT_TTL_MS, createClipboardExemptions } from '../src/main/services/clipboard-exemptions'

// 豁免表为纯逻辑：hash 注入 fake（真 sha256 在 electron-services 侧接 node:crypto，不在单测引入）
const fakeHash = (t: string): string => `h:${t}`

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// 边界用例用 fake timer，断言失败也必须还原，否则后续真实 sleep 用例会挂死
afterEach(() => {
  vi.useRealTimers()
})

describe('createClipboardExemptions 敏感指纹豁免表', () => {
  it('登记后命中、未登记内容不命中', () => {
    const ex = createClipboardExemptions(fakeHash)
    ex.register('vault-pw')
    expect(ex.isExempted('vault-pw')).toBe(true)
    expect(ex.isExempted('别的内容')).toBe(false)
  })

  it('空串不登记也不命中（清空剪贴板的 writeText 路径无实害）', () => {
    const ex = createClipboardExemptions(fakeHash)
    ex.register('')
    expect(ex.size()).toBe(0)
    expect(ex.isExempted('')).toBe(false)
  })

  it('TTL 过期后不再命中', async () => {
    const ex = createClipboardExemptions(fakeHash)
    ex.register('pw', 20)
    expect(ex.isExempted('pw')).toBe(true)
    await sleep(40)
    expect(ex.isExempted('pw')).toBe(false)
  })

  it('过期项惰性清理：过期后条目仍在，查询命中失败时才删除', async () => {
    const ex = createClipboardExemptions(fakeHash)
    ex.register('pw', 20)
    await sleep(40)
    expect(ex.size()).toBe(1) // 无定时器，不主动清
    expect(ex.isExempted('pw')).toBe(false)
    expect(ex.size()).toBe(0) // 查询即删
  })

  it('过期后重新登记同文本：新 TTL 生效', async () => {
    const ex = createClipboardExemptions(fakeHash)
    ex.register('pw', 20)
    await sleep(40)
    expect(ex.isExempted('pw')).toBe(false)
    ex.register('pw', 60_000)
    expect(ex.isExempted('pw')).toBe(true)
  })

  it('非法 ttl 回退默认值（默认 TTL 内命中）', () => {
    const ex = createClipboardExemptions(fakeHash)
    ex.register('pw', Number.NaN)
    ex.register('pw2', -5)
    ex.register('pw3')
    expect(ex.isExempted('pw')).toBe(true)
    expect(ex.isExempted('pw2')).toBe(true)
    expect(ex.isExempted('pw3')).toBe(true)
  })

  it('到期瞬间（now === expiresAt）即失效：边界含等号（fake timer 锁死，真实 sleep 测不到单点边界）', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const ex = createClipboardExemptions(fakeHash)
    ex.register('pw', 5_000) // deadline = 1_005_000
    vi.setSystemTime(1_004_999)
    expect(ex.isExempted('pw')).toBe(true) // 到期前 1ms 仍命中
    vi.setSystemTime(1_005_000)
    expect(ex.isExempted('pw')).toBe(false) // 到期瞬间（===）即失效；顺序不可倒：过期查询会惰性删条目
  })

  it('EXEMPT_DEFAULT_TTL_MS 覆盖 vault 30s 清空延时 + 10s 缓冲', () => {
    // vault CLEAR_DELAY_MS = 30_000（src/plugins/password-vault/logic/clipboard-clear.ts）；改那边须同步常量
    expect(EXEMPT_DEFAULT_TTL_MS).toBe(40_000)
  })
})
