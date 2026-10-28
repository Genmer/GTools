// 容灾循环与熔断单测：注入 now 时钟与 fake fetch，断言候选顺序、熔断跳过、非容灾 kind 立即终止、
// 全挂轨迹与 fallback 信息；百度 54003 后第二次零网络（fetch 调用次数）。
import { describe, expect, it } from 'vitest'
import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import { ApiCenterService, ApiServiceError, ProviderBreaker } from '../src/main/services/api-center'
import type { FsLike } from '../src/main/settings-store'

const okBody = (body: string): HostFetchResult => ({ ok: true, status: 200, body })
const MYMEMORY_OK = okBody('{"responseData":{"translatedText":"内置译文"},"responseStatus":200}')

const noopFs = { readFile: async () => { throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }) }, writeFile: async () => {}, rename: async () => {}, mkdir: async () => {} } as FsLike

interface Harness {
  svc: ApiCenterService
  calls: { url: string; init?: HostFetchInit }[]
  setRespond: (fn: (url: string, init?: HostFetchInit) => HostFetchResult) => void
  clock: { now: number }
}

/** 按需写入原始配置（sanitize 通道与真实一致），fetch 行为可中途切换 */
async function harness(raw: unknown, startNow = 1_000_000): Promise<Harness> {
  const clock = { now: startNow }
  const calls: { url: string; init?: HostFetchInit }[] = []
  let respond: (url: string, init?: HostFetchInit) => HostFetchResult = () => MYMEMORY_OK
  const fetch = async (url: string, init?: HostFetchInit): Promise<HostFetchResult> => {
    calls.push({ url, init })
    return respond(url, init)
  }
  const svc = new ApiCenterService({ dir: '/data', fs: noopFs, fetch, generateId: () => 'u-fixed000', now: () => clock.now })
  await svc.load()
  await svc.replaceAll(raw)
  const setRespond = (fn: (url: string, init?: HostFetchInit) => HostFetchResult): void => {
    respond = fn
  }
  return { svc, calls, setRespond, clock }
}

const httpProvider = (id: string, name = id): Record<string, unknown> => ({
  id,
  type: 'http-template',
  name,
  enabled: true,
  endpoint: `https://${id}.example.com/?q={text}`,
  method: 'GET',
  bodyTemplate: '',
  resultPath: ''
})

const config = (activeProviderId: string, ...providers: unknown[]): unknown => ({
  services: { translate: { activeProviderId, providers } }
})

describe('translate 容灾循环', () => {
  it('显式 providerId：目标失败立即终止，不容灾不 trip（零额外网络）', async () => {
    const h = await harness(config('', httpProvider('a'), httpProvider('b')))
    h.setRespond(() => ({ ok: false, status: 429, body: '' }))
    const err = (await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN', providerId: 'a' }).catch((e) => e)) as ApiServiceError
    expect(err).toBeInstanceOf(ApiServiceError)
    expect(err.code).toBe('SERVICE_ERROR')
    expect(err.kind).toBe('quota')
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].url).toContain('https://a.example.com')
    // 未 trip：显式路径失败不影响后续全局调用仍从 a 开始（内置 MyMemory 首位）
    h.setRespond((url) => (url.includes('mymemory') ? MYMEMORY_OK : okBody('ok')))
    const out = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out.resultText).toBe('内置译文')
    expect(h.calls[1].url).toContain('api.mymemory.translated.net')
  })

  it('显式 providerId 指向禁用/不存在引擎：SERVICE_UNCONFIGURED 且不碰网络', async () => {
    const h = await harness(config('', httpProvider('a'), { ...httpProvider('off'), enabled: false } as Record<string, unknown>))
    await expect(h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN', providerId: 'off' })).rejects.toMatchObject({ code: 'SERVICE_UNCONFIGURED' })
    await expect(h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN', providerId: 'ghost' })).rejects.toMatchObject({ code: 'SERVICE_UNCONFIGURED' })
    expect(h.calls).toHaveLength(0)
  })

  it('未设 active：内置 MyMemory 首位，失败切启用引擎并附 fallback 信息', async () => {
    const h = await harness(config('', httpProvider('a')))
    let n = 0
    h.setRespond(() => {
      n++
      return n === 1 ? { ok: false, status: 429, body: '' } : okBody('引擎译文')
    })
    const out = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out.resultText).toBe('引擎译文')
    expect(out.providerId).toBe('a')
    expect(out.fallback).toEqual({ requestedProviderId: '', reason: expect.stringMatching(/^quota: /) as unknown as string })
    expect(h.calls).toHaveLength(2)
    expect(h.calls[0].url).toContain('api.mymemory.translated.net')
    expect(h.calls[1].url).toContain('https://a.example.com')
  })

  it('设过 active：active 首位、其余启用引擎随后、内置不进候选', async () => {
    const h = await harness(config('a', httpProvider('a'), httpProvider('b')))
    let n = 0
    h.setRespond(() => {
      n++
      return n === 1 ? { ok: false, status: 401, body: '' } : okBody('b 译文')
    })
    const out = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out.providerId).toBe('b')
    expect(out.fallback?.requestedProviderId).toBe('a')
    expect(out.fallback?.reason).toMatch(/^auth: /)
    expect(h.calls.map((c) => c.url)).toEqual(['https://a.example.com/?q=hi', 'https://b.example.com/?q=hi'])
  })

  it('非容灾 kind（config/parse/timeout/network）立即终止不容灾', async () => {
    for (const kind of [
      { status: 400, expect: 'config' }, // http-template 模板路径错误 → config
      { status: 502, expect: 'http' }
    ] as const) {
      // http 不在此列：http 属容灾类别
      if (kind.expect === 'http') continue
      const h = await harness(config('a', httpProvider('a'), httpProvider('b')))
      h.setRespond(() => ({ ok: false, status: kind.status, body: '' }))
      const err = (await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' }).catch((e) => e)) as ApiServiceError
      expect(err.kind).toBe('config')
      expect(h.calls).toHaveLength(1)
    }
    // network：fetch 抛错立即终止
    const net = await harness(config('a', httpProvider('a'), httpProvider('b')))
    net.setRespond(() => {
      throw new Error('fetch failed')
    })
    const netErr = (await net.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' }).catch((e) => e)) as ApiServiceError
    expect(netErr.kind).toBe('network')
    expect(net.calls).toHaveLength(1)
    // parse：HTTP 200 但取不出结果字段
    const parse = await harness(config('a', httpProvider('a'), httpProvider('b')))
    parse.setRespond(() => okBody('{"unrelated":1}'))
    const parseErr = (await parse.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' }).catch((e) => e)) as ApiServiceError
    expect(parseErr.kind).toBe('parse')
    expect(parse.calls).toHaveLength(1)
  })

  it('全挂：错误 message 含尝试轨迹（名称 + kind）', async () => {
    const h = await harness(config('甲', httpProvider('甲'), httpProvider('乙')))
    h.setRespond(() => ({ ok: false, status: 500, body: '' }))
    const err = (await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' }).catch((e) => e)) as ApiServiceError
    expect(err.code).toBe('SERVICE_ERROR')
    expect(err.kind).toBe('http')
    expect(err.message).toContain('甲(http) → 乙(http)')
    expect(err.message).toContain('均失败')
    expect(h.calls).toHaveLength(2)
  })

  it('全挂轨迹（含内置默认）：未设 active 时内置也进轨迹', async () => {
    const h = await harness(config('', httpProvider('a')))
    h.setRespond(() => ({ ok: false, status: 429, body: '' }))
    const err = (await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' }).catch((e) => e)) as ApiServiceError
    expect(err.message).toContain('MyMemory（默认免 Key）(quota) → a(quota)')
  })
})

describe('熔断器与候选过滤', () => {
  it('百度 54003（配额）后：第二次调用零网络跳过百度，直接用次选', async () => {
    const raw = config('baidu1', {
      id: 'baidu1',
      type: 'baidu',
      name: '百度',
      enabled: true,
      secrets: { appId: 'app', secretKey: 'sk' }
    })
    const h = await harness(raw)
    h.setRespond((url) =>
      url.includes('fanyi-api.baidu.com')
        ? okBody('{"error_code":"54003","error_msg":"Limited flow"}')
        : okBody('备用译文')
    )
    const err = (await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' }).catch((e) => e)) as ApiServiceError
    // 唯一启用的百度挂掉且无次选：全挂报错
    expect(err.kind).toBe('quota')
    expect(h.calls.filter((c) => c.url.includes('baidu'))).toHaveLength(1)

    // 再挂一家可用引擎进候选（upsertProvider 是配置编辑通道，不动熔断；replaceAll 属备份导入语义会复位熔断）
    await h.svc.upsertProvider({ id: 'backup', type: 'http-template', name: 'backup', endpoint: 'https://backup.example.com/?q={text}' })
    const out = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    // 熔断生效：百度零额外请求，直接命中 backup；首选百度被跳过仍如实附 fallback（reason 取熔断记录）
    expect(h.calls.filter((c) => c.url.includes('baidu'))).toHaveLength(1)
    expect(out.providerId).toBe('backup')
    expect(out.fallback?.requestedProviderId).toBe('baidu1')
    expect(out.fallback?.reason).toMatch(/^quota: /)
  })

  it('熔断 120s 冷却：到期自动放行；成功后 clear 清历史', async () => {
    const h = await harness(config('a', httpProvider('a'), httpProvider('b')))
    h.setRespond((url) => (url.includes('a.example') ? { ok: false, status: 429, body: '' } : okBody('ok')))
    const out1 = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out1.providerId).toBe('b')
    expect(h.calls.filter((c) => c.url.includes('a.example'))).toHaveLength(1)
    // 冷却期内：a 仍被跳过；b 直取成功也如实指向 a（requestedProviderId=配置序首位）
    const again = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(again.providerId).toBe('b')
    expect(again.fallback?.requestedProviderId).toBe('a')
    expect(again.fallback?.reason).toMatch(/^quota: /)
    expect(h.calls.filter((c) => c.url.includes('a.example'))).toHaveLength(1)
    // 到期放行（now 前进 120s）
    h.clock.now += 120_000
    h.setRespond(() => okBody('a 恢复'))
    const out2 = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out2.providerId).toBe('a')
    expect(out2.fallback).toBeUndefined()
    expect(h.calls.filter((c) => c.url.includes('a.example'))).toHaveLength(2)
  })

  it('全候选熔断中：忽略熔断硬试兜底', async () => {
    const h = await harness(config('a', httpProvider('a')))
    h.setRespond(() => ({ ok: false, status: 429, body: '' }))
    await expect(h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })).rejects.toMatchObject({ kind: 'quota' })
    expect(h.calls).toHaveLength(1)
    // 仍处冷却期但无其他候选：忽略熔断再试 a（网络再次发出）
    await expect(h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })).rejects.toMatchObject({ kind: 'quota' })
    expect(h.calls).toHaveLength(2)
  })

  it('非容灾失败不 trip：config 失败后引擎仍在候选首位', async () => {
    const h = await harness(config('a', httpProvider('a')))
    h.setRespond(() => okBody('{"bad":1}')) // parse 失败 → 非容灾
    await expect(h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })).rejects.toMatchObject({ kind: 'parse' })
    h.setRespond(() => okBody('ok'))
    const out = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out.providerId).toBe('a')
    expect(out.fallback).toBeUndefined()
  })

  it('timeout 归 timeout 类并立即终止（默认 10s 超时参数透传）', async () => {
    const h = await harness(config('a', httpProvider('a'), httpProvider('b')))
    h.setRespond(() => {
      throw new Error('Request timeout after 10000ms')
    })
    const err = (await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' }).catch((e) => e)) as ApiServiceError
    expect(err.kind).toBe('timeout')
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].init?.timeoutMs).toBe(10_000)
  })
})

describe('ProviderBreaker 单元（注入时钟，阈值 1）', () => {
  it('trip 一次即开；lastReason 保留；未知 id 恒闭', () => {
    const clock = { now: 1_000 }
    const b = new ProviderBreaker(() => clock.now, 120_000)
    expect(b.isOpen('x')).toBe(false)
    b.trip('x', '配额受限')
    expect(b.isOpen('x')).toBe(true)
    expect(b.lastReason('x')).toBe('配额受限')
    expect(b.isOpen('other')).toBe(false)
    expect(b.lastReason('other')).toBeNull()
  })

  it('冷却到期自动闭合：until-1 仍开、到 until 恰好闭合（>= 语义）且清理记录', () => {
    const clock = { now: 1_000 }
    const b = new ProviderBreaker(() => clock.now, 120_000)
    b.trip('x', 'r')
    clock.now += 120_000 - 1
    expect(b.isOpen('x')).toBe(true)
    clock.now += 1
    expect(b.isOpen('x')).toBe(false)
    expect(b.lastReason('x')).toBeNull()
  })

  it('clear 后立即可用（无需等冷却）', () => {
    const clock = { now: 1_000 }
    const b = new ProviderBreaker(() => clock.now, 120_000)
    b.trip('x', 'r')
    b.clear('x')
    expect(b.isOpen('x')).toBe(false)
    expect(b.lastReason('x')).toBeNull()
  })
})

describe('fallback 字段语义', () => {
  it('首选被熔断跳过时 requestedProviderId 仍指向配置的 active（次选一次成功也如实提示）', async () => {
    const h = await harness(config('a', httpProvider('a'), httpProvider('b'), httpProvider('c')))
    // 第一轮：a quota 失败（trip a），b 成功
    h.setRespond((url) => (url.includes('a.example') ? { ok: false, status: 429, body: '' } : okBody('ok')))
    const out1 = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out1.providerId).toBe('b')
    expect(out1.fallback?.requestedProviderId).toBe('a')
    // 第二轮：a 已熔断被跳过、b 一次成功 → 仍指向 a，reason 取 a 的熔断记录（kind 前缀格式）
    const out2 = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out2.providerId).toBe('b')
    expect(out2.fallback?.requestedProviderId).toBe('a')
    expect(out2.fallback?.reason).toMatch(/^quota: /)
    expect(h.calls.filter((c) => c.url.includes('a.example'))).toHaveLength(1) // a 只在第一轮被打过
  })

  it('active 熔断 + 次选失败 + 三选成功：requestedProviderId=active，reason 取 active 熔断记录而非次选本次失败', async () => {
    const h = await harness(config('a', httpProvider('a'), httpProvider('b'), httpProvider('c')))
    // 第一轮熔断 a（429 → quota）
    h.setRespond((url) => (url.includes('a.example') ? { ok: false, status: 429, body: '' } : okBody('ok')))
    await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    // 第二轮：a 被跳过，b 401 失败（auth），c 成功
    h.setRespond((url) => (url.includes('b.example') ? { ok: false, status: 401, body: '' } : okBody('c 译文')))
    const out = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out.providerId).toBe('c')
    expect(out.fallback?.requestedProviderId).toBe('a')
    // a 的熔断记录是 quota 类；若误取次选 b 的本次失败会是 auth 类——据此区分来源
    expect(out.fallback?.reason).toMatch(/^quota: /)
    expect(h.calls.filter((c) => c.url.includes('a.example'))).toHaveLength(1)
  })

  it('MyMemory 双重候选去重：active 为空且启用 MyMemory 条目时，全部失败内置端点也只打一次、轨迹只一行', async () => {
    const h = await harness(
      config('', { id: 'builtin:mymemory', type: 'mymemory', name: 'MyMemory 备用', enabled: true })
    )
    h.setRespond((url) => (url.includes('mymemory') ? { ok: false, status: 429, body: '' } : { ok: false, status: 500, body: '' }))
    const err = (await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' }).catch((e) => e)) as ApiServiceError
    expect(err.message).toContain('（已尝试 MyMemory（默认免 Key）(quota)，均失败）')
    expect(h.calls.filter((c) => c.url.includes('api.mymemory.translated.net'))).toHaveLength(1)
  })

  it('首选成功与显式 providerId 成功都不携带 fallback 字段', async () => {
    const h = await harness(config('a', httpProvider('a'), httpProvider('b')))
    h.setRespond(() => okBody('首选译文'))
    const out = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out.resultText).toBe('首选译文')
    expect(out.fallback).toBeUndefined()
    const direct = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN', providerId: 'b' })
    expect(direct.providerId).toBe('b')
    expect(direct.fallback).toBeUndefined()
  })
})

describe('upsert newSecrets 空串保留语义', () => {
  it('空串不清已存值、新值覆盖、缺省键不动', async () => {
    const h = await harness(config('', {
      id: 'd',
      type: 'deepl',
      name: 'DeepL',
      enabled: true,
      secrets: { authKey: 'old-key' }
    }))
    await h.svc.upsertProvider({ id: 'd', type: 'deepl', name: 'DeepL', newSecrets: { authKey: '' } })
    expect(h.svc.config.services.translate.providers[0].secrets).toEqual({ authKey: 'old-key' })
    await h.svc.upsertProvider({ id: 'd', type: 'deepl', name: 'DeepL', newSecrets: { authKey: 'new-key' } })
    expect(h.svc.config.services.translate.providers[0].secrets).toEqual({ authKey: 'new-key' })
    await h.svc.upsertProvider({ id: 'd', type: 'deepl', name: 'DeepL 改名' })
    expect(h.svc.config.services.translate.providers[0].secrets).toEqual({ authKey: 'new-key' })
  })

  it('多字段只更新其一：另一字段空串/缺省均保留旧值', async () => {
    const h = await harness(config('', {
      id: 'b1',
      type: 'baidu',
      name: '百度',
      enabled: true,
      secrets: { appId: 'oldApp', secretKey: 'oldSk' }
    }))
    await h.svc.upsertProvider({ id: 'b1', type: 'baidu', name: '百度', newSecrets: { appId: 'newApp', secretKey: '' } })
    expect(h.svc.config.services.translate.providers[0].secrets).toEqual({ appId: 'newApp', secretKey: 'oldSk' })
  })
})

describe('testProvider 直连（不进容灾循环）', () => {
  it('draft 凭证缺失报 config：零网络，不触发其他已配置源', async () => {
    const h = await harness(config('a', httpProvider('a'), httpProvider('b')))
    const r = await h.svc.testProvider(undefined, { type: 'deepl', name: 'DeepL 草稿' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('config')
    expect(r.error).toContain('Auth Key')
    expect(h.calls).toHaveLength(0)
  })

  it('draft 凭证齐全但服务端 401：只打目标引擎一次，失败也不容灾、不 trip', async () => {
    const h = await harness(config('a', httpProvider('a'), httpProvider('b')))
    h.setRespond(() => ({ ok: false, status: 401, body: '' }))
    const r = await h.svc.testProvider(undefined, { type: 'deepl', name: 'DeepL 草稿', newSecrets: { authKey: 'k:fx' } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('auth')
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].url).toBe('https://api-free.deepl.com/v2/translate')
    // 直连失败不 trip：后续全局调用仍从容灾首选 a 开始
    h.setRespond((url) => (url.includes('a.example') ? okBody('a 译文') : okBody('ok')))
    const out = await h.svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out.providerId).toBe('a')
    expect(out.fallback).toBeUndefined()
  })
})
