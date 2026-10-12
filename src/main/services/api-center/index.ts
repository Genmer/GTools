import { randomBytes } from 'node:crypto'
import type { FsLike } from '../../settings-store'
import type {
  ApiServiceId,
  ApiServiceStatus,
  TranslateRequest,
  TranslateResult
} from '@sdk/api'
import { ProviderBreaker } from './breaker'
import { executeBaidu } from './executors/baidu'
import { executeDeepl } from './executors/deepl'
import { FALLBACK_ELIGIBLE_KINDS } from './executors/error-rules'
import { executeHttpTemplate } from './executors/http-template'
import { executeHunyuan } from './executors/hunyuan'
import { executeIflytek } from './executors/iflytek'
import { executeMyMemory, DEFAULT_MYMEMORY_PROVIDER_ID } from './executors/mymemory'
import { TranslateExecutorError, type FetchFn } from './executors/types'
import { executeVolcano } from './executors/volcano'
import { executeYoudao } from './executors/youdao'
import { getPreset } from './presets'
import { ApiCenterStore } from './store'
import {
  ApiServiceError,
  type ApiErrorKind,
  type ApiProviderConfig,
  type ApiProviderView,
  type ApiServicesConfig,
  type ApiServicesView,
  type ProviderForm
} from './types'

export { ApiServiceError } from './types'
export { legacyTranslateToProvider, migrateLegacyTranslate } from './migrate'
export { PROVIDER_PRESETS, getPreset } from './presets'
export type { ApiProviderConfig, ApiServicesConfig, ApiServicesView, ProviderForm, ProviderType } from './types'
export type { ProviderPresetMeta, CredentialFieldDef } from './presets'
export { sanitizeApiServices, DEFAULT_API_SERVICES } from './types'
export { ProviderBreaker } from './breaker'

const HTTP_URL_RE = /^https?:\/\//
const DEFAULT_PROVIDER_NAME = 'MyMemory（默认免 Key）'

function summarizeProviders(list: ApiProviderConfig[]): { id: string; name: string; enabled: boolean }[] {
  return list.map((p) => ({ id: p.id, name: p.name, enabled: p.enabled }))
}

function viewProvider(p: ApiProviderConfig): ApiProviderView {
  const secrets = p.secrets ?? {}
  const hasSecrets: Record<string, boolean> = {}
  for (const field of getPreset(p.type)?.credentials ?? []) {
    hasSecrets[field.key] = typeof secrets[field.key] === 'string' && secrets[field.key] !== ''
  }
  return {
    id: p.id,
    type: p.type,
    name: p.name,
    enabled: p.enabled,
    endpoint: p.endpoint,
    method: p.method,
    bodyTemplate: p.bodyTemplate,
    resultPath: p.resultPath,
    hasSecrets
  }
}

/** 全局 API 中心：provider 配置的持有者 + 插件调用的主进程代理执行器。
 *  密钥只在本模块与 api-services.json 之间流动，渲染层只见脱敏视图与翻译结果。 */
export class ApiCenterService {
  private readonly store: ApiCenterStore
  private readonly fetch: FetchFn
  private readonly notify: (() => void) | undefined
  private readonly generateId: () => string
  private readonly breaker: ProviderBreaker

  constructor(opts: {
    dir: string
    fs: FsLike
    fetch: FetchFn
    /** 每次配置变更后回调（ipc 层用来广播 api-services-changed） */
    notify?: () => void
    generateId?: () => string
    /** 注入时钟供熔断单测可控 */
    now?: () => number
  }) {
    this.store = new ApiCenterStore(opts.dir, opts.fs)
    this.fetch = opts.fetch
    this.notify = opts.notify
    this.generateId = opts.generateId ?? (() => `u-${randomBytes(4).toString('hex')}`)
    this.breaker = new ProviderBreaker(opts.now)
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

  /** 插件调用入口。providerId 显式指定 = 只打该引擎（不容灾不熔断）；
   *  否则按候选序容灾：active 首位 → 其余启用引擎，无 active 时内置 MyMemory 首位。 */
  async translate(req: TranslateRequest): Promise<TranslateResult> {
    const t = this.store.config.services.translate
    const explicitId = req.providerId ?? ''
    if (explicitId !== '') {
      const p = t.providers.find((x) => x.id === explicitId) ?? null
      if (p === null) {
        throw new ApiServiceError('SERVICE_UNCONFIGURED', null, `指定的翻译引擎不存在或已删除：${explicitId}`)
      }
      if (!p.enabled) {
        throw new ApiServiceError('SERVICE_UNCONFIGURED', null, `翻译引擎「${p.name}」已被禁用：到 设置 → API 服务 启用`)
      }
      return this.executeReported(p, req)
    }

    const enabled = t.providers.filter((p) => p.enabled)
    const active = t.activeProviderId === '' ? null : (enabled.find((p) => p.id === t.activeProviderId) ?? null)
    // 用户手动加的 MyMemory 条目（固定 id）与内置 null 同端点：去重防一次翻译连打两遍；
    // 用户显式设过 active 时内置 MyMemory 不进候选；active 已删/禁用 → 防御回退内置语义
    const nonBuiltin = enabled.filter((p) => p.type !== 'mymemory')
    const candidates: (ApiProviderConfig | null)[] =
      t.activeProviderId === ''
        ? [null, ...nonBuiltin]
        : active !== null
          ? active.type === 'mymemory'
            ? [active, ...nonBuiltin]
            : [active, ...enabled.filter((p) => p.id !== active.id)]
          : [null, ...nonBuiltin]

    let usable = candidates.filter((c) => c === null || !this.breaker.isOpen(c.id))
    if (usable.length === 0) usable = candidates // 全候选熔断中：忽略熔断硬试兜底

    const attempts: { id: string; name: string; kind: ApiErrorKind; message: string }[] = []
    for (const c of usable) {
      try {
        const out = await this.executeOne(c, req)
        if (c !== null) this.breaker.clear(c.id)
        // 契约：requestedProviderId = 配置序首位（candidates[0]，null→''），而非熔断过滤后的首个尝试源。
        // 首选被熔断跳过时（哪怕次选一次成功）也附 fallback，reason 取熔断记录（trip 时已带 kind 前缀）
        const head = candidates[0]
        const skippedReason =
          head !== null && this.breaker.isOpen(head.id)
            ? (this.breaker.lastReason(head.id) ?? 'config: 首选引擎近期失败冷却中')
            : null
        if (attempts.length > 0 || skippedReason !== null) {
          out.fallback = {
            requestedProviderId: head === null ? '' : head.id,
            reason: skippedReason ?? `${attempts[0].kind}: ${attempts[0].message}`
          }
        }
        return out
      } catch (err) {
        if (!(err instanceof TranslateExecutorError)) throw err
        attempts.push({
          id: c === null ? DEFAULT_MYMEMORY_PROVIDER_ID : c.id,
          name: c === null ? DEFAULT_PROVIDER_NAME : c.name,
          kind: err.kind,
          message: err.message
        })
        if (c !== null && FALLBACK_ELIGIBLE_KINDS.has(err.kind)) {
          this.breaker.trip(c.id, `${err.kind}: ${err.message}`)
        }
        // 非容灾类别（timeout/network/parse/config）换家大概率同因：立即终止
        if (!FALLBACK_ELIGIBLE_KINDS.has(err.kind)) throw this.toServiceError(err)
      }
    }
    const last = attempts[attempts.length - 1]
    const trail = attempts.map((a) => `${a.name}(${a.kind})`).join(' → ')
    throw new ApiServiceError('SERVICE_ERROR', last.kind, `${last.kind}: ${last.message}（已尝试 ${trail}，均失败）`)
  }

  private async executeReported(provider: ApiProviderConfig | null, req: TranslateRequest): Promise<TranslateResult> {
    try {
      return await this.executeOne(provider, req)
    } catch (err) {
      throw this.toServiceError(err)
    }
  }

  private toServiceError(err: unknown): unknown {
    if (err instanceof TranslateExecutorError) {
      return new ApiServiceError('SERVICE_ERROR', err.kind, `${err.kind}: ${err.message}`)
    }
    return err
  }

  /** 单引擎直连路由（null = 内置 MyMemory）；TranslateExecutorError 原样上抛由调用方决定容灾 */
  private executeOne(provider: ApiProviderConfig | null, req: TranslateRequest): Promise<TranslateResult> {
    if (provider === null || provider.type === 'mymemory') {
      return executeMyMemory(req, { fetch: this.fetch })
    }
    const rt = { fetch: this.fetch }
    switch (provider.type) {
      case 'http-template':
        return executeHttpTemplate(req, rt, provider)
      case 'deepl':
        return executeDeepl(req, rt, provider)
      case 'baidu':
        return executeBaidu(req, rt, provider)
      case 'youdao':
        return executeYoudao(req, rt, provider)
      case 'iflytek':
        return executeIflytek(req, rt, provider)
      case 'hunyuan':
        return executeHunyuan(req, rt, provider)
      case 'volcano':
        return executeVolcano(req, rt, provider)
    }
  }

  sanitized(): ApiServicesView {
    const t = this.store.config.services.translate
    return {
      services: {
        translate: {
          activeProviderId: t.activeProviderId,
          providers: t.providers.map(viewProvider)
        }
      }
    }
  }

  /** 表单 → 合法 provider 配置；newSecrets 各键留空/缺省 = 保留 existing 已存值。校验不过抛 Error。 */
  private buildProvider(form: ProviderForm, existing: ApiProviderConfig | null): ApiProviderConfig {
    const type = form.type
    const name = form.name.trim()
    if (name === '') throw new Error('服务商名称不能为空')
    // mymemory 免 key 且无字段：固定 id，重复添加即更新既有条目
    const id = type === 'mymemory' ? DEFAULT_MYMEMORY_PROVIDER_ID : form.id?.trim() || this.generateId()

    const isTemplate = type === 'http-template'
    const endpoint = (form.endpoint ?? '').trim()
    if (isTemplate && !HTTP_URL_RE.test(endpoint)) {
      throw new Error('接口地址必须以 http:// 或 https:// 开头')
    }
    const bodyTemplate = form.bodyTemplate ?? ''
    const secrets = { ...(existing?.secrets ?? {}) }
    for (const [key, value] of Object.entries(form.newSecrets ?? {})) {
      // 密钥参与签名/鉴权，复制粘贴常带首尾空白：入库前统一 trim，全空白视为未填（保留旧值）
      if (typeof value !== 'string') continue
      const v = value.trim()
      if (v !== '') secrets[key] = v
    }
    const provider: ApiProviderConfig = {
      id,
      type,
      name,
      enabled: form.enabled ?? true,
      endpoint: isTemplate ? endpoint : '',
      method: isTemplate && form.method === 'POST' ? 'POST' : 'GET',
      bodyTemplate: isTemplate ? bodyTemplate : '',
      resultPath: isTemplate ? (form.resultPath ?? '') : ''
    }
    // 只保留 preset 声明的凭证键（多余键忽略），空值不落库
    const allowed = getPreset(type)?.credentials.map((c) => c.key) ?? []
    const clean: Record<string, string> = {}
    for (const key of allowed) {
      const v = secrets[key]
      if (typeof v === 'string' && v !== '') clean[key] = v
    }
    if (Object.keys(clean).length > 0) provider.secrets = clean
    if (isTemplate && (endpoint.includes('{key}') || bodyTemplate.includes('{key}')) && clean.apiKey === undefined) {
      throw new Error('模板使用了 {key} 占位符，请先填写密钥')
    }
    return provider
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
    // active 指向被禁用 provider 在运行态允许保留（设置页黄点 + 容灾循环自动跳过）
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

  /** 测试连接（text='hello', from='en', to='zh-CN'）：executeOne 直连目标，不进容灾循环、不 trip 熔断。
   *  draft 优先（不落库，凭证取 newSecrets 或既有值），否则用已存 provider；无 id 无 draft = 测内置 MyMemory。 */
  async testProvider(id?: string, draft?: ProviderForm): Promise<{ ok: boolean; resultText?: string; error?: string }> {
    try {
      let provider: ApiProviderConfig | null
      if (draft) {
        const existing = id ? (this.store.config.services.translate.providers.find((p) => p.id === id) ?? null) : null
        provider = this.buildProvider({ ...draft, id: draft.id ?? id }, existing)
      } else if (id) {
        provider = this.store.config.services.translate.providers.find((p) => p.id === id) ?? null
        if (!provider) return { ok: false, error: `服务商不存在：${id}` }
      } else {
        provider = null
      }
      const out = await this.executeOne(provider, { text: 'hello', from: 'en', to: 'zh-CN' })
      return { ok: true, resultText: out.resultText }
    } catch (err) {
      const serviceErr = this.toServiceError(err)
      if (serviceErr instanceof ApiServiceError) return { ok: false, error: serviceErr.message }
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
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
