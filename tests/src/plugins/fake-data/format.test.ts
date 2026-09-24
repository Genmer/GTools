import { describe, expect, it } from 'vitest'
import { createRng } from '../../../../src/plugins/fake-data/logic/random'
import { FIELD_DEFS, generateBatch } from '../../../../src/plugins/fake-data/logic/fields'
import { formatOutput } from '../../../../src/plugins/fake-data/logic/format'

const rng = () => createRng(99)
const ids = ['name', 'phone', 'email']
const defs = FIELD_DEFS.filter((f) => ids.includes(f.id))
const batch = generateBatch(ids, 3, rng())

describe('fake-data formatOutput', () => {
  it('JSON：可解析、键为中文 label、与原记录一一对应', () => {
    const out = formatOutput(batch, defs, 'json')
    const parsed = JSON.parse(out) as Record<string, string>[]
    expect(parsed).toHaveLength(3)
    expect(Object.keys(parsed[0])).toEqual(['姓名', '手机号', '邮箱'])
    parsed.forEach((row, i) => {
      expect(row['姓名']).toBe(batch[i]?.name)
      expect(row['手机号']).toBe(batch[i]?.phone)
      expect(row['邮箱']).toBe(batch[i]?.email)
    })
  })

  it('表格：Markdown 管道表，行数 = 记录数 + 表头 + 分隔行', () => {
    const out = formatOutput(batch, defs, 'table')
    const lines = out.split('\n')
    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('| 姓名 | 手机号 | 邮箱 |')
    expect(lines[1]).toBe('| --- | --- | --- |')
    for (const l of lines.slice(2)) expect(l).toMatch(/^\| [\u4e00-\u9fa5]{2,4} \| 1[3-9]\d{9} \| .+@.+ \|$/)
  })

  it('纯文本：TSV 首行为表头，值内无换行/制表符', () => {
    const out = formatOutput(batch, defs, 'text')
    const lines = out.split('\n')
    expect(lines[0]).toBe('姓名\t手机号\t邮箱')
    expect(lines).toHaveLength(4)
    for (const l of lines.slice(1)) {
      const cells = l.split('\t')
      expect(cells).toHaveLength(3)
      for (const c of cells) expect(c).not.toMatch(/[\n\t]/)
    }
  })

  it('eol 参数生效（Windows CRLF）', () => {
    const out = formatOutput(batch, defs, 'text', '\r\n')
    expect(out.includes('\r\n')).toBe(true)
    expect(out.split('\r\n')).toHaveLength(4)
  })

  it('表格转义值中的竖线', () => {
    const rec = [{ name: 'a|b', phone: '13800000000' }]
    const out = formatOutput(rec, defs.slice(0, 2), 'table')
    expect(out.split('\n')[2]).toBe('| a\\|b | 13800000000 |')
  })

  it('记录缺键时不输出 undefined（空串兜底）', () => {
    const out = formatOutput([{ name: '张三' }], defs, 'text')
    expect(out.split('\n')[1]).toBe('张三\t\t')
    expect(out).not.toContain('undefined')
  })

  it('空记录或空字段返回空串', () => {
    expect(formatOutput([], defs, 'json')).toBe('')
    expect(formatOutput(batch, [], 'json')).toBe('')
  })
})
