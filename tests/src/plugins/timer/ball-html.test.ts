import { describe, expect, it } from 'vitest'
import { BALL_SIZE, ballModelOf, buildBallHtml } from '../../../../src/plugins/timer/logic/ball-html'
import { IDLE_COUNTDOWN, pauseCountdown, startCountdown } from '../../../../src/plugins/timer/logic/countdown'
import { IDLE_POMODORO_STATE, pausePomodoro, startBreak, startFocus } from '../../../../src/plugins/timer/logic/pomodoro'

const T0 = 1_700_000_000_000
const MIN = 60_000

describe('ballModelOf', () => {
  it('双 idle 返回 null', () => {
    expect(ballModelOf(IDLE_COUNTDOWN, IDLE_POMODORO_STATE, 3, T0)).toBeNull()
  })

  it('倒计时 running：live + endAt + 标签', () => {
    const m = ballModelOf(startCountdown(25 * MIN, '泡面', T0), IDLE_POMODORO_STATE, 0, T0)!
    expect(m.kind).toBe('countdown')
    expect(m.status).toBe('running')
    expect(m.live).toBe(true)
    expect(m.endAt).toBe(T0 + 25 * MIN)
    expect(m.label).toBe('泡面')
  })

  it('倒计时 paused：静态钟面定格剩余；expired：收尾态', () => {
    const paused = pauseCountdown(startCountdown(25 * MIN, '', T0), T0 + 5 * MIN)
    const m = ballModelOf(paused, IDLE_POMODORO_STATE, 0, T0)!
    expect(m.live).toBe(false)
    expect(m.endAt).toBeNull()
    expect(m.clockStatic).toBe('20:00')
    const expired = { ...startCountdown(25 * MIN, '', T0), status: 'expired' as const }
    expect(ballModelOf(expired, IDLE_POMODORO_STATE, 0, T0)!.status).toBe('expired')
  })

  it('番茄 running focus/break：相位与今日数；paused 定格', () => {
    const m = ballModelOf(IDLE_COUNTDOWN, startFocus({ focusMin: 25 }, T0), 3, T0)!
    expect(m.kind).toBe('pomodoro')
    expect(m.phase).toBe('focus')
    expect(m.today).toBe(3)
    expect(m.clockStatic).toBe('25:00')
    const br = ballModelOf(IDLE_COUNTDOWN, startBreak(IDLE_POMODORO_STATE, 5, T0), 0, T0)!
    expect(br.phase).toBe('break')
    const paused = pausePomodoro(startFocus({ focusMin: 25 }, T0), T0 + 5 * MIN)
    const pm = ballModelOf(IDLE_COUNTDOWN, paused, 1, T0)!
    expect(pm.live).toBe(false)
    expect(pm.clockStatic).toBe('20:00')
  })
})

describe('buildBallHtml', () => {
  it('分区 class：ball/paused/expired、badge、x、core、sub；BALL_SIZE 与宿主最小尺寸一致', () => {
    const html = buildBallHtml({ kind: 'pomodoro', status: 'paused', live: false, endAt: null, clockStatic: '20:00', phase: 'focus', today: 3 })
    expect(html).toContain('class="ball paused"')
    expect(html).toContain('class="badge"')
    expect(html).toContain('class="x"')
    expect(html).toContain('class="core"')
    expect(html).toContain('class="sub"')
    expect(html).toContain('×3')
    expect(BALL_SIZE).toBe(80)
    const expired = buildBallHtml({ kind: 'countdown', status: 'expired', live: false, endAt: null, clockStatic: '00:00', label: '' })
    expect(expired).toContain('class="ball expired"')
    expect(expired).not.toContain('class="badge"')
    expect(expired).not.toContain('class="sub"')
  })

  it('live 模式内嵌自走秒脚本并注入 endAt 与 kind；非 live 不带走秒', () => {
    const live = buildBallHtml({ kind: 'countdown', status: 'running', live: true, endAt: 1234567890123, clockStatic: '', label: '' })
    expect(live).toContain('setInterval')
    expect(live).toContain('1234567890123')
    expect(live).toContain('countdown')
    const frozen = buildBallHtml({ kind: 'countdown', status: 'paused', live: false, endAt: null, clockStatic: '20:00', label: '' })
    expect(frozen).toContain('20:00')
  })

  it('球事件：ball-action click/dblclick 配对、drag-move、ball-pos 上报、✕ 关闭桥', () => {
    const html = buildBallHtml({ kind: 'pomodoro', status: 'running', live: true, endAt: T0 + 25 * MIN, clockStatic: '', phase: 'focus', today: 2 })
    expect(html).toContain("emit('ball-action',{action:'click'})")
    expect(html).toContain("emit('ball-action',{action:'dblclick'})")
    expect(html).toContain("emit('drag-move',")
    expect(html).toContain("emit('ball-pos',")
    expect(html).toContain('gtoolsFloat.close()')
    expect(html).toContain('pagehide')
  })

  it('label HTML 转义防注入（title 属性）', () => {
    const evil = `<img src=x onerror="alert(1)">`
    const html = buildBallHtml({ kind: 'countdown', status: 'running', live: false, endAt: null, clockStatic: '01:00', label: evil })
    expect(html).not.toContain(`title="${evil}`)
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('深浅色块：颜色集中定义并带 prefers-color-scheme:dark 适配', () => {
    const html = buildBallHtml({ kind: 'countdown', status: 'running', live: false, endAt: null, clockStatic: '01:00', label: '' })
    expect(html).toContain('@media (prefers-color-scheme:dark)')
    expect(html).toContain('.ball.paused')
    expect(html).toContain('.ball.expired')
  })
})
