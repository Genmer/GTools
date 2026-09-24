import { describe, expect, it } from 'vitest'
import { buildNoteHtml, escapeHtml, noteModelOf } from '../../../../src/plugins/todo-pomodoro/logic/float'
import { IDLE_TIMER_STATE, pauseTimer, startBreak, startFocus } from '../../../../src/plugins/todo-pomodoro/logic/timer'

const T0 = 1_700_000_000_000
const MIN = 60_000

describe('escapeHtml', () => {
  it('转义五个危险字符', () => {
    expect(escapeHtml(`<img src=x onerror="a">&'`)).toBe('&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;')
  })
})

describe('noteModelOf', () => {
  it('running focus：走秒 + 专注中', () => {
    const m = noteModelOf(startFocus(IDLE_TIMER_STATE, { focusMin: 25, breakMin: 5, autoStartBreak: true, todoId: 'a', todoTitle: '写周报' }, T0), 3, T0)
    expect(m.headline).toBe('专注中')
    expect(m.live).toBe(true)
    expect(m.endAt).toBe(T0 + 25 * MIN)
    expect(m.title).toBe('写周报')
  })

  it('running break：休息中', () => {
    const m = noteModelOf(startBreak(IDLE_TIMER_STATE, 5, T0), 0, T0)
    expect(m.headline).toBe('休息中')
    expect(m.live).toBe(true)
  })

  it('paused：静态钟面定格剩余', () => {
    const s = pauseTimer(startFocus(IDLE_TIMER_STATE, { focusMin: 25, breakMin: 5, autoStartBreak: true, todoId: null, todoTitle: '' }, T0), T0 + 5 * MIN)
    const m = noteModelOf(s, 1, T0 + 100)
    expect(m.live).toBe(false)
    expect(m.clockStatic).toBe('20:00')
  })

  it('idle：今日计数或待命', () => {
    expect(noteModelOf(IDLE_TIMER_STATE, 4, T0).headline).toBe('今日 4 🍅')
    expect(noteModelOf(IDLE_TIMER_STATE, 0, T0).headline).toBe('番茄钟待命')
  })
})

describe('buildNoteHtml', () => {
  it('含拖动区、关闭按钮（gtoolsFloat.close）、今日计数', () => {
    const html = buildNoteHtml({ headline: '专注中', live: false, endAt: null, clockStatic: '24:00', title: '写周报', today: 3 })
    expect(html).toContain('class="drag root"')
    expect(html).toContain('no-drag x')
    expect(html).toContain('gtoolsFloat.close()')
    expect(html).toContain('今日 3 🍅')
    expect(html).toContain('写周报')
    expect(html).toContain('24:00')
  })

  it('live 模式内嵌走秒脚本并注入 endAt；非 live 不带脚本', () => {
    const live = buildNoteHtml({ headline: '专注中', live: true, endAt: 1234567890123, clockStatic: '', title: '', today: 0 })
    expect(live).toContain('setInterval')
    expect(live).toContain('1234567890123')
    const frozen = buildNoteHtml({ headline: '已暂停', live: false, endAt: null, clockStatic: '20:00', title: '', today: 0 })
    expect(frozen).not.toContain('setInterval')
    expect(frozen).toContain('20:00')
  })

  it('待办标题 HTML 转义，防注入', () => {
    const evil = `<img src=x onerror="alert(1)">`
    const html = buildNoteHtml({ headline: '专注中', live: false, endAt: null, clockStatic: '00:00', title: evil, today: 0 })
    expect(html).not.toContain(`<img src=x`)
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })
})
