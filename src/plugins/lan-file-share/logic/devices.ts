/** 连接设备识别与登记（纯逻辑）；UA 规则覆盖常见手机/桌面浏览器 */

export function deviceLabelForUA(ua: string): string {
  if (ua === '') return '未知设备'
  let os = '未知设备'
  if (/HarmonyOS|OpenHarmony/i.test(ua)) os = '鸿蒙'
  else if (/iPhone/i.test(ua)) os = 'iPhone'
  else if (/iPad/i.test(ua)) os = 'iPad'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Macintosh|Mac OS X/i.test(ua)) os = 'Mac'
  else if (/Linux/i.test(ua)) os = 'Linux'

  if (/MicroMessenger/i.test(ua)) return `${os} · 微信`
  if (/QQ\//i.test(ua)) return `${os} · QQ`
  return os
}

export interface DeviceSnapshotOptions {
  cap: number
  ttlMs: number
}

export class DeviceRegistry {
  private readonly devices = new Map<string, { ip: string; label: string; firstSeen: number; lastSeen: number; requests: number }>()

  /** 每个请求登记一次；返回是否本 TTL 周期内首次出现（用于「设备已连接」日志） */
  touch(ip: string, ua: string, now: number): boolean {
    const label = deviceLabelForUA(ua)
    const key = `${ip}|${label}`
    const d = this.devices.get(key)
    if (d) {
      const reseen = now - d.lastSeen > 30_000
      d.lastSeen = now
      d.requests++
      return reseen
    }
    this.devices.set(key, { ip, label, firstSeen: now, lastSeen: now, requests: 1 })
    return true
  }

  snapshot(now: number, opts: DeviceSnapshotOptions): Array<{ ip: string; label: string; firstSeen: number; lastSeen: number; requests: number }> {
    for (const [k, d] of this.devices) {
      if (now - d.lastSeen > opts.ttlMs) this.devices.delete(k)
    }
    const list = [...this.devices.values()].sort((a, b) => b.lastSeen - a.lastSeen)
    if (list.length > opts.cap) {
      for (const d of list.slice(opts.cap)) this.devices.delete(`${d.ip}|${d.label}`)
      return list.slice(0, opts.cap)
    }
    return list
  }

  reset(): void {
    this.devices.clear()
  }
}
