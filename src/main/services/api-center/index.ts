import { randomBytes } from 'node:crypto'
import type { FsLike } from '../../settings-store'
import type {
  ApiServiceId,
  ApiServiceStatus,
  TranslateRequest,
  TranslateResult
} from '@sdk/api'
import { executeHttpTemplate } from './executors/http-template'
import { executeMyMemory, DEFAULT_MYMEMORY_PROVIDER_ID } from './executors/mymemory'
import { TranslateExecutorError, type FetchFn } from './executors/types'
import { ApiCenterStore } from './store'
import {
  ApiServiceError,
  type ApiProviderConfig,
  type ApiServicesConfig,
  type ApiServicesView,
  type ProviderForm
} from './types'

export { ApiServiceError } from './types'
export { legacyTranslateToProvider, migrateLegacyTranslate } from './migrate'
export type { ApiProviderConfig, ApiServicesConfig, ApiServicesView, ProviderForm } from './types'
export { sanitizeApiServices, DEFAULT_API_SERVICES } from './types'

const HTTP_URL_RE = /^https?:\/\//
const DEFAULT_PROVIDER_NAME = 'MyMemory（默认免 Key）'

function summarizeProviders(list: ApiProviderConfig[]): { id: string; name: string; enabled: boolean }[] {
  return list.map((p) => ({ id: p.id, name: p.name, enabled: p.enabled }))
}

/** 全局 API 中心：provider 配置的持有者 + 插件调用的主进程代理执行器。
 *  密钥只在本模块与 api-services.json 之间流动，渲染层只见脱敏视图与翻译结果。 */
export class ApiCenterService {
  private readonly store: ApiCenterStore
  private readonly fetch: FetchFn
  private readonly notify: (() => void) | undefined
  private readonly generateId: () => string

  constructor(opts: {
    dir: string
    fs: FsLike
    fetch: FetchFn
    /** 每次配置变更后回调（ipc 层用来广播 api-services-changed） */
    notify?: () => void
    generateId?: () => string
  }) {
    this.store = new ApiCenterStore(opts.dir, opts.fs)
    this.fetch = opts.fetch
    this.notify = opts.notify
    this.generateId = opts.generateId ?? (() => `u-${randomBytes(4).toString('hex')}`)
  }

  async load(): Promise<void> {
    await this.store.load()
  }

  async flush(): Promise<void> {
    await this.store.flush()
  }

  get config(): ApiServicesConfig {
    return this.store.config
  }

  isTranslateEmpty(): boolean {
    return this.store.config.services.translate.providers.length === 0
  }

  /** 备份导入：sanitize 后整体替换，完成即广播（内存态即时生效，无需重启） */
  async replaceAll(raw: unknown): Promise<void> {
    await this.store.replace(raw)
    this.notify?.()
  }

  status(_service: ApiServiceId): ApiServiceStatus {
    const t = this.store.config.services.translate
    const active = t.activeProviderId === '' ? null : (t.providers.find((p) => p.id === t.activeProviderId) ?? null)
    if (!active) {
      return {
        service: 'translate',
        configured: false,
        activeProviderId: '',
        activeProviderName: DEFAULT_PROVIDER_NAME,
        providers: summarizeProviders(t.providers)
      }
    }
    return {
      service: 'translate',
      configured: true,
      activeProviderId: active.id,
      activeProviderName: active.name,
      providers: summarizeProviders(t.providers)
    }
  }

  /** 插件调用入口：providerId 显式指定则路由该引擎（聚合翻译切 tab，不改全局 active），否则按 activeProviderId；'' 回退内置 MyMemory */
  async translate(req: TranslateRequest): Promise<TranslateResult> {
    const t = this.store.config.services.translate
    const explicitId = req.providerId ?? ''
    const explicit = explicitId === '' ? null : (t.providers.find((p) => p.id === explicitId) ?? null)
    if (explicitId !== '' && explicit === null) {
      throw new ApiServiceError('SERVICE_UNCONFIGURED', null, `指定的翻译引擎不存在或已删除：${explicitId}`)
    }
    if (explicit !== null && !explicit.enabled) {
      throw new ApiServiceError('SERVICE_UNCONFIGURED', null, `翻译引擎「${explicit.name}」已被禁用：到 设置 → API 服务 启用`)
    }
    const active = explicit ?? (t.activeProviderId === '' ? null : (t.providers.find((p) => p.id === t.activeProviderId) ?? null))
    if (explicit === null && t.activeProviderId !== '' && !active) {
      // sanitize 后不可达的防御分支：active 指向已删除 provider 时按默认回退，保证翻译可用
      return executeMyMemory(req, { fetch: this.fetch })
    }
    if (active && !active.enabled) {
      throw new ApiServiceError(
        'SERVICE_UNCONFIGURED',
        null,
        '翻译服务当前不可用：到 设置 → API 服务 启用当前服务商或切换其他配置'
      )
    }
    try {
      if (!active || active.type === 'mymemory') return await executeMyMemory(req, { fetch: this.fetch })
      return await executeHttpTemplate(req, { fetch: this.fetch }, active)
    } catch (err) {
      if (err instanceof TranslateExecutorError) {
        throw new ApiServiceError('SERVICE_ERROR', err.kind, `${err.kind}: ${err.message}`)
      }
      throw err
    }
  }

  sanitized(): ApiServicesView {
    const t = this.store.config.services.translate
    return {
      services: {
        translate: {
          activeProviderId: t.activeProviderId,
          providers: t.providers.map((p) => ({
            id: p.id,
            type: p.type,
            name: p.name,
            enabled: p.enabled,
            endpoint: p.endpoint,
            method: p.method,
            bodyTemplate: p.bodyTemplate,
            resultPath: p.resultPath,
            hasKey: typeof p.apiKey === 'string' && p.apiKey !== ''
          }))
        }
      }
    }
  }

  /** 表单 → 合法 provider 配置；newApiKey 留空 = 保留 existing 已存密钥。校验不过抛 Error。 */
  private buildProvider(form: ProviderForm, existing: ApiProviderConfig | null): ApiProviderConfig {
    const type = form.type === 'mymemory' ? 'mymemory' : 'http-template'
    const name = form.name.trim()
    if (name === '') throw new Error('服务商名称不能为空')
    // mymemory 免 key 且无字段：固定 id，重复添加即更新既有条目
    const id = type === 'mymemory' ? DEFAULT_MYMEMORY_PROVIDER_ID : form.id?.trim() || this.generateId()

    const endpoint = (form.endpoint ?? '').trim()
    if (type === 'http-template' && !HTTP_URL_RE.test(endpoint)) {
      throw new Error('接口地址必须以 http:// 或 https:// 开头')
    }
    const apiKey =
      form.newApiKey !== undefined && form.newApiKey !== '' ? form.newApiKey : (existing?.apiKey ?? '')
    const bodyTemplate = form.bodyTemplate ?? ''
    if (type === 'http-template' && (endpoint.includes('{key}') || bodyTemplate.includes('{key}')) && apiKey === '') {
      throw new Error('模板使用了 {key} 占位符，请先填写密钥')
    }
    return {
      id,
      type,
      name,
      enabled: form.enabled ?? true,
      endpoint,
      apiKey,
      method: form.method === 'POST' ? 'POST' : 'GET',
      bodyTemplate,
      resultPath: form.resultPath ?? ''
    }
  }

  /** 新建或更新 provider，返回脱敏配置。 */
  async upsertProvider(form: ProviderForm): Promise<ApiServicesView> {
    const cfg = structuredClone(this.store.config)
    const t = cfg.services.translate
    const existing = t.providers.find((p) => p.id === form.id) ?? null
    const next = this.buildProvider(form, existing)
    const at = t.providers.findIndex((p) => p.id === next.id)
    if (at >= 0) t.providers[at] = next
    else t.providers.push(next)
    // active 指向被禁用 provider 在运行态允许保留（设置页黄点 + 调用报 SERVICE_UNCONFIGURED）
    await this.store.replace(cfg)
    this.notify?.()
    return this.sanitized()
  }

  async removeProvider(id: string): Promise<ApiServicesView> {
    const cfg = structuredClone(this.store.config)
    const t = cfg.services.translate
    t.providers = t.providers.filter((p) => p.id !== id)
    if (t.activeProviderId === id) t.activeProviderId = ''
    await this.store.replace(cfg)
    this.notify?.()
    return this.sanitized()
  }

  async setActive(id: string): Promise<ApiServicesView> {
    const cfg = structuredClone(this.store.config)
    const t = cfg.services.translate
    if (id !== '' && !t.providers.some((p) => p.id === id)) throw new Error(`服务商不存在：${id}`)
    t.activeProviderId = id
    await this.store.replace(cfg)
    this.notify?.()
    return this.sanitized()
  }

  /** 测试连接（text='hello', from='en', to='zh-CN'）：draft 优先（不落库，密钥取 newApiKey 或既有值），否则用已存 provider */
  async testProvider(id?: string, draft?: ProviderForm): Promise<{ ok: boolean; resultText?: string; error?: string }> {
    let provider: ApiProviderConfig | null
    try {
      if (draft) {
        const existing = id ? (this.store.config.services.translate.providers.find((p) => p.id === id) ?? null) : null
        provider = this.buildProvider({ ...draft, id: draft.id ?? id }, existing)
      } else if (id) {
        provider = this.store.config.services.translate.providers.find((p) => p.id === id) ?? null
        if (!provider) return { ok: false, error: `服务商不存在：${id}` }
      } else {
        // 无 id 无 draft = 测试默认 MyMemory
        provider = null
      }
      const out = await this.translateForTest(provider)
      return { ok: true, resultText: out.resultText }
    } catch (err) {
      if (err instanceof ApiServiceError) return { ok: false, error: err.message }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private translateForTest(provider: ApiProviderConfig | null): Promise<TranslateResult> {
    const req: TranslateRequest = { text: 'hello', from: 'en', to: 'zh-CN' }
    if (provider === null || provider.type === 'mymemory') {
      return executeMyMemory(req, { fetch: this.fetch })
    }
    return executeHttpTemplate(req, { fetch: this.fetch }, provider)
  }

  /** 启动迁移专用：追加 provider 并设为 active（是否执行由 migrateLegacyTranslate 的一次性标记保证） */
  async adoptMigratedProvider(provider: ApiProviderConfig): Promise<void> {
    const cfg = structuredClone(this.store.config)
    cfg.services.translate.providers.push(provider)
    cfg.services.translate.activeProviderId = provider.id
    await this.store.replace(cfg)
    this.notify?.()
  }
}
