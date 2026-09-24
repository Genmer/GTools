export const PROTOCOL_VERSION = 1 as const

export type Permission =
  | 'clipboard:read'
  | 'clipboard:write'
  | 'storage'
  | 'net'
  | 'notification'
  | 'shell:open'
  | 'window:hide'
  | 'window:float'
  | 'dialog'
  | 'fs'
  | 'apis:translate'

export const ALL_PERMISSIONS: readonly Permission[] = [
  'clipboard:read',
  'clipboard:write',
  'storage',
  'net',
  'notification',
  'shell:open',
  'window:hide',
  'window:float',
  'dialog',
  'fs',
  'apis:translate'
]

export interface PluginCommand {
  id: string
  title: string
  keywords?: string[]
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  protocolVersion: number
  description?: string
  icon: string
  keywords: string[]
  activation: 'trigger' | 'resident'
  permissions: Permission[]
  source: 'builtin' | 'external'
  entry: string
  backend?: string
  commands?: PluginCommand[]
}

export interface ManifestError {
  pluginId: string
  field: string
  message: string
}

const ID_RE = /^[a-z][a-z0-9-]*$/
const SEMVER_RE = /^\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/

export interface ValidateContext {
  /** 已注册的插件 id 集合，后到者与已存在者重复即拒绝 */
  existingIds: ReadonlySet<string>
  /** 已启用插件声明的 keyword → pluginId，冲突时后到者拒绝 */
  activeKeywords: ReadonlyMap<string, string>
}

/** 校验失败返回非空错误数组（每条含字段与可读信息），通过返回 []。绝不抛异常。 */
export function validateManifest(m: unknown, ctx: ValidateContext): ManifestError[] {
  const errors: ManifestError[] = []
  if (typeof m !== 'object' || m === null) {
    return [{ pluginId: '(unknown)', field: 'manifest', message: '清单必须是对象' }]
  }
  const id = (m as PluginManifest).id
  const pid = typeof id === 'string' ? id : '(unknown)'
  const push = (field: string, message: string): void => {
    errors.push({ pluginId: pid, field, message })
  }

  const protocolVersion = (m as PluginManifest).protocolVersion
  if (protocolVersion !== PROTOCOL_VERSION) {
    push('protocolVersion', `协议版本不兼容：${String(protocolVersion)}，宿主要求 ${PROTOCOL_VERSION}`)
  }
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    push('id', `id 非法：${JSON.stringify(id)}，须匹配 ${ID_RE.source}`)
  } else if (ctx.existingIds.has(id)) {
    push('id', `id 与已加载插件冲突：${id}`)
  }
  const name = (m as PluginManifest).name
  if (typeof name !== 'string' || name.length === 0) push('name', 'name 不能为空')
  const version = (m as PluginManifest).version
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    push('version', `version 非法：${JSON.stringify(version)}，须为 semver`)
  }
  const icon = (m as PluginManifest).icon
  if (typeof icon !== 'string' || icon.length === 0) push('icon', 'icon 不能为空')

  const keywords = (m as PluginManifest).keywords
  if (!Array.isArray(keywords) || keywords.length === 0 || keywords.some((k) => typeof k !== 'string' || k.length === 0)) {
    push('keywords', 'keywords 须为非空字符串数组')
  } else {
    for (const k of keywords) {
      const owner = ctx.activeKeywords.get(k)
      if (owner !== undefined && owner !== id) {
        push('keywords', `keyword「${k}」与已启用插件 ${owner} 冲突`)
      }
    }
  }

  const activation = (m as PluginManifest).activation
  if (activation !== 'trigger' && activation !== 'resident') {
    push('activation', `activation 非法：${JSON.stringify(activation)}`)
  }
  if (activation === 'resident' && (typeof (m as PluginManifest).backend !== 'string' || (m as PluginManifest).backend === '')) {
    push('backend', 'resident 插件必须声明 backend')
  }

  const permissions = (m as PluginManifest).permissions
  if (!Array.isArray(permissions) || permissions.some((p) => !(ALL_PERMISSIONS as readonly string[]).includes(p))) {
    push('permissions', 'permissions 含未知项')
  }

  const source = (m as PluginManifest).source
  if (source !== 'builtin' && source !== 'external') {
    push('source', `source 非法：${JSON.stringify(source)}`)
  }
  const entry = (m as PluginManifest).entry
  if (typeof entry !== 'string' || entry === '') push('entry', 'entry 不能为空')

  const commands = (m as PluginManifest).commands
  if (commands !== undefined) {
    if (!Array.isArray(commands)) {
      push('commands', 'commands 须为数组')
    } else {
      const cmdIds = new Set<string>()
      for (const c of commands) {
        const cid = (c as PluginCommand)?.id
        if (typeof cid !== 'string' || cid === '') {
          push('commands', 'command.id 不能为空')
        } else if (cmdIds.has(cid)) {
          push('commands', `command.id 重复：${cid}`)
        } else {
          cmdIds.add(cid)
        }
        if (typeof (c as PluginCommand)?.title !== 'string' || (c as PluginCommand).title === '') {
          push('commands', `command「${String(cid)}」title 不能为空`)
        }
      }
    }
  }
  return errors
}
