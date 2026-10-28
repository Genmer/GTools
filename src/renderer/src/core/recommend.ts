import type { PluginManifest } from '@sdk/manifest'
import { looksLikeJson } from '@sdk/json-detect'
import type { SearchEntry } from './matcher'
import { isSensitiveText } from './sensitive'

// 单字符串入参的布尔函数按输入 memo（LRU 命中重插保温）：同 query 重复分析零重算（JSON.parse 与敏感正则都省）
function memoizeByInput(fn: (s: string) => boolean, cap: number): (s: string) => boolean {
  const cache = new Map<string, boolean>()
  return (s: string) => {
    const hit = cache.get(s)
    if (hit !== undefined) {
      cache.delete(s)
      cache.set(s, hit)
      return hit
    }
    const v = fn(s)
    cache.set(s, v)
    if (cache.size > cap) cache.delete(cache.keys().next().value as string)
    return v
  }
}
const queryLooksLikeJson = memoizeByInput(looksLikeJson, 64)
const queryIsSensitive = memoizeByInput(isSensitiveText, 64)

export { looksLikeJson }

/** 推荐来源，即优先级：query JSON > 拖入文件/图片 > 关键词沾边 > 正则 > 通用文本（通用压底防噪声） */
export type RecSource = 'json' | 'files' | 'img' | 'push' | 'keyword' | 'regex' | 'text'

/**
 * 拖拽文件描述。与 @sdk/api 的 MatchFile 同构（sdk 侧类型归 P1 车道声明，落地前先本地
 * 同构定义；结构化类型两侧天然互赋，落地后可直接切换 import）
 */
export interface MatchFile {
  name: string
  path: string
  isFile: boolean
  isDirectory: boolean
}

export interface RecItem {
  /** pluginId:commandId 去重键，兼作 v-for key */
  key: string
  pluginId: string
  commandId?: string
  /** matcher 命中型注入插件的文本；超上限剥离（text/regex 2000、json 100k）只进入不注入；keyword 沾边型无 */
  payload?: string
  /** 详情条主标题：命令 title 或插件名（展示名唯一来源） */
  title: string
  subtitle: string
  icon: string
  source: RecSource
}

const MATCHER_MAX_LENGTH_DEFAULT = 10_000
/** 注入插件参数通路（enterPlugin rest）的上限，超出只进入不注入；json 源放宽到解析上限（json-editor 消费全文） */
const PAYLOAD_MAX_LENGTH = 2000
const JSON_PAYLOAD_MAX_LENGTH = 100_000
const REC_CAP = 4

/** 沾边关键词长度门槛：ASCII ≥3（wx/fy 等短缩写噪声大），CJK ≥2 */
function keywordLongEnough(kw: string): boolean {
  return /^[\x00-\x7F]+$/.test(kw) ? kw.length >= 3 : kw.length >= 2
}

function truncate(text: string, maxLength?: number): string {
  const cap = maxLength ?? MATCHER_MAX_LENGTH_DEFAULT
  return text.length > cap ? text.slice(0, cap) : text
}

function commandTitle(m: PluginManifest, commandId?: string): string | undefined {
  return commandId === undefined ? undefined : (m.commands ?? []).find((c) => c.id === commandId)?.title
}

/**
 * 「沾边」推荐：query 包含某非空 keyword 即命中（完整命中已入主区，经 excludeKeys 排除），
 * 每词条取最长命中 keyword，按其长度降序上限 4。query trim 为空恒空——空态推荐行只由剪贴板驱动。
 * 仅插件词条参与（应用词条无激活通路，完整命中时本就在主结果）。
 */
export function keywordSideHits(query: string, entries: SearchEntry[], excludeKeys: ReadonlySet<string>): RecItem[] {
  const q = query.trim()
  if (q === '') return []
  const hits: { item: RecItem; kwLen: number }[] = []
  for (const e of entries) {
    if (e.pluginId === undefined || excludeKeys.has(e.key)) continue
    let kwLen = 0
    for (const kw of e.keywords ?? []) {
      if (kw !== '' && kw.length > kwLen && keywordLongEnough(kw) && q.includes(kw)) kwLen = kw.length
    }
    if (kwLen === 0) continue
    hits.push({
      kwLen,
      item: {
        key: `${e.pluginId}:${e.commandId ?? '_main'}`,
        pluginId: e.pluginId,
        commandId: e.commandId,
        title: e.title,
        subtitle: '关键词推荐',
        icon: e.icon,
        source: 'keyword'
      }
    })
  }
  return hits.sort((a, b) => b.kwLen - a.kwLen).slice(0, REC_CAP).map((h) => h.item)
}

function matchesRegex(match: string, text: string, exclude?: string): boolean {
  let re: RegExp
  try {
    re = new RegExp(match)
  } catch {
    return false
  }
  if (exclude !== undefined) {
    try {
      // 非法 exclude 视为未配置（校验层已报错，运行时宽容）
      if (new RegExp(exclude).test(text)) return false
    } catch {
      /* 忽略 */
    }
  }
  return re.test(text)
}

/**
 * matcher 命中：text 型过长度窗（minLength 缺省 2）、regex 型截断后测试（非法正则跳过）、
 * json 型只测 query 自身（剪贴板源已拆除）。每插件每 type 至多一条。
 * 按源组配额：content 组（json/files/img/regex）上限 4、text 组上限 4，互不挤占。
 * 契约：query 为空时恒不产出。
 */
export function matcherHits(text: string, manifests: PluginManifest[]): RecItem[] {
  const q = text.trim()
  if (q === '') return []
  const items: RecItem[] = []
  let contentCount = 0
  let textCount = 0
  for (const m of manifests) {
    const seenTypes = new Set<RecSource>()
    for (const mt of m.matchers ?? []) {
      if (contentCount >= REC_CAP && textCount >= REC_CAP) return items
      if (seenTypes.has(mt.type)) continue
      const isTextType = mt.type === 'text'
      if (isTextType && textCount >= REC_CAP) continue
      if (!isTextType && contentCount >= REC_CAP) continue
      let hit: string | null = null
      if (mt.type === 'json') {
        if (queryLooksLikeJson(q)) hit = q
      } else {
        const body = truncate(q, mt.maxLength)
        if (mt.type === 'text') {
          if (body.length >= (mt.minLength ?? 2)) hit = body
        } else if (mt.match !== undefined && matchesRegex(mt.match, body, mt.exclude)) {
          hit = body
        }
      }
      if (hit === null) continue
      seenTypes.add(mt.type)
      if (isTextType) textCount++
      else contentCount++
      // 超过注入上限只进入不注入（静默，无文案提示）；json 源到解析上限全注入
      const payloadCap = mt.type === 'json' ? JSON_PAYLOAD_MAX_LENGTH : PAYLOAD_MAX_LENGTH
      const overLimit = hit.length > payloadCap
      items.push({
        key: `${m.id}:${mt.commandId ?? '_main'}`,
        pluginId: m.id,
        commandId: mt.commandId,
        payload: overLimit ? undefined : hit,
        title: commandTitle(m, mt.commandId) ?? m.name,
        subtitle: mt.commandId !== undefined ? m.name : (m.description ?? m.name),
        icon: m.icon,
        source: mt.type
      })
    }
  }
  return items
}

export interface BuildRecommendationsInput {
  query: string
  /** 词条池（keyword 沾边数据源），空态调用可省 */
  entries?: SearchEntry[]
  /** 主结果 entry.key 集，沾边排除用，空态调用可省 */
  resultKeys?: ReadonlySet<string>
  manifests: PluginManifest[]
  /** 拖入文件集（matchers files/img 型数据源），未拖入不传 */
  files?: MatchFile[]
  /** 拖入集含图片时为 true（matchers img 型命中条件） */
  hasImage?: boolean
}

/** matchers 里 files/img 型条目的结构化读取面（files/img 型与 fileType/extensions 归 sdk 车道扩展） */
interface FileMatcherLike {
  type: string
  label: string
  commandId?: string
  fileType?: string
  extensions?: string[]
}

function fileExtension(name: string): string {
  const seg = name.split('.').pop() ?? ''
  return seg.toLowerCase()
}

/**
 * 拖入文件/图片命中：遍历各 manifest matchers 的 files/img 型条目。
 * files 型按 fileType 判定（file→至少一个 isFile；directory→至少一个 isDirectory；缺省 both→files 非空即中），
 * extensions 非空时另要求任一文件后缀（name 末段、小写）命中；img 型在 hasImage 时命中。
 * 文件列表不经 payload（走 initialPayload 通道），每插件每 source 至多一条，总数上限 4。
 */
export function fileMatcherHits(files: MatchFile[], manifests: PluginManifest[], hasImage: boolean): RecItem[] {
  if (files.length === 0 && !hasImage) return []
  const items: RecItem[] = []
  for (const m of manifests) {
    const seenSources = new Set<RecSource>()
    for (const raw of m.matchers ?? []) {
      if (items.length >= REC_CAP) return items
      const mt = raw as FileMatcherLike
      if (mt.type !== 'files' && mt.type !== 'img') continue
      const isImg = mt.type === 'img'
      const source: RecSource = isImg ? 'img' : 'files'
      if (seenSources.has(source)) continue
      if (isImg) {
        if (!hasImage) continue
      } else {
        if (files.length === 0) continue
        const kind = mt.fileType ?? 'both'
        const kindHit =
          kind === 'file' ? files.some((f) => f.isFile) : kind === 'directory' ? files.some((f) => f.isDirectory) : true
        if (!kindHit) continue
        const exts = (mt.extensions ?? []).map((e) => e.toLowerCase())
        if (exts.length > 0 && !files.some((f) => exts.includes(fileExtension(f.name)))) continue
      }
      seenSources.add(source)
      items.push({
        key: `${m.id}:${mt.commandId ?? '_main'}`,
        pluginId: m.id,
        commandId: mt.commandId,
        title: commandTitle(m, mt.commandId) ?? m.name,
        subtitle: mt.commandId !== undefined ? m.name : (m.description ?? m.name),
        icon: m.icon,
        source
      })
    }
  }
  return items
}

/**
 * 合并多路推荐，按 json > files > img > keyword > regex > text 排序，pluginId+commandId 去重先到先得。
 * 契约：query trim 为空时恒不产出（json 只来自 query 自身），仅拖入 files/img 可能产出——空态推荐零噪声。
 */
export function buildRecommendations(input: BuildRecommendationsInput): RecItem[] {
  const q = input.query.trim()
  const qSensitive = queryIsSensitive(input.query)
  const json: RecItem[] = []
  const files: RecItem[] = []
  const img: RecItem[] = []
  const regex: RecItem[] = []
  const text: RecItem[] = []
  for (const it of matcherHits(input.query, input.manifests)) {
    // 敏感文本不出 json 推荐（隐私纪律），其余来源仅剥 payload
    if (qSensitive) {
      if (it.source === 'json') continue
      it.payload = undefined
    }
    if (it.source === 'json') json.push(it)
    else if (it.source === 'regex') regex.push(it)
    else text.push(it)
  }
  for (const it of fileMatcherHits(input.files ?? [], input.manifests, input.hasImage ?? false)) {
    if (it.source === 'files') files.push(it)
    else img.push(it)
  }
  const keyword = q === '' ? [] : keywordSideHits(q, input.entries ?? [], input.resultKeys ?? new Set())
  const merged: RecItem[] = []
  const seen = new Set<string>()
  for (const it of [...json, ...files, ...img, ...keyword, ...regex, ...text]) {
    if (seen.has(it.key)) continue
    seen.add(it.key)
    merged.push(it)
  }
  return merged
}

/** 按 key 去重先到先得（多路推荐行合并时防同 key 重复渲染） */
export function dedupeRecs(items: readonly RecItem[]): RecItem[] {
  const seen = new Set<string>()
  const out: RecItem[] = []
  for (const it of items) {
    if (seen.has(it.key)) continue
    seen.add(it.key)
    out.push(it)
  }
  return out
}

/**
 * query 态推荐与常驻推送行合并：json 源置顶到推送行之前（用户当前输入的 JSON 检测必须是第一条），
 * 其余保持 推送行 → 其它推荐 原序，key 去重先到先得。
 */
export function mergeQueryRecommendations(pushed: readonly RecItem[], recs: readonly RecItem[]): RecItem[] {
  return dedupeRecs([...recs.filter((r) => r.source === 'json'), ...pushed, ...recs.filter((r) => r.source !== 'json')])
}
