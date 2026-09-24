// API 中心执行器与服务路由单测（原 src/plugins/translate/providers.test.ts 断言移植，语义逐项对齐）。
// fetch 一律注入 fake，不发真实网络请求。
import { describe, expect, it } from 'vitest'
import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import { fetchChecked, unescapeHtml } from '../src/main/services/api-center/executors/http'
import { executeHttpTemplate, extractTemplateResult } from '../src/main/services/api-center/executors/http-template'
import { executeMyMemory, parseMyMemoryBody } from '../src/main/services/api-center/executors/mymemory'
import { TranslateExecutorError, type FetchFn } from '../src/main/services/api-center/executors/types'
import { ApiCenterService, ApiServiceError } from '../src/main/services/api-center'
import type { FsLike } from '../src/main/settings-store'

const okBody = (body: string): HostFetchResult => ({ ok: true, status: 200, body })
const httpErr = (status: number): HostFetchResult => ({ ok: false, status, body: '' })

function recordingFetch(
  respond: (url: string, init?: HostFetchInit) => HostFetchResult | Error
): { fn: FetchFn; calls: { url: string; init?: HostFetchInit }[] } {
  const calls: { url: string; init?: HostFetchInit }[] = []
  const fn = async (url: string, init?: HostFetchInit): Promise<HostFetchResult> => {
    calls.push({ url, init })
    const r = respond(url, init)
    if (r instanceof Error) throw r
    return r
  }
  return { fn, calls }
}

function rt(fetch: FetchFn, timeoutMs?: number): { fetch: FetchFn; timeoutMs?: number } {
  return { fetch, timeoutMs }
}

async function rejectKind(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return '(resolved)'
  } catch (e) {
    expect(e).toBeInstanceOf(TranslateExecutorError)
    return (e as TranslateExecutorError).kind
  }
}

function rejectKindFn(f: () => unknown): string {
  try {
    f()
    return '(no-throw)'
  } catch (e) {
    expect(e).toBeInstanceOf(TranslateExecutorError)
    return (e as TranslateExecutorError).kind
  }
}

const zh = { text: '你好世界', from: 'zh-CN', to: 'en' }
const en = { text: 'hello', from: 'en', to: 'zh-CN' }

describe('fetchChecked 请求出口（分类移植）', () => {
  it('透传成功结果；默认超时 10s，可被 init 覆盖', async () => {
    const { fn, calls } = recordingFetch(() => okBody('r'))
    await expect(fetchChecked('https://a.example.com', rt(fn))).resolves.toEqual({ ok: true, status: 200, body: 'r' })
    expect(calls[0]?.init).toEqual({ timeoutMs: 10_000 })
    await fetchChecked('https://a.example.com', rt(fn), { timeoutMs: 50 })
    expect(calls[1]?.init).toEqual({ timeoutMs: 50 })
  })

  it('异常消息按超时/网络分类（含中文「超时」与非 Error 抛出）', async () => {
    const throwErr = (err: unknown) => recordingFetch(() => { throw err }).fn
    expect(await rejectKind(fetchChecked('https://a', rt(throwErr(new Error('Timeout reached')))))).toBe('timeout')
    expect(await rejectKind(fetchChecked('https://a', rt(throwErr(new Error('请求超时了')))))).toBe('timeout')
    expect(await rejectKind(fetchChecked('https://a', rt(throwErr(new Error('fetch failed')))))).toBe('network')
    expect(await rejectKind(fetchChecked('https://a', rt(throwErr('string boom'))))).toBe('network')
  })

  it('HTTP 非 2xx：403/429/482 归配额，其余归 http', async () => {
    for (const status of [403, 429, 482]) {
      const { fn } = recordingFetch(() => httpErr(status))
      expect(await rejectKind(fetchChecked('https://a', rt(fn)))).toBe('quota')
    }
    const { fn } = recordingFetch(() => httpErr(502))
    expect(await rejectKind(fetchChecked('https://a', rt(fn)))).toBe('http')
  })
})

describe('unescapeHtml 实体还原（移植）', () => {
  it('命名实体与大小写十六进制', () => {
    expect(unescapeHtml('&apos;&quot;x')).toBe(`'"x`)
    expect(unescapeHtml('&nbsp;x')).toBe('\u00a0x')
    expect(unescapeHtml('&#X41;&#x42;')).toBe('AB')
    expect(unescapeHtml('I&#39;m &quot;ok&quot;')).toBe(`I'm "ok"`)
  })

  it('非法码点与未知实体原样保留；嵌套只做一轮', () => {
    expect(unescapeHtml('&#0;')).toBe('&#0;')
    expect(unescapeHtml('&nosuch;')).toBe('&nosuch;')
    expect(unescapeHtml('a & b')).toBe('a & b')
    expect(unescapeHtml('&#38;lt;')).toBe('&lt;')
  })
})

describe('parseMyMemoryBody 业务层状态（移植）', () => {
  it('responseStatus 缺省回落 HTTP 状态；字符串数字可解析', () => {
    expect(parseMyMemoryBody(200, '{"responseData":{"translatedText":"ok"}}')).toBe('ok')
    expect(rejectKindFn(() => parseMyMemoryBody(500, '{"responseData":{"translatedText":"x"}}'))).toBe('http')
    expect(rejectKindFn(() => parseMyMemoryBody(200, '{"responseStatus":"429"}'))).toBe('quota')
  })

  it('配额优先于普通错误；无 details 用默认文案', () => {
    expect(rejectKindFn(() => parseMyMemoryBody(200, '{"responseStatus":482,"responseDetails":""}'))).toBe('quota')
    try {
      parseMyMemoryBody(200, '{"responseStatus":500,"responseDetails":""}')
      expect.unreachable()
    } catch (e) {
      expect((e as TranslateExecutorError).kind).toBe('http')
      expect((e as Error).message).toContain('500')
    }
  })

  it('译文非字符串/空串/坏 JSON/缺字段归 parse', () => {
    expect(rejectKindFn(() => parseMyMemoryBody(200, '{"responseData":{"translatedText":42},"responseStatus":200}'))).toBe('parse')
    expect(rejectKindFn(() => parseMyMemoryBody(200, '<html>gateway</html>'))).toBe('parse')
    expect(rejectKindFn(() => parseMyMemoryBody(200, '{"responseData":{},"responseStatus":200}'))).toBe('parse')
  })
})

describe('executeMyMemory（默认回退执行器）', () => {
  it('URL 参数编码（空格与竖线）；结果带 builtin:mymemory id', async () => {
    const { fn, calls } = recordingFetch(() => okBody('{"responseData":{"translatedText":"x"},"responseStatus":200}'))
    const out = await executeMyMemory({ text: 'hello world', from: 'en', to: 'zh-CN' }, rt(fn))
    expect(calls[0]?.url).toBe('https://api.mymemory.translated.net/get?q=hello+world&langpair=en%7Czh-CN')
    expect(out.providerId).toBe('builtin:mymemory')
  })

  it('空文本在请求前拦截（fetch 零调用）', async () => {
    const { fn, calls } = recordingFetch(() => okBody('{}'))
    expect(await rejectKind(executeMyMemory({ text: '\t\n', from: 'en', to: 'zh-CN' }, rt(fn)))).toBe('config')
    expect(calls).toHaveLength(0)
  })

  it('HTTP 200 但 body 配额错误透传 quota', async () => {
    const { fn } = recordingFetch(() => okBody('{"responseStatus":403,"responseDetails":"MYMEMORY WARNING"}'))
    expect(await rejectKind(executeMyMemory(zh, rt(fn)))).toBe('quota')
  })
})

describe('executeHttpTemplate（自定义 HTTP 接口执行器）', () => {
  const tpl = 'https://api.example.com/t?text={text}&from={from}&to={to}&key={key}'
  const baseCfg = { id: 'u-1', type: 'http-template' as const, name: 'n', enabled: true, endpoint: tpl, method: 'GET' as const, bodyTemplate: '', resultPath: '' }

  it('密钥含 URL 保留字符时编码；from/to 原样替换', async () => {
    const { fn, calls } = recordingFetch(() => okBody('r'))
    await executeHttpTemplate(en, rt(fn), { ...baseCfg, apiKey: 'a&b=c d' })
    expect(calls[0]?.url).toBe('https://api.example.com/t?text=hello&from=en&to=zh-CN&key=a%26b%3Dc%20d')
  })

  it('未配置地址 / 非 http(s) / 模板用 {key} 但缺密钥均归 config', async () => {
    const { fn } = recordingFetch(() => okBody('{}'))
    expect(await rejectKind(executeHttpTemplate(en, rt(fn), { ...baseCfg, endpoint: '' }))).toBe('config')
    expect(await rejectKind(executeHttpTemplate(en, rt(fn), { ...baseCfg, endpoint: 'ftp://x/{text}' }))).toBe('config')
    expect(await rejectKind(executeHttpTemplate(en, rt(fn), { ...baseCfg, apiKey: '' }))).toBe('config')
  })

  it('POST 请求体对引号/反斜杠/换行做 JSON 转义；Content-Type 为 application/json', async () => {
    const { fn, calls } = recordingFetch(() => okBody('ok'))
    await executeHttpTemplate(
      { text: 'he said "hi"\\path\nnext', from: 'en', to: 'zh-CN' },
      rt(fn),
      { ...baseCfg, endpoint: 'https://api.example.com/v2?key={key}', method: 'POST', bodyTemplate: '{"q":"{text}"}', apiKey: 'sk' }
    )
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(calls[0]?.init?.body).toBe('{"q":"he said \\"hi\\"\\\\path\\nnext"}')
  })

  it('结果路径支持数组下标；非 JSON 纯文本响应 trim 后直用；数字转字符串', async () => {
    const { fn } = recordingFetch(() => okBody('{"translations":[{"text":"你好"}]}'))
    const out = await executeHttpTemplate(en, rt(fn), { ...baseCfg, resultPath: 'translations.0.text', apiKey: 'k' })
    expect(out.resultText).toBe('你好')
    expect(out.providerId).toBe('u-1')

    const plain = recordingFetch(() => okBody('  plain  '))
    const out2 = await executeHttpTemplate(en, rt(plain.fn), { ...baseCfg, endpoint: 'https://a.example.com/x', apiKey: 'k' })
    expect(out2.resultText).toBe('plain')

    const num = recordingFetch(() => okBody('{"code":42}'))
    const out3 = await executeHttpTemplate(en, rt(num.fn), { ...baseCfg, endpoint: 'https://a.example.com/x', resultPath: 'code', apiKey: 'k' })
    expect(out3.resultText).toBe('42')
  })

  it('extractTemplateResult：路径取不到归 parse；resultPath 为空且根为对象时提示配置', () => {
    expect(() => extractTemplateResult('{"a":{}}', 'a.b.c')).toThrow(/未能从响应中取出字段/)
    expect(() => extractTemplateResult('{"a":1}', '')).toThrow(/结果字段路径/)
    expect(() => extractTemplateResult('', 'a')).toThrow()
  })
})

// ---------- 全局中心路径（B.5.1 补充用例：activeProviderId 路由、回退默认、禁用 provider） ----------

const noopFs = { readFile: async () => { throw new Error('ENOENT') }, writeFile: async () => {}, rename: async () => {}, mkdir: async () => {} } as FsLike

function makeService(fetch: FetchFn, notify?: () => void): ApiCenterService {
  return new ApiCenterService({ dir: '/data', fs: noopFs, fetch, notify, generateId: () => 'u-abcd1234' })
}

const httpProviderForm = {
  type: 'http-template' as const,
  name: 'DeepL',
  endpoint: 'https://x.example.com/?q={text}&key={key}',
  method: 'GET' as const,
  newApiKey: 'mk-9'
}

describe('ApiCenterService 路由与状态', () => {
  it('全新环境零配置：status 未配置、translate 回退默认 MyMemory（= 0.1.0 行为）', async () => {
    const { fn, calls } = recordingFetch(() => okBody('{"responseData":{"translatedText":"Hello"},"responseStatus":200}'))
    const svc = makeService(fn)
    await svc.load()
    expect(svc.status('translate')).toMatchObject({ configured: false, activeProviderId: '', activeProviderName: 'MyMemory（默认免 Key）' })
    const out = await svc.translate({ text: '你好', from: 'zh-CN', to: 'en' })
    expect(out.resultText).toBe('Hello')
    expect(calls[0].url).toContain('api.mymemory.translated.net')
  })

  it('配置 http-template 并设为 active：路由到自定义接口，密钥参与模板渲染', async () => {
    const { fn, calls } = recordingFetch(() => okBody('r'))
    const svc = makeService(fn)
    await svc.load()
    const view = await svc.upsertProvider(httpProviderForm)
    const id = view.services.translate.providers[0].id
    expect(id).toMatch(/^u-[0-9a-f]{8}$/)
    await svc.setActive(id)
    expect(svc.status('translate')).toMatchObject({ configured: true, activeProviderId: id, activeProviderName: 'DeepL' })
    await svc.translate({ text: '你好', from: 'zh-CN', to: 'en' })
    expect(calls[0].url).toBe('https://x.example.com/?q=%E4%BD%A0%E5%A5%BD&key=mk-9')
  })

  it('禁用当前 provider：status 仍指向它，translate 抛 SERVICE_UNCONFIGURED（运行态不静默回退）', async () => {
    const { fn } = recordingFetch(() => okBody('r'))
    const svc = makeService(fn)
    await svc.load()
    const view = await svc.upsertProvider(httpProviderForm)
    const id = view.services.translate.providers[0].id
    await svc.setActive(id)
    await svc.upsertProvider({ ...httpProviderForm, id, enabled: false, newApiKey: undefined })
    const active = svc.config.services.translate.providers.find((p) => p.id === id)
    expect(active?.enabled).toBe(false)
    expect(svc.status('translate').configured).toBe(true)
    await expect(svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })).rejects.toMatchObject({
      code: 'SERVICE_UNCONFIGURED'
    })
  })

  it('executor 失败包装为 SERVICE_ERROR，message 前缀分类（network/quota）', async () => {
    const offline = makeService(recordingFetch(() => new Error('getaddrinfo ENOTFOUND')).fn)
    await offline.load()
    await offline.upsertProvider(httpProviderForm).then((v) => offline.setActive(v.services.translate.providers[0].id))
    const err = (await offline.translate({ text: 'hi', from: 'en', to: 'zh-CN' }).catch((e) => e)) as ApiServiceError
    expect(err).toBeInstanceOf(ApiServiceError)
    expect(err.code).toBe('SERVICE_ERROR')
    expect(err.message.startsWith('network:')).toBe(true)

    const quota = makeService(recordingFetch(() => httpErr(429)).fn)
    await quota.load() // 未配置 → 默认 MyMemory 也走同一分类
    const err2 = (await quota.translate({ text: 'hi', from: 'en', to: 'zh-CN' }).catch((e) => e)) as ApiServiceError
    expect(err2.code).toBe('SERVICE_ERROR')
    expect(err2.message.startsWith('quota:')).toBe(true)
  })

  it('sanitized 视图不含明文密钥（hasKey 布尔），upsert 留空 newApiKey 不覆盖已存密钥', async () => {
    const svc = makeService(recordingFetch(() => okBody('r')).fn)
    await svc.load()
    const view = await svc.upsertProvider(httpProviderForm)
    expect(JSON.stringify(view)).not.toContain('mk-9')
    expect(view.services.translate.providers[0].hasKey).toBe(true)

    const id = view.services.translate.providers[0].id
    await svc.upsertProvider({ ...httpProviderForm, id, newApiKey: undefined })
    expect(svc.config.services.translate.providers[0].apiKey).toBe('mk-9')
  })

  it('setActive("") 回默认；remove 当前 provider 连同 active 重置；mymemory 类型固定 id 且不落密钥字段要求', async () => {
    const svc = makeService(recordingFetch(() => okBody('r')).fn)
    await svc.load()
    const v1 = await svc.upsertProvider(httpProviderForm)
    const id = v1.services.translate.providers[0].id
    await svc.setActive(id)
    await svc.setActive('')
    expect(svc.status('translate').configured).toBe(false)

    await svc.setActive(id)
    const v2 = await svc.removeProvider(id)
    expect(v2.services.translate.providers).toHaveLength(0)
    expect(svc.status('translate').activeProviderId).toBe('')

    const v3 = await svc.upsertProvider({ type: 'mymemory', name: 'MyMemory 备用' })
    expect(v3.services.translate.providers[0].id).toBe('builtin:mymemory')
    // 重复添加 mymemory = 更新既有条目而非新增
    await svc.upsertProvider({ type: 'mymemory', name: '改名' })
    expect(svc.config.services.translate.providers).toHaveLength(1)
    expect(svc.config.services.translate.providers[0].name).toBe('改名')
  })

  it('配置变更触发 notify 广播回调', async () => {
    let notified = 0
    const svc = makeService(recordingFetch(() => okBody('r')).fn, () => notified++)
    await svc.load()
    await svc.upsertProvider(httpProviderForm)
    await svc.setActive('')
    expect(notified).toBe(2)
  })

  it('testProvider：draft 不落库、用 newApiKey；已存 provider 用已存密钥；默认路径测试 MyMemory', async () => {
    const { fn, calls } = recordingFetch((url) =>
      url.startsWith('https://a.example.com')
        ? okBody('你好')
        : okBody('{"responseData":{"translatedText":"你好"},"responseStatus":200}')
    )
    const svc = makeService(fn)
    await svc.load()
    const r = await svc.testProvider(undefined, { type: 'http-template', name: '草稿', endpoint: 'https://a.example.com/x' })
    expect(r.ok).toBe(true)
    expect(r.resultText).toBe('你好')
    expect(calls[0].url).toBe('https://a.example.com/x') // 模板无占位符：URL 原样发出
    expect(svc.isTranslateEmpty()).toBe(true) // 草稿测试不保存

    const r2 = await svc.testProvider() // 无 id 无 draft → 默认 MyMemory
    expect(r2.ok).toBe(true)
    expect(calls[1].url).toContain('api.mymemory.translated.net')
  })

  it('upsert 校验：非 http(s) 地址与模板缺密钥直接报错', async () => {
    const svc = makeService(recordingFetch(() => okBody('r')).fn)
    await svc.load()
    await expect(svc.upsertProvider({ type: 'http-template', name: 'x', endpoint: 'ftp://a' })).rejects.toThrow(/http/)
    await expect(
      svc.upsertProvider({ type: 'http-template', name: 'x', endpoint: 'https://a.example.com/?key={key}' })
    ).rejects.toThrow(/密钥/)
  })
})
