// api-services.json 存储层单测：sanitize、原子写（tmp→rename）、防抖与 flush 兜底、密钥脱敏。
// FsLike 注入 fake，不发真实 IO 之外的依赖。
import { describe, expect, it } from 'vitest'
import type { FsLike } from '../src/main/settings-store'
import { ApiCenterStore } from '../src/main/services/api-center/store'
import { sanitizeApiServices } from '../src/main/services/api-center/types'

function memFs(initial: Record<string, string> = {}): FsLike & { files: Map<string, string>; writes: string[]; renames: [string, string][] } {
  const files = new Map(Object.entries(initial))
  const writes: string[] = []
  const renames: [string, string][] = []
  const fs: FsLike & { files: Map<string, string>; writes: string[]; renames: [string, string][] } = {
    files,
    writes,
    renames,
    readFile: async (path: string) => {
      const v = files.get(path)
      if (v === undefined) throw new Error('ENOENT')
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
  apiKey: 'sk-1',
  method: 'GET',
  bodyTemplate: '',
  resultPath: ''
}

describe('sanitizeApiServices（手改文件场景：坏值丢弃回默认）', () => {
  it('null / 垃圾结构 → 空配置（= 0.1.0 默认：回退 MyMemory）', () => {
    expect(sanitizeApiServices(null)).toEqual({ services: { translate: { activeProviderId: '', providers: [] } } })
    expect(sanitizeApiServices('x')).toEqual({ services: { translate: { activeProviderId: '', providers: [] } } })
    expect(sanitizeApiServices({ services: {} })).toEqual({ services: { translate: { activeProviderId: '', providers: [] } } })
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

  it('字段级兜底：enabled 缺省 true、坏值按 false；method 非 POST 归 GET；非字符串字段归空串', () => {
    const out = sanitizeApiServices({
      services: {
        translate: {
          providers: [
            { id: 'x', type: 'http-template', name: 'n', enabled: 'yes', endpoint: 9, method: 'POST', apiKey: null },
            { id: 'y', type: 'mymemory', name: 'm' }
          ]
        }
      }
    })
    const p = out.services.translate.providers[0]
    expect(p.enabled).toBe(false) // 坏值按 false：避免手改错值意外启用
    expect(p.endpoint).toBe('')
    expect(p.apiKey).toBe('')
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
    expect(store.config).toEqual({ services: { translate: { activeProviderId: '', providers: [] } } })
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
    expect(saved.services.translate.providers[0].apiKey).toBe('sk-1')
  })

  it('flush 兜底：防抖窗口内强制落盘且幂等', async () => {
    const fs = memFs()
    const store = new ApiCenterStore('/data', fs, 10_000)
    await store.load()
    await store.replace({ services: { translate: { activeProviderId: '', providers: [] } } })
    await store.flush()
    expect(fs.files.get('/data/api-services.json')).toBe(JSON.stringify({ services: { translate: { activeProviderId: '', providers: [] } } }, null, 2))
    await store.flush() // 干净态再 flush 不重复写
    expect(fs.writes).toHaveLength(1)
  })
})
