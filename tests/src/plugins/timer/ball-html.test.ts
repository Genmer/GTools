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

  it('倒计时 running：live + endAt + 标签 + 剩余比例', () => {
    const m = ballModelOf(startCountdown(25 * MIN, '泡面', T0), IDLE_POMODORO_STATE, 0, T0)!
    expect(m.kind).toBe('countdown')
    expect(m.status).toBe('running')
    expect(m.live).toBe(true)
    expect(m.endAt).toBe(T0 + 25 * MIN)
    expect(m.label).toBe('泡面')
    expect(m.totalMs).toBe(25 * MIN)
    expect(m.frac).toBeCloseTo(1, 5)
  })

  it('倒计时 paused：静态钟面定格剩余、比例随剩余量；expired：收尾态', () => {
    const paused = pauseCountdown(startCountdown(25 * MIN, '', T0), T0 + 5 * MIN)
    const m = ballModelOf(paused, IDLE_POMODORO_STATE, 0, T0)!
    expect(m.live).toBe(false)
    expect(m.endAt).toBeNull()
    expect(m.clockStatic).toBe('20:00')
    expect(m.frac).toBeCloseTo(0.8, 5)
    const expired = { ...startCountdown(25 * MIN, '', T0), status: 'expired' as const }
    expect(ballModelOf(expired, IDLE_POMODORO_STATE, 0, T0)!.status).toBe('expired')
  })

  it('番茄 running focus/break：相位与今日数；paused 定格', () => {
    const m = ballModelOf(IDLE_COUNTDOWN, startFocus({ focusMin: 25 }, T0), 3, T0)!
    expect(m.kind).toBe('pomodoro')
    expect(m.phase).toBe('focus')
    expect(m.today).toBe(3)
    expect(m.clockStatic).toBe('25:00')
    expect(m.totalMs).toBe(25 * MIN)
    expect(m.frac).toBeCloseTo(1, 5)
    const br = ballModelOf(IDLE_COUNTDOWN, startBreak(IDLE_POMODORO_STATE, 5, T0), 0, T0)!
    expect(br.phase).toBe('break')
    const paused = pausePomodoro(startFocus({ focusMin: 25 }, T0), T0 + 5 * MIN)
    const pm = ballModelOf(IDLE_COUNTDOWN, paused, 1, T0)!
    expect(pm.live).toBe(false)
    expect(pm.clockStatic).toBe('20:00')
    expect(pm.frac).toBeCloseTo(0.8, 5)
  })

  it('倒计时 expired：frac 收尾为 0；totalMs<=0 防护不产生 NaN（两侧）', () => {
    const expired = { ...startCountdown(25 * MIN, '', T0), status: 'expired' as const }
    const em = ballModelOf(expired, IDLE_POMODORO_STATE, 0, T0)!
    expect(em.status).toBe('expired')
    expect(em.frac).toBe(0)
    const zeroCd = ballModelOf({ ...startCountdown(25 * MIN, '', T0), totalMs: 0 }, IDLE_POMODORO_STATE, 0, T0)!
    expect(zeroCd.frac).toBe(0)
    expect(Number.isFinite(zeroCd.frac)).toBe(true)
    const zeroPd = ballModelOf(IDLE_COUNTDOWN, { ...startFocus({ focusMin: 25 }, T0), totalMs: 0 }, 0, T0)!
    expect(zeroPd.frac).toBe(0)
    expect(Number.isFinite(zeroPd.frac)).toBe(true)
  })
})

describe('buildBallHtml', () => {
  it('分区 class：ball/paused/expired + 相位色 k-*、face/ph/clock/sub/x；BALL_SIZE ≥ 宿主最小尺寸 80', () => {
    const html = buildBallHtml({ kind: 'pomodoro', status: 'paused', live: false, endAt: null, totalMs: 25 * MIN, frac: 0.8, clockStatic: '20:00', phase: 'focus', today: 3 })
    expect(html).toContain('class="ball paused k-focus"')
    expect(html).toContain('class="face"')
    expect(html).toContain('class="ph"')
    expect(html).toContain('id="clock"')
    expect(html).toContain('class="sub"')
    expect(html).toContain('今日 3')
    expect(html).toContain('已暂停')
    expect(html).toContain('class="x"')
    expect(html).toContain('style="--p:0.8000"')
    expect(BALL_SIZE).toBeGreaterThanOrEqual(80)
    expect(BALL_SIZE).toBe(96)
    const brk = buildBallHtml({ kind: 'pomodoro', status: 'running', live: true, endAt: T0, totalMs: 5 * MIN, frac: 1, clockStatic: '', phase: 'break', today: 0 })
    expect(brk).toContain('class="ball k-break"')
    const expired = buildBallHtml({ kind: 'countdown', status: 'expired', live: false, endAt: null, totalMs: MIN, frac: 0.5, clockStatic: '00:00', label: '' })
    expect(expired).toContain('class="ball expired k-cd"')
    expect(expired).toContain('时间到')
    expect(expired).toContain('style="--p:0.0000"')
    expect(expired).not.toContain('class="sub"')
  })

  it('进度环：conic-gradient 消费 --p，live 脚本每帧刷新环与钟面', () => {
    const live = buildBallHtml({ kind: 'countdown', status: 'running', live: true, endAt: T0 + 25 * MIN, totalMs: 25 * MIN, frac: 1, clockStatic: '', label: '' })
    expect(live).toContain('conic-gradient(var(--ring) calc(var(--p)*1turn)')
    expect(live).toContain('classList.toggle(\'long\'')
    expect(live).toContain(`total=${25 * MIN}`)
    expect(live).toContain('ringSet(total>0?(endAt-Date.now())/total:0)')
    expect(live).toContain('Math.max(0,Math.min(1,v)).toFixed(4)')
  })

  it('live 模式内嵌自走秒脚本并注入 endAt 与 kind；非 live 不带走秒', () => {
    const live = buildBallHtml({ kind: 'countdown', status: 'running', live: true, endAt: 1234567890123, totalMs: 25 * MIN, frac: 1, clockStatic: '', label: '' })
    expect(live).toContain('setInterval')
    expect(live).toContain('1234567890123')
    expect(live).toContain('countdown')
    const frozen = buildBallHtml({ kind: 'countdown', status: 'paused', live: false, endAt: null, totalMs: 25 * MIN, frac: 0.8, clockStatic: '20:00', label: '' })
    expect(frozen).toContain('20:00')
  })

  it('球事件：ball-action click/dblclick 配对、drag-move、ball-pos 上报、✕ 关闭桥', () => {
    const html = buildBallHtml({ kind: 'pomodoro', status: 'running', live: true, endAt: T0 + 25 * MIN, totalMs: 25 * MIN, frac: 1, clockStatic: '', phase: 'focus', today: 2 })
    expect(html).toContain("emit('ball-action',{action:'click'})")
    expect(html).toContain("emit('ball-action',{action:'dblclick'})")
    expect(html).toContain("emit('drag-move',")
    expect(html).toContain("emit('ball-pos',")
    expect(html).toContain('gtoolsFloat.close()')
    expect(html).toContain('pagehide')
  })

  it('label HTML 转义防注入（title 属性与 sub 行）', () => {
    const evil = `<img src=x onerror="alert(1)">`
    const html = buildBallHtml({ kind: 'countdown', status: 'running', live: false, endAt: null, totalMs: MIN, frac: 1, clockStatic: '01:00', label: evil })
    expect(html).not.toContain(`title="${evil}`)
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })

  it('深浅色块：默认深色玻璃底 + prefers-color-scheme:light 覆盖，paused/expired 态样式存在', () => {
    const html = buildBallHtml({ kind: 'countdown', status: 'running', live: false, endAt: null, totalMs: MIN, frac: 1, clockStatic: '01:00', label: '' })
    expect(html).toContain('@media (prefers-color-scheme:light)')
    expect(html).toContain('.ball.paused')
    expect(html).toContain('.ball.expired')
    expect(html).toContain('backdrop-filter')
  })
})
