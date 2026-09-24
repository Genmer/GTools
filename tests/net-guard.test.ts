import { describe, expect, it } from 'vitest'
import { assertHttpUrl } from '../src/main/services/net-guard'

describe('net.fetch scheme 白名单', () => {
  it('http/https 放行', () => {
    expect(() => assertHttpUrl('https://api.example.com/v1?q=1')).not.toThrow()
    expect(() => assertHttpUrl('http://localhost:3000/translate')).not.toThrow()
    expect(() => assertHttpUrl('HTTPS://EXAMPLE.COM/x')).not.toThrow() // URL 协议不区分大小写
  })

  it('file:// 与其他协议拒绝（net.fetch 原生支持 file:，可读本地文件）', () => {
    expect(() => assertHttpUrl('file:///etc/passwd')).toThrow(/不允许的协议/)
    expect(() => assertHttpUrl('file:///Users/x/.ssh/id_rsa')).toThrow(/不允许的协议/)
    expect(() => assertHttpUrl('ftp://example.com/f')).toThrow(/不允许的协议/)
    expect(() => assertHttpUrl('chrome://settings')).toThrow(/不允许的协议/)
    expect(() => assertHttpUrl('about:blank')).toThrow(/不允许的协议/)
  })

  it('非 URL 字符串拒绝', () => {
    expect(() => assertHttpUrl('not a url')).toThrow(/非法 URL/)
    expect(() => assertHttpUrl('')).toThrow(/非法 URL/)
    expect(() => assertHttpUrl('/etc/passwd')).toThrow(/非法 URL/)
  })

  it('非法 URL 的错误消息不回显原始串（URL 过 ^https?:// 正则但 new URL 解析失败时，模板填充后可能含密钥）', () => {
    const url = 'https://exa mple.com/?key=SECRET'
    expect(/^https?:\/\//.test(url)).toBe(true) // 前置：能走到 assertHttpUrl 的场景
    let msg = ''
    try {
      assertHttpUrl(url)
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).not.toContain('SECRET')
    expect(msg).not.toContain(url)
  })
})
