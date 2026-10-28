// 敏感判定单测：验收样例全命中，无害高频内容全不命中（宁漏勿拦的回归防线）
import { describe, expect, it } from 'vitest'
import { isSensitiveText } from './sensitive'

describe('isSensitiveText 命中形态', () => {
  it('PEM 私钥块（RSA / 裸 / OPENSSH）', () => {
    expect(
      isSensitiveText('-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----')
    ).toBe(true)
    expect(isSensitiveText('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----')).toBe(true)
    expect(isSensitiveText('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk\n-----END OPENSSH PRIVATE KEY-----')).toBe(
      true
    )
  })

  it('JWT 三段式（签名段允许为空）', () => {
    expect(
      isSensitiveText('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')
    ).toBe(true)
    expect(isSensitiveText('eyJhbGciOiJub25lIn0.eyJ1c2VyIjoiYSJ9.')).toBe(true)
  })

  it('AWS AccessKeyId', () => {
    expect(isSensitiveText('aws_access_key_id = AKIAIOSFODNN7EXAMPLE')).toBe(true)
    expect(isSensitiveText('key AKIAIOSFODNN7EXAMPLE in prose')).toBe(true)
  })

  it('键值对式凭证（password/token/secret/api_key，含全角场景外的大小写）', () => {
    expect(isSensitiveText('password: hunter2')).toBe(true)
    expect(isSensitiveText('PASSWORD=hunter2')).toBe(true)
    expect(isSensitiveText('db_passwd = p@ss')).toBe(true)
    expect(isSensitiveText("token: 'ghp_16charsXXXXXXXXXX'")).toBe(true)
    expect(isSensitiveText('secret=abc123')).toBe(true)
    expect(isSensitiveText('API-KEY: sk-123')).toBe(true)
    expect(isSensitiveText('apikey=x')).toBe(true)
  })
})

describe('isSensitiveText 无害内容不命中', () => {
  it('UUID / 普通 URL / 普通 base64 / 中文句子', () => {
    expect(isSensitiveText('550e8400-e29b-41d4-a716-446655440000')).toBe(false)
    expect(isSensitiveText('https://example.com/docs/getting-started?q=vue')).toBe(false)
    expect(isSensitiveText('https://www.bilibili.com/video/BV1xx411c7mD')).toBe(false)
    expect(isSensitiveText('QUJDREVGR0hJSktMTU5PUA==')).toBe(false)
    expect(isSensitiveText('今天天气不错，我们去公园散步吧')).toBe(false)
    expect(isSensitiveText('')).toBe(false)
    expect(isSensitiveText('   ')).toBe(false)
  })

  it('AKIA 后不足 16 位大写数字不命中（防误伤普通大写串）', () => {
    expect(isSensitiveText('AKIA123')).toBe(false)
    expect(isSensitiveText('AKIAIOSFODNN7EXAMPLEX')).toBe(false) // 17 位
  })

  it('JWT 需整段为单 token，混入正文不因 JWT 规则命中', () => {
    expect(isSensitiveText('前缀 eyJhbGciOiJIUzI1NiJ9.eyJhIjoxf0.abc 后缀')).toBe(false)
  })
})

describe('isSensitiveText 垫片转发 sdk 单源（厂商清单 / Bearer / JSON 复合键同步生效）', () => {
  it('九厂商裸 token 各 1 正例', () => {
    expect(isSensitiveText('ghp_' + 'aB1'.repeat(12))).toBe(true)
    expect(isSensitiveText('github_pat_' + 'a1B_'.repeat(10))).toBe(true)
    expect(isSensitiveText('xoxb-' + '123456789012' + '-1234567890123-AbCdEfGhIjKlMnOpQrSt')).toBe(true)
    expect(isSensitiveText('glpat-' + 'a1B_'.repeat(6))).toBe(true)
    expect(isSensitiveText('sk-proj-' + 'a1B_'.repeat(10))).toBe(true)
    expect(isSensitiveText('sk-ant-' + 'a1B_'.repeat(10))).toBe(true)
    expect(isSensitiveText('sk_live_' + 'a1B'.repeat(8))).toBe(true)
    expect(isSensitiveText('npm_' + 'a1B'.repeat(12))).toBe(true)
    expect(isSensitiveText('AIza' + 'a1B-'.repeat(12))).toBe(true)
    expect(isSensitiveText('pypi-' + 'a1B-'.repeat(10))).toBe(true)
  })

  it('护栏之下 / 短 Bearer / JSON 值无引号不命中', () => {
    expect(isSensitiveText('ghp_' + 'a'.repeat(29))).toBe(false)
    expect(isSensitiveText('npm_' + 'a'.repeat(29))).toBe(false)
    expect(isSensitiveText('Bearer abc')).toBe(false)
    expect(isSensitiveText('{"access_token": bare}')).toBe(false)
  })

  it('Bearer 长值与 JSON 复合键命中', () => {
    expect(isSensitiveText('Bearer ' + 'a'.repeat(20))).toBe(true)
    expect(isSensitiveText('{"client_secret":"cs_0123456789"}')).toBe(true)
  })
})
