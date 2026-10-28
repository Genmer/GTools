// api-services.json 存储层单测：sanitize、原子写（tmp→rename）、防抖与 flush 兜底、密钥脱敏。
// FsLike 注入 fake，不发真实 IO 之外的依赖。
import { describe, expect, it } from 'vitest'
import type { FsLike } from '../src/main/settings-store'
import { ApiCenterStore } from '../src/main/services/api-center/store'
import { sanitizeApiServices } from '../src/main/services/api-center/types'

function memFs(
  initial: Record<string, string> = {}
): FsLike & { files: Map<string, string>; writes: string[]; renames: [string, string][]; readFailCode: string | null } {
  const files = new Map(Object.entries(initial))
  const writes: string[] = []
  const renames: [string, string][] = []
  // 非 null 时 readFile 一律抛该错误码（模拟杀软/备份软件瞬时锁文件）
  let readFailCode: string | null = null
  const fs: FsLike & { files: Map<string, string>; writes: string[]; renames: [string, string][]; readFailCode: string | null } = {
    files,
    writes,
    renames,
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
      if (v === undefined) {
        throw Object.assign(new Error(`ENOENT: no such file: ${path}`), { code: 'ENOENT' })
      }
      return v
    },
    writeFile: async (path: string, data: string) => {
      writes.push(path)
      files.set(path, data)
    },
    rename: async (from: string, to: string) => {
      renames.push([from, to])
      if (!files.has(from)) throw new Error('ENOENT')
      files.set(to, files.get(from) as string)
      files.delete(from)
    },
    mkdir: async () => undefined
  }
  return fs
}

const rawProvider = {
  id: 'u-abcd1234',
  type: 'http-template',
  name: 'DeepL',
  enabled: true,
  endpoint: 'https://x.example.com/?q={text}&key={key}',
  secrets: { apiKey: 'sk-1' },
  method: 'GET',
  bodyTemplate: '',
  resultPath: ''
}

const EMPTY_CONFIG = { services: { translate: { activeProviderId: '', providers: [] }, ai: { activeProviderId: '', providers: [] } } }

describe('sanitizeApiServices（手改文件场景：坏值丢弃回默认）', () => {
  it('null / 垃圾结构 → 空配置（= 0.1.0 默认：回退 MyMemory；ai 段同构为空）', () => {
    expect(sanitizeApiServices(null)).toEqual(EMPTY_CONFIG)
    expect(sanitizeApiServices('x')).toEqual(EMPTY_CONFIG)
    expect(sanitizeApiServices({ services: {} })).toEqual(EMPTY_CONFIG)
  })

  it('坏 provider 逐项丢弃：type 非法 / id 或 name 为空 / 重复 id 保留首个', () => {
    const out = sanitizeApiServices({
      services: {
        translate: {
          activeProviderId: '',
          providers: [
            rawProvider,
            { id: 'x1', type: 'weird', name: 'n', enabled: true },
            { id: '', type: 'http-template', name: 'n', enabled: true },
            { id: 'x2', type: 'mymemory', name: '', enabled: true },
            { ...rawProvider, name: 'dup' },
            { id: 'x3', type: 'mymemory', name: 'm', enabled: false }
          ]
        }
      }
    })
    expect(out.services.translate.providers.map((p) => p.id)).toEqual(['u-abcd1234', 'x3'])
  })

  it('ai 段：type 必须恰为 ai-chat；baseUrl 非 http(s) 或 model 缺失整条丢弃；坏值不牵连 translate 段', () => {
    const out = sanitizeApiServices({
      services: {
        ai: {
          activeProviderId: 'a1',
          providers: [
            { id: 'a1', type: 'ai-chat', name: 'GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4', apiKey: 'sk-ai', enabled: true },
            { id: 'a2', type: 'http-template', name: '混入翻译品类', baseUrl: 'https://x', model: 'm' },
            { id: 'a3', type: 'ai-chat', name: '坏地址', baseUrl: 'ftp://x', model: 'm' },
            { id: 'a4', type: 'ai-chat', name: '缺模型', baseUrl: 'https://x.example.com' },
            { id: 'a1', type: 'ai-chat', name: '重复id', baseUrl: 'https://y.example.com', model: 'm2' }
          ]
        }
      }
    })
    expect(out.services.ai.providers).toHaveLength(1)
    expect(out.services.ai.providers[0]).toMatchObject({ id: 'a1', type: 'ai-chat', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4', secrets: { apiKey: 'sk-ai' } })
    expect(out.services.ai.activeProviderId).toBe('a1')
    expect(out.services.translate.providers).toHaveLength(0)
  })

  it('ai 段 active 指向缺失 provider → 重置为空；strictActive 下指向禁用 provider 同样重置', () => {
    const raw = { services: { ai: { activeProviderId: 'ghost', providers: [] } } }
    expect(sanitizeApiServices(raw).services.ai.activeProviderId).toBe('')
    const disabled = { services: { ai: { activeProviderId: 'x', providers: [{ id: 'x', type: 'ai-chat', name: 'm', baseUrl: 'https://x', model: 'm', enabled: false }] } } }
    expect(sanitizeApiServices(disabled, { strictActive: true }).services.ai.activeProviderId).toBe('')
    expect(sanitizeApiServices(disabled).services.ai.activeProviderId).toBe('x')
  })

  it('字段级兜底：enabled 缺省 true、坏值按 false；method 非 POST 归 GET；非字符串字段归空串', () => {
    const out = sanitizeApiServices({
      services: {
        translate: {
          providers: [
            { id: 'x', type: 'http-template', name: 'n', enabled: 'yes', endpoint: 9, method: 'POST', secrets: { apiKey: null, other: 'x' } },
            { id: 'y', type: 'mymemory', name: 'm' }
          ]
        }
      }
    })
    const p = out.services.translate.providers[0]
    expect(p.enabled).toBe(false) // 坏值按 false：避免手改错值意外启用
    expect(p.endpoint).toBe('')
    expect(p.secrets).toBeUndefined() // 坏值/未声明键的凭证被过滤后不落空对象
    expect(p.method).toBe('POST')
    expect(out.services.translate.providers[1].enabled).toBe(true) // 缺省 = 启用
  })

  it('strictActive=false（运行态）：active 指向已禁用 provider 时保留（黄点/SERVICE_UNCONFIGURED 语义）', () => {
    const raw = { services: { translate: { activeProviderId: 'x', providers: [{ id: 'x', type: 'mymemory', name: 'm', enabled: false }] } } }
    expect(sanitizeApiServices(raw).services.translate.activeProviderId).toBe('x')
  })

  it('strictActive=true（加载手改文件）：active 指向缺失或已禁用 provider 重置为默认', () => {
    const missing = { services: { translate: { activeProviderId: 'ghost', providers: [] } } }
    expect(sanitizeApiServices(missing, { strictActive: true }).services.translate.activeProviderId).toBe('')
    const disabled = { services: { translate: { activeProviderId: 'x', providers: [{ id: 'x', type: 'mymemory', name: 'm', enabled: false }] } } }
    expect(sanitizeApiServices(disabled, { strictActive: true }).services.translate.activeProviderId).toBe('')
  })
})

describe('ApiCenterStore 读写与落盘', () => {
  it('load 读不到文件用默认值，不抛错', async () => {
    const fs = memFs()
    const store = new ApiCenterStore('/data', fs)
    await store.load()
    expect(store.config).toEqual(EMPTY_CONFIG)
  })

  it('load 读到损坏 JSON：按默认值，不抛错', async () => {
    const fs = memFs({ '/data/api-services.json': '{broken' })
    const store = new ApiCenterStore('/data', fs)
    await store.load()
    expect(store.config).toEqual(EMPTY_CONFIG)
  })

  it('非 ENOENT 读错上抛：内存不停在空态，flush 不清空盘上凭证', async () => {
    const onDisk = JSON.stringify({
      services: { translate: { activeProviderId: 'u-abcd1234', providers: [rawProvider] } }
    })
    const fs = memFs({ '/data/api-services.json': onDisk })
    fs.readFailCode = 'EPERM' // 杀软/备份软件瞬时锁
    const store = new ApiCenterStore('/data', fs)
    await expect(store.load()).rejects.toThrow('EPERM')
    // replace 内部自动 load 同样失败：不产生 dirty，flush 不落盘
    // （修复前：读错被吞、内存停在默认空态，flush 会用空配置覆盖盘上全部凭证）
    await expect(store.replace({})).rejects.toThrow('EPERM')
    await store.flush()
    expect(fs.files.get('/data/api-services.json')).toBe(onDisk)
    expect(fs.writes).toHaveLength(0)

    fs.readFailCode = null // 锁解除后恢复正常：能读到盘上凭证
    await store.load()
    expect(store.config.services.translate.providers[0]?.secrets?.apiKey).toBe('sk-1')
  })

  it('load 手改文件经 strictActive sanitize：active 指向禁用 provider 时回到默认', async () => {
    const fs = memFs({
      '/data/api-services.json': JSON.stringify({
        services: { translate: { activeProviderId: 'x', providers: [{ id: 'x', type: 'mymemory', name: 'm', enabled: false }] } }
      })
    })
    const store = new ApiCenterStore('/data', fs)
    await store.load()
    expect(store.config.services.translate.activeProviderId).toBe('')
    expect(store.config.services.translate.providers).toHaveLength(1) // provider 本身保留
  })

  it('replace 防抖合并写：300ms 内只落一次盘，且走 tmp→rename 原子替换', async () => {
    const fs = memFs()
    const store = new ApiCenterStore('/data', fs, 30)
    await store.load()
    await store.replace({ services: { translate: { activeProviderId: '', providers: [rawProvider] } } })
    await store.replace({ services: { translate: { activeProviderId: 'u-abcd1234', providers: [rawProvider] } } })
    await new Promise((r) => setTimeout(r, 80))
    expect(fs.writes.filter((w) => w.endsWith('.tmp'))).toHaveLength(1)
    expect(fs.renames).toEqual([['/data/api-services.json.tmp', '/data/api-services.json']])
    const saved = JSON.parse(fs.files.get('/data/api-services.json') as string)
    expect(saved.services.translate.activeProviderId).toBe('u-abcd1234')
    // 明文密钥在主进程文件里（本机 userData），这是设计约定
    expect(saved.services.translate.providers[0].secrets.apiKey).toBe('sk-1')
  })

  it('flush 兜底：防抖窗口内强制落盘且幂等', async () => {
    const fs = memFs()
    const store = new ApiCenterStore('/data', fs, 10_000)
    await store.load()
    await store.replace({ services: { translate: { activeProviderId: '', providers: [] } } })
    await store.flush()
    expect(fs.files.get('/data/api-services.json')).toBe(JSON.stringify(EMPTY_CONFIG, null, 2))
    await store.flush() // 干净态再 flush 不重复写
    expect(fs.writes).toHaveLength(1)
  })
})
