import { describe, expect, it } from 'vitest'
import {
  IDLE_COUNTDOWN,
  MAX_DURATION_MS,
  formatDuration,
  formatRemaining,
  parseCountdownState,
  parseDuration,
  pauseCountdown,
  remaining,
  resumeCountdown,
  restoreSnapshot,
  startCountdown,
  stopCountdown,
  tickCountdown
} from '../../../../src/plugins/timer/logic/countdown'

const T0 = 1_000_000

describe('parseDuration 时长解析', () => {
  it('单/组合单位与纯数字（按分钟）', () => {
    expect(parseDuration('25m')).toBe(1_500_000)
    expect(parseDuration('1h30m')).toBe(5_400_000)
    expect(parseDuration('90s')).toBe(90_000)
    expect(parseDuration('1h')).toBe(3_600_000)
    expect(parseDuration('45')).toBe(2_700_000)
    expect(parseDuration(' 1H 30M ')).toBe(5_400_000) // 大小写与段间空白容错
  })
  it('验收字面量：纯数字按分钟（90 → 90 分钟）；未知单位 8d 返回 null', () => {
    expect(parseDuration('90')).toBe(90 * 60_000)
    expect(parseDuration('8d')).toBeNull()
  })
  it('非法 / 非正 / 超 7 天返回 null', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('abc')).toBeNull()
    expect(parseDuration('1x')).toBeNull()
    expect(parseDuration('0m')).toBeNull()
    expect(parseDuration('0')).toBeNull()
    expect(parseDuration('10080m')).toBe(MAX_DURATION_MS) // 恰 7 天放行
    expect(parseDuration('10081m')).toBeNull()
  })
})

describe('启动 / 暂停 / 恢复 / 停止（endAt 绝对时刻语义）', () => {
  it('start 以绝对时刻为 endAt 并清洗 label；剩余按比对不累减', () => {
    const s = startCountdown(60_000, '  泡面  ', T0)
    expect(s).toEqual({ status: 'running', endAt: T0 + 60_000, remainingMs: 0, totalMs: 60_000, label: '泡面' })
    expect(remaining(s.endAt, T0 + 25_000)).toBe(35_000)
  })
  it('label 超长截断 120；非字符串归空串', () => {
    expect(startCountdown(60_000, 'a'.repeat(200), T0).label).toBe('a'.repeat(120))
    expect(startCountdown(60_000, '', T0).label).toBe('')
  })
  it('pause 冻结剩余，resume 以当前时刻重新锚定 endAt', () => {
    const s = startCountdown(60_000, 'x', T0)
    const paused = pauseCountdown(s, T0 + 20_000)
    expect(paused.status).toBe('paused')
    expect(paused.remainingMs).toBe(40_000)
    // 暂停期间时间继续流逝，恢复后剩余不受影响
    const resumed = resumeCountdown(paused, T0 + 500_000)
    expect(resumed.status).toBe('running')
    expect(resumed.endAt).toBe(T0 + 500_000 + 40_000)
    // 非 running 暂停 / 非 paused 恢复均原样返回
    expect(pauseCountdown(paused, T0)).toBe(paused)
    expect(resumeCountdown(s, T0)).toBe(s)
  })
  it('stop 回空闲（含 label 清空）；到点判定', () => {
    expect(stopCountdown()).toEqual(IDLE_COUNTDOWN)
    expect(stopCountdown().label).toBe('')
    expect(tickCountdown(startCountdown(60_000, '', T0), T0 + 59_999)).toBeNull()
    const expired = tickCountdown(startCountdown(60_000, '泡面', T0), T0 + 60_000)
    expect(expired).toMatchObject({ status: 'expired', remainingMs: 0, label: '泡面' })
  })
})

describe('restoreSnapshot 跨休眠/跨重启', () => {
  it('running 且 endAt 已过 → expired 收尾；未过原样（引用不变）', () => {
    const stale = startCountdown(60_000, '', T0 - 120_000)
    expect(restoreSnapshot(stale, T0)).toMatchObject({ status: 'expired' })
    const fresh = startCountdown(60_000, '', T0)
    expect(restoreSnapshot(fresh, T0 + 1000)).toBe(fresh)
  })
  it('paused / expired / idle 原样；坏结构解析为 null', () => {
    const paused = pauseCountdown(startCountdown(60_000, '', T0), T0 + 10_000)
    expect(restoreSnapshot(paused, T0 + 999_999_999)).toBe(paused)
    expect(parseCountdownState('junk')).toBeNull()
    expect(parseCountdownState({ status: 'warp', endAt: 1 })).toBeNull()
    expect(parseCountdownState({ status: 'running', endAt: 'x', remainingMs: -5, totalMs: null })).toEqual({
      status: 'running',
      endAt: 0,
      remainingMs: 0,
      totalMs: 0,
      label: ''
    })
    const withLabel = parseCountdownState({ status: 'paused', endAt: 0, remainingMs: 40_000, totalMs: 60_000, label: '  泡面  ' })
    expect(withLabel!.label).toBe('泡面')
  })
})

describe('formatDuration / formatRemaining 文案', () => {
  it('时长人话与 mm:ss（满小时进位 h:mm:ss）', () => {
    expect(formatDuration(1_500_000)).toBe('25 分钟')
    expect(formatDuration(5_400_000)).toBe('1 小时 30 分钟')
    expect(formatDuration(0)).toBe('0 秒')
    expect(formatRemaining(1_500_000)).toBe('25:00')
    expect(formatRemaining(3_723_000)).toBe('1:02:03')
    expect(formatRemaining(-5)).toBe('00:00')
  })
})
