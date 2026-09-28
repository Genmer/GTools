import type { PluginManifest } from '@sdk/manifest'
import type { RecItem } from './recommend'

/** 常驻插件向主窗推送的条目（经 plugin-event:<id> 的 { event:'main-push', payload }） */
export interface PushedItem {
  pluginId: string
  commandId?: string
  /** 无 commandId 的批量推送行（如剪贴板多行）由 backend 给出稳定标识参与去重，防整组塌成一行 */
  pushId?: string
  title: string
  subtitle: string
  icon: string
  payloadText?: string
}

/** 推送去重/行 key：具名命令 → pushId（批量行）→ 主入口 */
export function pushedKey(it: Pick<PushedItem, 'pluginId' | 'commandId' | 'pushId'>): string {
  return `${it.pluginId}:${it.commandId ?? it.pushId ?? '_main'}`
}

/** 与 recommend.ts 的 payload 上限同语义：超长文本只进入不注入，防超长推送拖垮插件参数通路 */
const PAYLOAD_MAX_LENGTH = 2000

export const PUSHED_ITEMS_CAP = 8

function allowedPushers(manifests: PluginManifest[]): Set<string> {
  return new Set(
    manifests.filter((m) => (m.permissions as readonly string[]).includes('mainPush')).map((m) => m.id)
  )
}

/**
 * 推送合并：manifest.permissions 不含 'mainPush' 的插件项整批丢弃（渲染层权限闸），
 * pushedKey 去重先到先得（existing 优先于 incoming），cap 截断。
 */
export function mergePushedItems(
  existing: readonly PushedItem[],
  incoming: readonly PushedItem[],
  manifests: PluginManifest[],
  cap = PUSHED_ITEMS_CAP
): PushedItem[] {
  const allowed = allowedPushers(manifests)
  const seen = new Set<string>()
  const out: PushedItem[] = []
  for (const it of [...existing, ...incoming]) {
    if (out.length >= cap) break
    if (!allowed.has(it.pluginId)) continue
    const k = pushedKey(it)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

/**
 * 整组替换某通道插件的推送行（backend 全量重推语义，空组即清除该插件全部行）：
 * 其他插件既有行原样保留，组内按 pushedKey 去重，cap 截断。
 */
export function replacePushedItems(
  existing: readonly PushedItem[],
  incoming: readonly PushedItem[],
  channelId: string,
  manifests: PluginManifest[],
  cap = PUSHED_ITEMS_CAP
): PushedItem[] {
  if (!allowedPushers(manifests).has(channelId)) return [...existing]
  const seen = new Set<string>()
  const out: PushedItem[] = []
  for (const it of [...existing.filter((x) => x.pluginId !== channelId), ...incoming]) {
    if (out.length >= cap) break
    const k = pushedKey(it)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(it)
  }
  return out
}

/**
 * 数组推送的单条规整：pluginId 一律以通道归属为准（不信任 payload 自带值），
 * 字段坏值回退插件名/图标；非对象条目返回 null 由调用方丢弃。
 */
export function normalizePushedItem(
  raw: unknown,
  channelId: string,
  fallback: { name: string; icon: string }
): PushedItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  return {
    pluginId: channelId,
    commandId: typeof r.commandId === 'string' && r.commandId !== '' ? r.commandId : undefined,
    pushId: typeof r.pushId === 'string' && r.pushId !== '' ? r.pushId : undefined,
    title: typeof r.title === 'string' ? r.title : fallback.name,
    subtitle: typeof r.subtitle === 'string' ? r.subtitle : '',
    icon: typeof r.icon === 'string' && r.icon !== '' ? r.icon : fallback.icon,
    payloadText: typeof r.payloadText === 'string' ? r.payloadText : undefined
  }
}

/** 推送条目 → 推荐行（source:'push'）；超长 payloadText 剥离对齐 recommend.ts 语义 */
export function pushedItemsToRecItems(items: readonly PushedItem[]): RecItem[] {
  return items.map((it) => ({
    key: pushedKey(it),
    pluginId: it.pluginId,
    commandId: it.commandId,
    payload: it.payloadText !== undefined && it.payloadText.length > PAYLOAD_MAX_LENGTH ? undefined : it.payloadText,
    title: it.title,
    subtitle: it.subtitle,
    label: it.title,
    icon: it.icon,
    source: 'push'
  }))
}
