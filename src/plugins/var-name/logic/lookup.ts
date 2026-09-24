// 中→英取词链（DESIGN C.6）：无 CJK 直通分词 → 本地词典精确命中 → apis.translate → 全失败抛 offline。
// apis 以最小接口注入，单测用 fake，渲染层传 ctx.host.apis 的适配器。

import { tokenize } from './engine'
import { lookupZhEn, normalizeZh, type ZhEnEntry } from '../data/zh-en'

export interface TranslatePayload {
  text: string
  from: string
  to: string
}

export interface ApisLike {
  invoke(service: 'translate', payload: TranslatePayload): Promise<{ resultText: string }>
}

export type LookupSource = 'english' | 'dict' | 'translate'

export interface LookupOutcome {
  source: LookupSource
  /** 每项是一组词（词典多义项给多组，翻译给一组） */
  variants: string[][]
  /** 词典命中的中式直译警示（避免：xxx） */
  avoid: string[]
  /** 命中的词典词条（UI 显示释义域） */
  entries: ZhEnEntry[]
}

export class LookupError extends Error {
  readonly kind: 'offline'
  constructor() {
    super('离线词典未收录：联网后重试，或到 设置 → API 服务 配置翻译')
    this.name = 'LookupError'
    this.kind = 'offline'
  }
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

export function hasCJK(s: string): boolean {
  return CJK_RE.test(s)
}

function dedupeVariants(variants: readonly string[][]): string[][] {
  const seen = new Set<string>()
  const out: string[][] = []
  for (const v of variants) {
    const key = v.join(' ')
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

export async function resolveWords(input: string, apis: ApisLike | null): Promise<LookupOutcome> {
  const text = input.trim()
  if (text === '') return { source: 'english', variants: [], avoid: [], entries: [] }

  // 1. 纯英文输入：零网络零词典
  if (!hasCJK(text)) {
    return { source: 'english', variants: dedupeVariants([tokenize(text)]), avoid: [], entries: [] }
  }

  // 2. 本地词典（归一化后整句精确匹配；本地优先——0ms 且离线可用）
  const entries = lookupZhEn(normalizeZh(text))
  if (entries.length > 0) {
    const variants = dedupeVariants(entries.flatMap((e) => e.en.map((phrase) => tokenize(phrase))))
    if (variants.length > 0) {
      return { source: 'dict', variants, avoid: entries.flatMap((e) => e.avoid ?? []), entries }
    }
  }

  // 3. 全局 API 中心翻译（未配置时宿主回退内置 MyMemory 免 key）
  if (apis === null) throw new LookupError()
  let resultText: string
  try {
    const out = await apis.invoke('translate', { text, from: 'zh-CN', to: 'en' })
    resultText = out.resultText
  } catch {
    throw new LookupError()
  }
  if (resultText.trim() === '') throw new LookupError()
  return { source: 'translate', variants: dedupeVariants([tokenize(resultText)]), avoid: [], entries: [] }
}
