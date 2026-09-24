import { describe, expect, it } from 'vitest'
import { deviceLabelForUA, DeviceRegistry } from '../../../../src/plugins/lan-file-share/logic/devices'

describe('deviceLabelForUA', () => {
  it('常见系统识别', () => {
    expect(deviceLabelForUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('iPhone')
    expect(deviceLabelForUA('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('iPad')
    expect(deviceLabelForUA('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')).toBe('Android')
    expect(deviceLabelForUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0')).toBe('Windows')
    expect(deviceLabelForUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15')).toBe('Mac')
  })
  it('鸿蒙先于 Android 判定（鸿蒙 UA 含 Android 字样）', () => {
    expect(deviceLabelForUA('Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36 ArkWeb/4.1.6.1 Mobile')).toBe('鸿蒙')
  })
  it('微信内置浏览器后缀', () => {
    expect(deviceLabelForUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.42')).toBe('iPhone · 微信')
  })
  it('空 UA 兜底', () => {
    expect(deviceLabelForUA('')).toBe('未知设备')
    expect(deviceLabelForUA('curl/8.4.0')).toBe('未知设备')
  })
})

describe('DeviceRegistry', () => {
  const opts = { cap: 3, ttlMs: 1000 }
  const T0 = 1_000_000

  it('首次 touch 返回新连接，重复 touch 不再算新', () => {
    const r = new DeviceRegistry()
    expect(r.touch('192.168.1.8', 'iPhone UA', T0)).toBe(true)
    expect(r.touch('192.168.1.8', 'iPhone UA', T0 + 5)).toBe(false)
    expect(r.touch('192.168.1.8', 'iPhone UA', T0 + 10)).toBe(false)
  })
  it('同 IP 不同 UA 视为两台设备；快照按最近活跃排序', () => {
    const r = new DeviceRegistry()
    r.touch('192.168.1.8', 'iPhone', T0)
    r.touch('192.168.1.9', 'Android', T0 + 1)
    r.touch('192.168.1.8', 'iPhone', T0 + 2)
    const snap = r.snapshot(T0 + 3, opts)
    expect(snap.map((d) => d.ip)).toEqual(['192.168.1.8', '192.168.1.9'])
    expect(snap[0].requests).toBe(2)
    expect(snap[0].firstSeen).toBe(T0)
  })
  it('超 TTL 的设备在快照时清除，隔 30 秒再访问算重新连接', () => {
    const r = new DeviceRegistry()
    r.touch('192.168.1.8', 'iPhone', T0)
    expect(r.touch('192.168.1.8', 'iPhone', T0 + 31_000)).toBe(true) // 超过 30s 未活跃 → 重连
    expect(r.snapshot(T0 + 31_001, { cap: 5, ttlMs: 30_000 })).toHaveLength(1)
    expect(r.snapshot(T0 + 31_000 + 30_001, { cap: 5, ttlMs: 30_000 })).toHaveLength(0)
  })
  it('容量封顶丢最旧', () => {
    const r = new DeviceRegistry()
    r.touch('192.168.1.1', 'A', T0)
    r.touch('192.168.1.2', 'B', T0 + 1)
    r.touch('192.168.1.3', 'C', T0 + 2)
    r.touch('192.168.1.4', 'D', T0 + 3)
    const snap = r.snapshot(T0 + 4, opts)
    expect(snap.map((d) => d.ip)).toEqual(['192.168.1.4', '192.168.1.3', '192.168.1.2'])
  })
})
