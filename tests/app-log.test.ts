import { describe, expect, it } from 'vitest'
import { AppLog, isAppLogLevel, isAppLogSource, sanitizeAppLogText } from '../src/main/services/app-log'

describe('AppLog 环形缓冲', () => {
  it('按时间升序返回全部条目', () => {
    const log = new AppLog(3)
    log.push('info', 'main', 'a')
    log.push('warn', 'renderer', 'b')
    log.push('error', 'main', 'c')
    const { seq, items } = log.entries()
    expect(seq).toBe(3)
    expect(items.map((i) => i.text)).toEqual(['a', 'b', 'c'])
    expect(items[0].level).toBe('info')
    expect(items[1].source).toBe('renderer')
  })

  it('超容丢最旧', () => {
    const log = new AppLog(2)
    log.push('info', 'main', '1')
    log.push('info', 'main', '2')
    log.push('info', 'main', '3')
    const { items } = log.entries()
    expect(items.map((i) => i.text)).toEqual(['2', '3'])
  })

  it('seq 增量拉取：只返回新条目；无新条目返回空', () => {
    const log = new AppLog()
    log.push('info', 'main', '1')
    const first = log.entries()
    expect(first.items).toHaveLength(1)
    const none = log.entries(first.seq)
    expect(none.items).toHaveLength(0)
    expect(none.seq).toBe(first.seq)
    log.push('warn', 'main', '2')
    const inc = log.entries(first.seq)
    expect(inc.items.map((i) => i.text)).toEqual(['2'])
  })

  it('环形丢弃后的增量不越界（since 落在已丢弃区间只回存量）', () => {
    const log = new AppLog(2)
    log.push('info', 'main', '1')
    log.push('info', 'main', '2')
    const seen = log.entries().seq // seq=2
    log.push('info', 'main', '3') // 丢 1，buf=[2,3]，seq=3
    log.push('info', 'main', '4') // 丢 2，buf=[3,4]，seq=4
    const r = log.entries(seen) // since=2 < dropped=2 → from=max(2,2)=2，slice(2-2)=全部存量
    expect(r.items.map((i) => i.text)).toEqual(['3', '4'])
  })

  it('clear 清空条目', () => {
    const log = new AppLog()
    log.push('info', 'main', 'x')
    log.clear()
    expect(log.entries().items).toHaveLength(0)
  })

  it('长文本截断到 2000 字符并加省略号', () => {
    const log = new AppLog()
    log.push('info', 'main', 'x'.repeat(3000))
    const text = log.entries().items[0].text
    expect(text.length).toBe(2001)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('app-log 守卫函数', () => {
  it('sanitizeAppLogText 非字符串转空串', () => {
    expect(sanitizeAppLogText(123)).toBe('')
    expect(sanitizeAppLogText(null)).toBe('')
    expect(sanitizeAppLogText(undefined)).toBe('')
    expect(sanitizeAppLogText('ok')).toBe('ok')
  })

  it('isAppLogLevel / isAppLogSource 白名单判定', () => {
    expect(isAppLogLevel('info')).toBe(true)
    expect(isAppLogLevel('warn')).toBe(true)
    expect(isAppLogLevel('error')).toBe(true)
    expect(isAppLogLevel('debug')).toBe(false)
    expect(isAppLogSource('main')).toBe(true)
    expect(isAppLogSource('renderer')).toBe(true)
    expect(isAppLogSource('worker')).toBe(false)
  })
})
