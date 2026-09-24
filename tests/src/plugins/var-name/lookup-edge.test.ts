// 中文取词链边界补充（lookup.test.ts 覆盖主链路，本文件补混合输入/多义项词条/译文停用词）
import { describe, expect, it } from 'vitest'
import { resolveWords, type ApisLike } from '../../../../src/plugins/var-name/logic/lookup'

const fakeApis = (resultText: string): ApisLike => ({
  invoke: async () => ({ resultText })
})

const failingApis = (): ApisLike => ({
  invoke: async () => {
    throw new Error('SERVICE_ERROR')
  }
})

describe('混合输入与词条形态', () => {
  it('中英混合输入：词典整句匹配不中 → 走翻译兜底', async () => {
    const out = await resolveWords('user配置', fakeApis('user profile'))
    expect(out.source).toBe('translate')
    expect(out.variants).toEqual([['user', 'profile']])
  })

  it('多短语词条（接口）：每个短语一组词，avoid 带中式直译警示，entries 供 UI 显示释义域', async () => {
    const out = await resolveWords('接口', null)
    expect(out.source).toBe('dict')
    expect(out.variants).toEqual([['api'], ['endpoint']])
    expect(out.avoid.join()).toContain('interface')
    expect(out.entries).toHaveLength(1)
    expect(out.entries[0].en).toEqual(['api', 'endpoint'])
    expect(out.entries[0].domain).toBe('network')
  })

  it('单词条多短语（浮窗）：floating window 与 overlay 两组变体', async () => {
    const out = await resolveWords('浮窗', null)
    expect(out.variants).toEqual([['floating', 'window'], ['overlay']])
  })

  it('译文中的停用词照常过滤（the/of 不进词链）', async () => {
    const out = await resolveWords('这句词典肯定没有收录', fakeApis('the user name of the session'))
    expect(out.source).toBe('translate')
    expect(out.variants).toEqual([['user', 'name', 'session']])
  })

  it('翻译抛 SERVICE_ERROR 同样降级 offline（不只吃未配置错误）', async () => {
    await expect(resolveWords('词典外中文', failingApis())).rejects.toMatchObject({ kind: 'offline' })
  })
})
