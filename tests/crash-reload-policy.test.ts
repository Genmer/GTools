import { describe, expect, it } from 'vitest'
import { decideAutoReload } from '../src/main/services/crash-reload-policy'

const NOW = 10_000_000

describe('decideAutoReload', () => {
  it('空历史：放行重载并记入本次时间戳', () => {
    expect(decideAutoReload([], NOW)).toEqual({ reload: true, history: [NOW] })
  })

  it('60 秒内已有 1 次：放行', () => {
    expect(decideAutoReload([NOW - 10_000], NOW)).toEqual({
      reload: true,
      history: [NOW - 10_000, NOW]
    })
  })

  it('60 秒内已有 2 次：仍放行（窗口内最多 3 次重载）', () => {
    expect(decideAutoReload([NOW - 10_000, NOW - 20_000], NOW)).toEqual({
      reload: true,
      history: [NOW - 10_000, NOW - 20_000, NOW]
    })
  })

  it('60 秒内已有 3 次：放弃自动重载', () => {
    const out = decideAutoReload([NOW - 10_000, NOW - 20_000, NOW - 25_000], NOW)
    expect(out.reload).toBe(false)
    expect(out.history).toEqual([NOW - 10_000, NOW - 20_000, NOW - 25_000, NOW])
  })

  it('窗口整 60 秒：45~55 秒前的旧戳仍在窗内，满 3 次同样放弃', () => {
    expect(decideAutoReload([NOW - 45_000, NOW - 50_000, NOW - 55_000], NOW).reload).toBe(false)
  })

  it('边界：恰 60_000ms 前的戳仍算窗内（60_001 才清出）', () => {
    expect(decideAutoReload([NOW - 60_000], NOW)).toEqual({ reload: true, history: [NOW - 60_000, NOW] })
  })

  it('连续失败序列：依次放行 3 次重载，第 4 次失败放弃', () => {
    let history: number[] = []
    const reloads = [0, 1_000, 2_000, 3_000].map((t) => {
      const out = decideAutoReload(history, t)
      history = out.history
      return out.reload
    })
    expect(reloads).toEqual([true, true, true, false])
  })

  it('窗外旧时间戳被清出：历史 3 条但窗内只剩 2，第 4 次仍放行', () => {
    const out = decideAutoReload([NOW - 120_000, NOW - 10_000, NOW - 20_000], NOW)
    expect(out.reload).toBe(true)
    expect(out.history).toEqual([NOW - 10_000, NOW - 20_000, NOW])
  })

  it('返回历史不被窗外旧戳污染：60 秒前的记录不进新历史', () => {
    const out = decideAutoReload([NOW - 60_001, NOW - 500_000], NOW)
    expect(out.history).toEqual([NOW])
    expect(out.reload).toBe(true)
  })

  it('滚动续账：窗外清出后重新累计，窗内满 3 次后放弃', () => {
    let history: number[] = []
    const stamps = [0, 5_000, 90_000, 95_000, 100_000, 101_000]
    const reloads = stamps.map((t) => {
      const out = decideAutoReload(history, t)
      history = out.history
      return out.reload
    })
    expect(reloads).toEqual([true, true, true, true, true, false])
  })
})
