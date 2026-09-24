// 取词链测试（DESIGN C.6）：英文直通 → 本地词典 → apis.translate → offline，apis 注入 fake
import { describe, expect, it } from 'vitest'
import { LookupError, hasCJK, resolveWords, type ApisLike } from '../../../../src/plugins/var-name/logic/lookup'
import { ZH_EN, normalizeZh } from '../../../../src/plugins/var-name/data/zh-en'

const fakeApis = (resultText: string): ApisLike => ({
  invoke: async () => ({ resultText })
})

const failingApis = (): ApisLike => ({
  invoke: async () => {
    throw new Error('SERVICE_UNCONFIGURED')
  }
})

describe('语言判定与归一化', () => {
  it('hasCJK', () => {
    expect(hasCJK('用户配置')).toBe(true)
    expect(hasCJK('user 配置')).toBe(true)
    expect(hasCJK('user settings')).toBe(false)
    expect(hasCJK('')).toBe(false)
  })

  it('normalizeZh：全角→半角、空白折叠、trim', () => {
    expect(normalizeZh('　用户配置　')).toBe('用户配置')
    expect(normalizeZh('用户  配置')).toBe('用户 配置')
    expect(normalizeZh('，')).toBe(',')
  })
})

describe('resolveWords 取词链', () => {
  it('英文输入零网络零词典直通（fake apis 抛错也不该被调用）', async () => {
    const out = await resolveWords('userName parser', failingApis())
    expect(out.source).toBe('english')
    expect(out.variants).toEqual([['user', 'name', 'parser']])
  })

  it('空输入 → 空变体', async () => {
    const out = await resolveWords('   ', null)
    expect(out.variants).toEqual([])
  })

  it('本地词典命中：多义项全收 + avoid 警示（apis 为 null 也不走网络）', async () => {
    const out = await resolveWords('用户配置', null)
    expect(out.source).toBe('dict')
    expect(out.variants.length).toBeGreaterThanOrEqual(2)
    expect(out.variants[0]).toEqual(['user', 'settings'])
    expect(out.avoid.join()).toContain('user configuration')
  })

  it('词典归一化命中：全角空格/多余空白', async () => {
    const out = await resolveWords('　内存泄漏　', null)
    expect(out.source).toBe('dict')
    expect(out.variants[0]).toEqual(['memory', 'leak'])
  })

  it('词典未收录 → apis.translate 兜底并分词译文', async () => {
    const out = await resolveWords('把货架上的商品按价格排序', fakeApis('sort products by price'))
    expect(out.source).toBe('translate')
    expect(out.variants).toEqual([['sort', 'products', 'by', 'price']])
  })

  it('SERVICE_UNCONFIGURED / 网络错 → LookupError(offline)，文案含设置指引', async () => {
    await expect(resolveWords('未收录的中文描述', failingApis())).rejects.toMatchObject({ name: 'LookupError', kind: 'offline' })
    try {
      await resolveWords('未收录的中文描述', failingApis())
      expect.unreachable('应抛 LookupError')
    } catch (err) {
      expect(err instanceof LookupError && err.message).toContain('设置 → API 服务')
    }
  })

  it('apis 为 null 且词典未收录 → offline（无翻译可用）', async () => {
    await expect(resolveWords('一句完全没收录的话', null)).rejects.toMatchObject({ kind: 'offline' })
  })

  it('翻译返回空文本视为失败', async () => {
    await expect(resolveWords('完全没收录的句子', fakeApis('   '))).rejects.toMatchObject({ kind: 'offline' })
  })
})

describe('词典数据完整性', () => {
  it('归一化后 zh 键不重复', () => {
    const seen = new Map<string, string>()
    for (const e of ZH_EN) {
      const k = normalizeZh(e.zh)
      expect(seen.has(k), `重复词条：${e.zh}`).toBe(false)
      seen.set(k, e.zh)
    }
  })

  it('每条 en 短语可分词出至少一个词（tokenize 后非空）', () => {
    for (const e of ZH_EN) {
      expect(e.en.length).toBeGreaterThan(0)
      for (const phrase of e.en) {
        expect(phrase.trim(), `${e.zh} 的短语为空`).not.toBe('')
      }
    }
  })

  it('规模 ≥ 100 条（DESIGN C.6：约 110 条四域）', () => {
    expect(ZH_EN.length).toBeGreaterThanOrEqual(100)
    const domains = new Set(ZH_EN.map((e) => e.domain))
    expect([...domains].sort()).toEqual(['code', 'network', 'product', 'ui'])
  })
})
