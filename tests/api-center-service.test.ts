// ApiCenterService 未覆盖路径补充：replaceAll 备份导入、损坏文件加载、replace 前置 load、testProvider 按 id 取已存密钥、表单校验。
// FsLike 与 fetch 全部注入 fake，不发真实 IO 与网络。
import { describe, expect, it } from 'vitest'
import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import { ApiCenterService } from '../src/main/services/api-center'
import { ApiCenterStore } from '../src/main/services/api-center/store'
import type { FsLike } from '../src/main/settings-store'

const okBody = (body: string): HostFetchResult => ({ ok: true, status: 200, body })

function memFs(initial: Record<string, string> = {}): FsLike & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial))
  return {
    files,
    readFile: async (path: string) => {
      const v = files.get(path)
      if (v === undefined) throw new Error('ENOENT')
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
  newApiKey: 'mk-9'
}

describe('ApiCenterStore 边界', () => {
  it('损坏 JSON 文件加载 → 回默认配置不抛错', async () => {
    const store = new ApiCenterStore('/data', memFs({ '/data/api-services.json': '{oops' }), 10)
    await store.load()
    expect(store.config).toEqual({ services: { translate: { activeProviderId: '', providers: [] } } })
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
          providers: [{ id: 'p1', type: 'http-template', name: '导入', enabled: true, endpoint: 'https://a.example.com/x', apiKey: 'sk-import' }]
        }
      }
    })
    expect(svc.status('translate')).toMatchObject({ configured: true, activeProviderId: 'p1', activeProviderName: '导入' })
    expect(svc.config.services.translate.providers[0].apiKey).toBe('sk-import')
    expect(svc.sanitized().services.translate.providers[0].hasKey).toBe(true)
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
    await svc.upsertProvider({ ...httpForm, id: deeplId, name: 'DeepL', newApiKey: '' })
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
