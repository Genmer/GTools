import { describe, expect, it } from 'vitest'
import { lanIPv4Addresses } from '../src/main/services/lan'

describe('lanIPv4Addresses', () => {
  it('只取 IPv4 非内网地址，去重', () => {
    const r = lanIPv4Addresses({
      lo0: [
        { family: 'IPv6', address: '::1', internal: true },
        { family: 'IPv4', address: '127.0.0.1', internal: true }
      ],
      en0: [
        { family: 'IPv6', address: 'fe80::1', internal: false },
        { family: 'IPv4', address: '192.168.1.5', internal: false }
      ],
      en1: [{ family: 'IPv4', address: '192.168.1.5', internal: false }]
    })
    expect(r).toEqual([{ name: 'en0', address: '192.168.1.5' }])
  })

  it('family 为数字 4 的形态同样识别（node 新版）', () => {
    const r = lanIPv4Addresses({ eth0: [{ family: 4, address: '10.0.0.2', internal: false }] })
    expect(r).toEqual([{ name: 'eth0', address: '10.0.0.2' }])
  })

  it('无可用网卡返回空数组', () => {
    expect(lanIPv4Addresses({})).toEqual([])
    expect(lanIPv4Addresses({ lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }] })).toEqual([])
  })
})
