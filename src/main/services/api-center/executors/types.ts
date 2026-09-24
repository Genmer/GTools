import type { HostFetchInit, HostFetchResult } from '@sdk/api'
import type { ApiErrorKind } from '../types'

/** 与宿主 net.fetch 同构的注入面：装配时传 fetchViaNet，测试传 fake */
export type FetchFn = (url: string, init?: HostFetchInit) => Promise<HostFetchResult>

/** executor 内部分类错误（对齐原 translate/providers 的 TranslateError 语义），由服务层包装成 ApiServiceError */
export class TranslateExecutorError extends Error {
  readonly kind: ApiErrorKind
  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.name = 'TranslateExecutorError'
    this.kind = kind
  }
}

export interface ExecutorRuntime {
  fetch: FetchFn
  timeoutMs?: number
}
