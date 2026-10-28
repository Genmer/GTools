// ApiCenterService 未覆盖路径补充：replaceAll 备份导入、损坏文件加载、replace 前置 load、testProvider 按 id 取已存密钥、表单校验。
// FsLike 与 fetch 全部注入 fake，不发真实 IO 与网络。
import { describe, expect, it } from 'vitest'
import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import { ApiCenterService, ApiServiceError } from '../src/main/services/api-center'
import { ApiCenterStore } from '../src/main/services/api-center/store'
import type { FsLike } from '../src/main/settings-store'

const okBody = (body: string): HostFetchResult => ({ ok: true, status: 200, body })

function recordingFetch(
  respond: (url: string, init?: HostFetchInit) => HostFetchResult | Error
): { fn: (url: string, init?: HostFetchInit) => Promise<HostFetchResult>; calls: { url: string; init?: HostFetchInit }[] } {
  const calls: { url: string; init?: HostFetchInit }[] = []
  const fn = async (url: string, init?: HostFetchInit): Promise<HostFetchResult> => {
    calls.push({ url, init })
    const r = respond(url, init)
    if (r instanceof Error) throw r
    return r
  }
  return { fn, calls }
}

function memFs(initial: Record<string, string> = {}): FsLike & { files: Map<string, string>; readFailCode: string | null } {
  const files = new Map(Object.entries(initial))
  // 非 null 时 readFile 一律抛该错误码（模拟杀软/备份软件瞬时锁文件）
  let readFailCode: string | null = null
  return {
    files,
    get readFailCode(): string | null {
      return readFailCode
    },
    set readFailCode(code: string | null) {
      readFailCode = code
    },
    readFile: async (path: string) => {
      if (readFailCode !== null) {
        throw Object.assign(new Error(`${readFailCode}: read failed: ${path}`), { code: readFailCode })
      }
      const v = files.get(path)
      if (v === undefined) throw Object.assign(new Error(`ENOENT: no such file: ${path}`), { code: 'ENOENT' })
      return v
    },
    writeFile: async (path: string, data: string) => {
      files.set(path, data)
    },
    rename: async (from: string, to: string) => {
      files.set(to, files.get(from) ?? '')
      files.delete(from)
    },
    mkdir: async () => undefined
  }
}

function makeService(opts?: { fetch?: (url: string, init?: HostFetchInit) => Promise<HostFetchResult>; notify?: () => void; fs?: FsLike; generateId?: () => string }): ApiCenterService {
  return new ApiCenterService({
    dir: '/data',
    fs: opts?.fs ?? memFs(),
    fetch: opts?.fetch ?? (async () => okBody('r')),
    notify: opts?.notify,
    generateId: opts?.generateId
  })
}

const httpForm = {
  type: 'http-template' as const,
  name: 'DeepL',
  endpoint: 'https://x.example.com/?q={text}&key={key}',
  method: 'GET' as const,
  newSecrets: { apiKey: 'mk-9' }
}

describe('ApiCenterStore 边界', () => {
  it('损坏 JSON 文件加载 → 回默认配置不抛错', async () => {
    const store = new ApiCenterStore('/data', memFs({ '/data/api-services.json': '{oops' }), 10)
    await store.load()
    expect(store.config).toEqual({
      services: { translate: { activeProviderId: '', providers: [] }, ai: { activeProviderId: '', providers: [] } }
    })
  })

  it('未 load 直接 replace：先自动加载再替换，落盘为替换值', async () => {
    const fs = memFs({
      '/data/api-services.json': JSON.stringify({
        services: { translate: { activeProviderId: 'x', providers: [{ id: 'x', type: 'mymemory', name: '旧', enabled: true }] } }
      })
    })
    const store = new ApiCenterStore('/data', fs, 10)
    const next = { services: { translate: { activeProviderId: 'y', providers: [{ id: 'y', type: 'mymemory', name: '新', enabled: true }] } } }
    const out = await store.replace(next)
    expect(out.services.translate.providers.map((p) => p.id)).toEqual(['y'])
    await store.flush()
    const saved = JSON.parse(fs.files.get('/data/api-services.json') as string)
    expect(saved.services.translate.activeProviderId).toBe('y')
  })
})

describe('replaceAll 备份导入', () => {
  it('垃圾数据 → sanitize 成空配置并广播，不抛错', async () => {
    let notified = 0
    const svc = makeService({ notify: () => notified++ })
    await svc.load()
    await svc.replaceAll('garbage')
    expect(svc.isTranslateEmpty()).toBe(true)
    expect(svc.status('translate').configured).toBe(false)
    expect(notified).toBe(1)
  })

  it('合法数据整体生效（含 active），密钥留在主进程内存态', async () => {
    const svc = makeService()
    await svc.load()
    await svc.replaceAll({
      services: {
        translate: {
          activeProviderId: 'p1',
          providers: [{ id: 'p1', type: 'http-template', name: '导入', enabled: true, endpoint: 'https://a.example.com/x', secrets: { apiKey: 'sk-import' } }]
        }
      }
    })
    expect(svc.status('translate')).toMatchObject({ configured: true, activeProviderId: 'p1', activeProviderName: '导入' })
    expect(svc.config.services.translate.providers[0].secrets?.apiKey).toBe('sk-import')
    expect(svc.sanitized().services.translate.providers[0].hasSecrets.apiKey).toBe(true)
  })

  it('replaceAll 换配置后旧熔断记录失效：同 id 新配置立即可用不被旧冷却误伤', async () => {
    // old 端点恒 401（auth → 容灾并熔断 p1），其余端点成功
    const net = recordingFetch((url) => (url.includes('old.example.com') ? { ok: false, status: 401, body: '' } : okBody('hello')))
    const svc = makeService({ fetch: net.fn })
    await svc.load()
    await svc.replaceAll({
      services: {
        translate: {
          activeProviderId: 'p1',
          providers: [
            { id: 'p1', type: 'http-template', name: '首选', enabled: true, endpoint: 'https://old.example.com/?q={text}' },
            { id: 'p2', type: 'http-template', name: '备选', enabled: true, endpoint: 'https://backup.example.com/?q={text}' }
          ]
        }
      }
    })
    // 第一轮：p1 401 熔断，容灾走 p2 成功（fallback 指向被跳过的 p1 证明熔断已生效）
    const out1 = await svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    expect(out1.fallback?.requestedProviderId).toBe('p1')

    // 备份导入换配置：同 id p1 换到新端点（熔断记录随配置整体失效）
    await svc.replaceAll({
      services: {
        translate: {
          activeProviderId: 'p1',
          providers: [
            { id: 'p1', type: 'http-template', name: '首选', enabled: true, endpoint: 'https://new.example.com/?q={text}' },
            { id: 'p2', type: 'http-template', name: '备选', enabled: true, endpoint: 'https://backup.example.com/?q={text}' }
          ]
        }
      }
    })
    const out2 = await svc.translate({ text: 'hi', from: 'en', to: 'zh-CN' })
    // 复位后首选 p1 直打成功：无 fallback，且请求已打到新端点
    expect(out2.fallback).toBeUndefined()
    expect(net.calls.some((c) => c.url.includes('new.example.com'))).toBe(true)
  })
})

describe('降级会话 mutator（启动 load 失败后锁解除）', () => {
  const seedDisk = (): Record<string, string> => ({
    '/data/api-services.json': JSON.stringify({
      services: {
        translate: {
          activeProviderId: 'x',
          providers: [{ id: 'x', type: 'http-template', name: '盘上已有', enabled: true, endpoint: 'https://a.example.com/?q={text}', secrets: { apiKey: 'sk-old' } }]
        }
      }
    })
  })

  it('load 失败 → 解锁 → upsertProvider 基于真实盘态编辑：盘上 provider 及密钥不丢', async () => {
    const fs = memFs(seedDisk())
    const svc = makeService({ fs })
    fs.readFailCode = 'EPERM' // 启动瞬间被瞬时锁：load 失败，设置页此时显示空配置
    await expect(svc.load()).rejects.toThrow('EPERM')

    fs.readFailCode = null // 同会话内锁解除
    await svc.upsertProvider(httpForm)
    // 修复前：快照取的是默认空态，replace 重试 load 成功后刚读入的盘态被空快照+新表单覆盖，x 与密钥全丢
    expect(svc.config.services.translate.providers.map((p) => p.id).sort()).toEqual([expect.any(String), 'x'])
    expect(svc.config.services.translate.providers.find((p) => p.id === 'x')?.secrets?.apiKey).toBe('sk-old')
    await svc.flush()
    const saved = JSON.parse(fs.files.get('/data/api-services.json') as string)
    expect(saved.services.translate.providers.map((p: { id: string }) => p.id).sort()).toEqual([expect.any(String), 'x'])
    expect(saved.services.translate.providers.find((p: { id: string }) => p.id === 'x').secrets.apiKey).toBe('sk-old')
  })

  it('锁未解除时 mutator 干净报错：不落盘、盘上配置原样', async () => {
    const fs = memFs(seedDisk())
    const svc = makeService({ fs })
    fs.readFailCode = 'EPERM'
    await expect(svc.load()).rejects.toThrow('EPERM')
    await expect(svc.upsertProvider(httpForm)).rejects.toThrow('EPERM')
    await svc.flush()
    expect(JSON.parse(fs.files.get('/data/api-services.json') as string)).toEqual(JSON.parse(seedDisk()['/data/api-services.json']!))
  })
})

describe('testProvider 三入口', () => {
  it('按 id 测试已存 provider：用已存密钥渲染模板（hello → q=hello）', async () => {
    const calls: string[] = []
    const svc = makeService({
      fetch: async (url) => {
        calls.push(url)
        return okBody('你好')
      }
    })
    await svc.load()
    const view = await svc.upsertProvider(httpForm)
    const id = view.services.translate.providers[0].id
    const r = await svc.testProvider(id)
    expect(r).toEqual({ ok: true, resultText: '你好' })
    expect(calls).toEqual(['https://x.example.com/?q=hello&key=mk-9'])
  })

  it('id 不存在 → ok false 且不碰网络', async () => {
    let fetched = 0
    const svc = makeService({ fetch: async () => { fetched++; return okBody('x') } })
    await svc.load()
    const r = await svc.testProvider('ghost')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('服务商不存在')
    expect(fetched).toBe(0)
  })

  it('draft 携带已有 id 且不填新密钥 → 沿用已存密钥', async () => {
    const calls: string[] = []
    const svc = makeService({
      fetch: async (url) => {
        calls.push(url)
        return okBody('ok')
      }
    })
    await svc.load()
    const view = await svc.upsertProvider(httpForm)
    const id = view.services.translate.providers[0].id
    const r = await svc.testProvider(id, { type: 'http-template', name: '改名草稿', endpoint: 'https://x.example.com/?q={text}&key={key}', method: 'GET' })
    expect(r.ok).toBe(true)
    expect(calls).toEqual(['https://x.example.com/?q=hello&key=mk-9'])
    expect(svc.config.services.translate.providers[0].name).toBe('DeepL') // 草稿不落库
  })

  it('draft 校验失败以 { ok:false, error } 返回而非抛出（模板用 {key} 但无密钥）', async () => {
    const svc = makeService()
    await svc.load()
    const r = await svc.testProvider(undefined, { type: 'http-template', name: '草稿', endpoint: 'https://x.example.com/?key={key}' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('密钥')
  })
})

describe('buildProvider 校验与 id 生成', () => {
  it('名称空白 → 拒绝', async () => {
    const svc = makeService()
    await svc.load()
    await expect(svc.upsertProvider({ type: 'http-template', name: '   ', endpoint: 'https://a.example.com/x' })).rejects.toThrow(
      '服务商名称不能为空'
    )
  })

  it('未注入 generateId 时默认生成 u-<8位hex>', async () => {
    const svc = makeService()
    await svc.load()
    const view = await svc.upsertProvider(httpForm)
    expect(view.services.translate.providers[0].id).toMatch(/^u-[0-9a-f]{8}$/)
  })

  it('secrets 首尾空白被 trim；全空白视为未填沿用旧值（密钥参与签名，空白会 54001）', async () => {
    const svc = makeService()
    await svc.load()
    const view = await svc.upsertProvider({ ...httpForm, newSecrets: { apiKey: '  mk-9 \n' } })
    const id = view.services.translate.providers[0].id
    expect(svc.config.services.translate.providers[0].secrets?.apiKey).toBe('mk-9')
    await svc.upsertProvider({ ...httpForm, id, name: '改名', newSecrets: { apiKey: '   ' } })
    expect(svc.config.services.translate.providers[0].secrets?.apiKey).toBe('mk-9')
  })
})

describe('translate 按 providerId 路由（聚合翻译切引擎）与 status.providers', () => {
  async function setupTwoProviders() {
    const calls: string[] = []
    const svc = makeService({
      fetch: async (url) => {
        calls.push(url)
        return okBody('你好')
      }
    })
    await svc.load()
    const view = await svc.upsertProvider(httpForm) // DeepL，endpoint x.example.com
    const view2 = await svc.upsertProvider({ type: 'http-template', name: '谷歌', endpoint: 'https://g.example.com/?q={text}' })
    const deeplId = view.services.translate.providers[0].id
    const googleId = view2.services.translate.providers.find((p) => p.name === '谷歌')?.id as string
    return { svc, calls, deeplId, googleId }
  }

  it('status().providers 概要含全部 provider（含禁用）且不泄露密钥', async () => {
    const { svc, deeplId } = await setupTwoProviders()
    await svc.upsertProvider({ ...httpForm, id: deeplId, name: 'DeepL', newSecrets: {} })
    const st = svc.status('translate')
    expect(st.providers.map((p) => p.name)).toEqual(['DeepL', '谷歌'])
    expect(st.providers.every((p) => !('apiKey' in p) && !('hasKey' in p))).toBe(true)
    expect(st.providers.every((p) => typeof p.enabled === 'boolean')).toBe(true)
  })

  it('providerId 指定非 active 引擎 → 按该引擎路由（不改全局 active）', async () => {
    const { svc, calls, deeplId, googleId } = await setupTwoProviders()
    await svc.setActive(deeplId)
    const out = await svc.translate({ text: 'hello', from: 'en', to: 'zh-CN', providerId: googleId })
    expect(out.providerId).toBe(googleId)
    expect(calls).toEqual(['https://g.example.com/?q=hello'])
    expect(svc.config.services.translate.activeProviderId).toBe(deeplId)
  })

  it('providerId 省略 → 维持原 activeProviderId 路由行为', async () => {
    const { svc, calls, deeplId } = await setupTwoProviders()
    await svc.setActive(deeplId)
    const out = await svc.translate({ text: 'hello', from: 'en', to: 'zh-CN' })
    expect(out.providerId).toBe(deeplId)
    expect(calls).toEqual(['https://x.example.com/?q=hello&key=mk-9'])
  })

  it('providerId 指向已禁用引擎 → SERVICE_UNCONFIGURED 且不碰网络', async () => {
    const { svc, googleId } = await setupTwoProviders()
    await svc.upsertProvider({ type: 'http-template', id: googleId, name: '谷歌', endpoint: 'https://g.example.com/?q={text}', enabled: false })
    await expect(svc.translate({ text: 'hi', from: 'en', to: 'zh-CN', providerId: googleId })).rejects.toThrow('已被禁用')
  })

  it('providerId 指向不存在引擎 → SERVICE_UNCONFIGURED', async () => {
    const { svc } = await setupTwoProviders()
    await expect(svc.translate({ text: 'hi', from: 'en', to: 'zh-CN', providerId: 'ghost' })).rejects.toThrow('不存在')
  })
})

// ---------- ai 品类（题3）：chat 路由、status 回填、sanitized 脱敏、replaceAll 覆盖 ----------

const aiForm = {
  type: 'ai-chat' as const,
  name: 'GLM',
  baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  model: 'glm-4',
  newApiKey: 'sk-ai-1'
}

function okChat(body: string): HostFetchResult {
  return okBody(JSON.stringify({ choices: [{ message: { content: body } }] }))
}

describe('ApiCenterService ai 品类', () => {
  it('upsert 校验：baseUrl 非 http(s) / 模型名缺失 → 拒绝且不落库', async () => {
    const svc = makeService()
    await svc.load()
    await expect(svc.upsertProvider({ ...aiForm, baseUrl: 'ftp://x' }, 'ai')).rejects.toThrow(/http/)
    await expect(svc.upsertProvider({ ...aiForm, model: '  ' }, 'ai')).rejects.toThrow('模型名不能为空')
    expect(svc.config.services.ai.providers).toHaveLength(0)
  })

  it('chat：explicit→active 路由 /chat/completions；upsert 留空 newApiKey 保留旧密钥', async () => {
    const { fn, calls } = recordingFetch(() => okChat('Hello'))
    const svc = makeService({ fetch: fn })
    await svc.load()
    const view = await svc.upsertProvider(aiForm, 'ai')
    const id = view.services.ai.providers[0].id
    await svc.setActive(id, 'ai')
    const out = await svc.chat({ text: '你好' })
    expect(out).toEqual({ resultText: 'Hello', providerId: id })
    expect(calls[0].url).toBe('https://open.bigmodel.cn/api/paas/v4/chat/completions')
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer sk-ai-1' })
    const body = JSON.parse(String(calls[0].init?.body))
    expect(body.model).toBe('glm-4')
    expect(body.stream).toBe(false)
    expect(body.messages[0]).toEqual({ role: 'system', content: '你是翻译引擎，只输出译文。文本含中文则译为英文，否则译为中文。' })
    expect(body.messages[1]).toEqual({ role: 'user', content: '你好' })

    await svc.upsertProvider({ ...aiForm, id, model: 'glm-4-plus', newSecrets: { apiKey: '' } }, 'ai')
    expect(svc.config.services.ai.providers[0].secrets?.apiKey).toBe('sk-ai-1')
    expect(svc.config.services.ai.providers[0].model).toBe('glm-4-plus')
  })

  it('未配置（零 provider / active 禁用 / active 悬空）→ SERVICE_UNCONFIGURED 无回退', async () => {
    const svc = makeService({ fetch: recordingFetch(() => okChat('x')).fn })
    await svc.load()
    await expect(svc.chat({ text: 'hi' })).rejects.toMatchObject({ code: 'SERVICE_UNCONFIGURED' })
    await expect(svc.chat({ text: 'hi', providerId: 'ghost' })).rejects.toMatchObject({ code: 'SERVICE_UNCONFIGURED' })

    const view = await svc.upsertProvider(aiForm, 'ai')
    const id = view.services.ai.providers[0].id
    await svc.upsertProvider({ ...aiForm, id, enabled: false }, 'ai')
    await svc.setActive(id, 'ai')
    await expect(svc.chat({ text: 'hi' })).rejects.toMatchObject({ code: 'SERVICE_UNCONFIGURED' })
    await svc.removeProvider(id, 'ai')
    expect(svc.status('ai').configured).toBe(false)
  })

  it("status('ai') 的 service 字段用参数回填（F17），且与 translate 互不串段", async () => {
    const svc = makeService({ fetch: recordingFetch(() => okChat('x')).fn })
    await svc.load()
    const stAi = svc.status('ai')
    expect(stAi.service).toBe('ai')
    expect(stAi).toMatchObject({ configured: false, activeProviderId: '', activeProviderName: '' })
    expect(svc.status('translate')).toMatchObject({ service: 'translate', configured: false, activeProviderName: 'MyMemory（默认免 Key）' })

    const view = await svc.upsertProvider(aiForm, 'ai')
    const id = view.services.ai.providers[0].id
    await svc.setActive(id, 'ai')
    expect(svc.status('ai')).toMatchObject({ service: 'ai', configured: true, activeProviderId: id, activeProviderName: 'GLM' })
    expect(svc.status('ai').providers.map((p) => p.name)).toEqual(['GLM'])
  })

  it('sanitized 含 ai 段（hasKey 布尔、无明文密钥）；translate 段不受 ai upsert 牵连', async () => {
    const svc = makeService({ fetch: recordingFetch(() => okChat('x')).fn })
    await svc.load()
    await svc.upsertProvider(aiForm, 'ai')
    const view = svc.sanitized()
    expect(view.services.ai.providers[0]).toMatchObject({ type: 'ai-chat', name: 'GLM', hasKey: true, model: 'glm-4' })
    expect(JSON.stringify(view)).not.toContain('sk-ai-1')
    expect(view.services.translate.providers).toHaveLength(0)
  })

  it('replaceAll 备份导入覆盖 ai 段：合法生效、非法 sanitize 静默剔除不崩溃', async () => {
    const svc = makeService({ fetch: recordingFetch(() => okChat('x')).fn })
    await svc.load()
    await svc.replaceAll({
      services: {
        translate: { activeProviderId: '', providers: [] },
        ai: { activeProviderId: 'b1', providers: [{ id: 'b1', type: 'ai-chat', name: '导入', enabled: true, baseUrl: 'https://b.example.com', model: 'm', secrets: { apiKey: 'sk-imp' } }] }
      }
    })
    expect(svc.status('ai')).toMatchObject({ configured: true, activeProviderId: 'b1', activeProviderName: '导入' })
    await svc.replaceAll({ services: { ai: { activeProviderId: 'z', providers: [{ id: 'z', type: 'weird', name: 'n' }] } } })
    expect(svc.config.services.ai.providers).toHaveLength(0)
    expect(svc.status('ai').configured).toBe(false)
  })

  it('testProvider ai：draft 用 newApiKey 测试（text 固定 hello 不落库）；无 id 无 draft 报未配置', async () => {
    const { fn, calls } = recordingFetch(() => okChat('Hola'))
    const svc = makeService({ fetch: fn })
    await svc.load()
    const r = await svc.testProvider(undefined, { type: 'ai-chat', name: '草稿', baseUrl: 'https://d.example.com/v1', model: 'm-1', newSecrets: { apiKey: 'sk-d' } }, 'ai')
    expect(r).toEqual({ ok: true, resultText: 'Hola' })
    expect(calls[0].url).toBe('https://d.example.com/v1/chat/completions')
    expect(String(calls[0].init?.body)).toContain('"content":"hello"')
    expect(svc.config.services.ai.providers).toHaveLength(0)

    const r2 = await svc.testProvider(undefined, undefined, 'ai')
    expect(r2.ok).toBe(false)
    expect(r2.error).toContain('未配置')
    expect(calls).toHaveLength(1)
  })

  it('chat 执行失败包装为 SERVICE_ERROR（非 JSON → parse、401 → http），任何路径不漏明文密钥', async () => {
    const badJson = makeService({ fetch: recordingFetch(() => okBody('<html>gateway</html>')).fn })
    await badJson.load()
    await badJson.setActive((await badJson.upsertProvider(aiForm, 'ai')).services.ai.providers[0].id, 'ai')
    const err = (await badJson.chat({ text: 'hi' }).catch((e) => e)) as ApiServiceError
    expect(err.code).toBe('SERVICE_ERROR')
    expect(err.message.startsWith('parse:')).toBe(true)
    expect(err.message).not.toContain('sk-ai-1')

    const http401 = makeService({ fetch: recordingFetch(() => ({ ok: false, status: 401, body: '' })).fn })
    await http401.load()
    await http401.setActive((await http401.upsertProvider(aiForm, 'ai')).services.ai.providers[0].id, 'ai')
    const err2 = (await http401.chat({ text: 'hi' }).catch((e) => e)) as ApiServiceError
    expect(err2.code).toBe('SERVICE_ERROR')
    expect(err2.message.startsWith('http:')).toBe(true)
  })
})
