import { describe, expect, it } from 'vitest'
import { isSensitiveText } from '../src/renderer/src/core/sensitive'

describe('isSensitiveText', () => {
  it('PEM 私钥命中', () => {
    expect(isSensitiveText('-----BEGIN RSA PRIVATE KEY-----\nMIIE...')).toBe(true)
  })

  it('JWT 命中', () => {
    expect(isSensitiveText('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc123')).toBe(true)
  })

  it('AWS Access Key 命中', () => {
    expect(isSensitiveText('AKIAIOSFODNN7EXAMPLE')).toBe(true)
  })

  it('password=xxx 键值对命中', () => {
    expect(isSensitiveText('password=mySecret123')).toBe(true)
  })

  it('JSON "password":"xxx" 命中', () => {
    expect(isSensitiveText('{"password":"mySecret123"}')).toBe(true)
    expect(isSensitiveText('{"api_key": "abc"}')).toBe(true)
    expect(isSensitiveText('{"authorization": "Bearer xxx"}')).toBe(true)
    expect(isSensitiveText('{"session": "abc123"}')).toBe(true)
  })

  it('普通文本不命中', () => {
    expect(isSensitiveText('hello world')).toBe(false)
  })

  it('空字符串不命中', () => {
    expect(isSensitiveText('')).toBe(false)
    expect(isSensitiveText('   ')).toBe(false)
  })

  it('普通 JSON 不命中', () => {
    expect(isSensitiveText('{"name":"test"}')).toBe(false)
    expect(isSensitiveText('{"count": 42, "items": ["a","b"]}')).toBe(false)
  })
})

describe('isSensitiveText 厂商裸 token（清单制：前缀+最低长度护栏）', () => {
  it('GitHub 经典 PAT：ghp_ 36 位命中，29 位不命中', () => {
    expect(isSensitiveText('ghp_' + 'aB1'.repeat(12))).toBe(true)
    expect(isSensitiveText('ghp_' + 'a'.repeat(29))).toBe(false)
  })

  it('GitHub 细粒度 PAT：命中，护栏之下不命中', () => {
    expect(isSensitiveText('github_pat_' + 'a1B_'.repeat(10))).toBe(true)
    expect(isSensitiveText('github_pat_' + 'a'.repeat(29))).toBe(false)
  })

  it('Slack：真实 bot token 形态命中，短后缀不命中', () => {
    expect(isSensitiveText('xoxb-' + '123456789012' + '-1234567890123-AbCdEfGhIjKlMnOpQrSt')).toBe(true)
    expect(isSensitiveText('xoxb-123456789')).toBe(false)
  })

  it('GitLab PAT：命中，护栏之下不命中', () => {
    expect(isSensitiveText('glpat-' + 'a1B_'.repeat(6))).toBe(true)
    expect(isSensitiveText('glpat-' + 'a'.repeat(19))).toBe(false)
  })

  it('OpenAI / Anthropic：sk-proj- 与 sk-ant- 均命中，短后缀不命中', () => {
    expect(isSensitiveText('sk-proj-' + 'a1B_'.repeat(10))).toBe(true)
    expect(isSensitiveText('sk-ant-' + 'a1B_'.repeat(10))).toBe(true)
    expect(isSensitiveText('sk-proj-' + 'a'.repeat(19))).toBe(false)
  })

  it('Stripe：sk_live_ / sk_test_ 均命中，短后缀不命中', () => {
    expect(isSensitiveText('sk_live_' + 'a1B'.repeat(8))).toBe(true)
    expect(isSensitiveText('sk_test_' + 'a1B'.repeat(8))).toBe(true)
    expect(isSensitiveText('sk_live_' + 'a'.repeat(19))).toBe(false)
  })

  it('npm：命中，护栏之下不命中', () => {
    expect(isSensitiveText('npm_' + 'a1B'.repeat(12))).toBe(true)
    expect(isSensitiveText('npm_' + 'a'.repeat(29))).toBe(false)
  })

  it('Google API key：命中，护栏之下不命中', () => {
    expect(isSensitiveText('AIza' + 'a1B-'.repeat(12))).toBe(true)
    expect(isSensitiveText('AIza' + 'a'.repeat(29))).toBe(false)
  })

  it('PyPI 上传 token：命中，护栏之下不命中', () => {
    expect(isSensitiveText('pypi-' + 'a1B-'.repeat(10))).toBe(true)
    expect(isSensitiveText('pypi-' + 'a'.repeat(19))).toBe(false)
  })

  it('厂商 token 嵌入 URL 也命中（\\b 定界）', () => {
    expect(isSensitiveText('git push https://ghp_' + 'aB1'.repeat(12) + '@github.com/u/r.git')).toBe(true)
  })
})

describe('isSensitiveText Bearer 整段凭证（值 ≥20）', () => {
  it('整段 Bearer 长值命中，大小写不敏感', () => {
    expect(isSensitiveText('Bearer abcdefghijklmnopqrst')).toBe(true) // 恰 20，下限边界
    expect(isSensitiveText('bearer abcdefghijklmnopqrst')).toBe(true)
    expect(isSensitiveText('Bearer Abc.def+ghi~jkl/mno=pqr-stu')).toBe(true) // token68 字符集
  })

  it('短值不命中（防误伤文档示例占位）', () => {
    expect(isSensitiveText('Bearer abc')).toBe(false)
    expect(isSensitiveText('Bearer ' + 'a'.repeat(19))).toBe(false)
  })

  it('正文提及 Bearer 不命中（整段锚定，宁漏勿拦）', () => {
    expect(isSensitiveText('Authorization: Bearer token 认证方式说明')).toBe(false)
  })
})

describe('isSensitiveText JSON OAuth 复合键', () => {
  it('access/refresh/id_token、client/bearer_token 带引号值命中', () => {
    expect(isSensitiveText('{"access_token":"at_0123456789abcdef"}')).toBe(true)
    expect(isSensitiveText('{"refresh_token":"rt_0123456789abcdef"}')).toBe(true)
    expect(isSensitiveText('{"id_token":"id_0123456789abcdef"}')).toBe(true)
    expect(isSensitiveText('{"client_secret":"cs_0123456789abcdef"}')).toBe(true)
    expect(isSensitiveText('{"bearer_token":"bt_0123456789abcdef"}')).toBe(true)
    expect(isSensitiveText('{"access-token":"at_0123456789abcdef"}')).toBe(true) // 连字符键
  })

  it('同键值不带引号不命中（JSON 从严语义不回归）', () => {
    expect(isSensitiveText('{"access_token": at_0123456789abcdef}')).toBe(false)
    expect(isSensitiveText('{"client_secret": cs_0123456789abcdef}')).toBe(false)
  })
})
