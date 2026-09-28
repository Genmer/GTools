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
  /** 截图：唤起全屏选区遮罩窗抓屏（desktopCapturer + 冻结帧选区） */
  | 'screenshot'
  /** 仅声明面：常驻推送闸在渲染层，推送走既有 plugin-event 通道不经 dispatchApi，主进程无感知 */
  | 'mainPush'

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
  'apis:translate',
  'screenshot',
  'mainPush'
]

export interface PluginCommand {
  id: string
  title: string
  keywords?: string[]
}

/** 声明式文本匹配器（uTools over 风格）：宿主 core 消费的元数据，非能力面，不新增权限项 */
export interface PluginMatcher {
  type: 'text' | 'json' | 'regex' | 'files' | 'img'
  label: string
  /** 仅 regex 型使用，必填；任意匹配正则会被校验拒绝 */
  match?: string
  /** 命中文本命中此正则则排除该条推荐 */
  exclude?: string
  /** text 型最小长度，缺省 2 */
  minLength?: number
  /** 匹配前输入截断上限，1..10000，缺省 10000 */
  maxLength?: number
  /** 目标命令 id，缺省进插件主入口；必须存在于本清单 commands */
  commandId?: string
  /** 仅 files 型：限定文件（file）/目录（directory）/两者（both），缺省 both */
  fileType?: 'file' | 'directory' | 'both'
  /** 仅 files 型：小写、无点前缀扩展名白名单（如 ['pdf']），缺省不限 */
  extensions?: string[]
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
  /** 可选扩展字段：旧宿主不感知、新宿主对缺省跳过，两侧互兼容，不升协议版本 */
  matchers?: PluginMatcher[]
  /** 可选扩展字段（惯例同 matchers）：插件激活后宿主主框进入子输入态，占位文案归插件声明 */
  subInput?: { placeholder?: string }
}

export interface ManifestError {
  pluginId: string
  field: string
  message: string
}

const ID_RE = /^[a-z][a-z0-9-]*$/
const SEMVER_RE = /^\d+(\.\d+){0,2}(-[0-9A-Za-z.-]+)?$/
/** files 型 extensions 项：小写字母/数字、无点前缀（如 pdf） */
const EXTENSION_RE = /^[a-z0-9]+$/
const MATCHER_MAX_LENGTH = 10000
/** 反滥用探针：regex 型 match 对这些固定串全命中即判定为任意匹配正则（对齐 uTools 规则） */
const MATCHER_PROBES = ['x', '1', '中', 'a b']

function compilesRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

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

  const cmdIds = new Set<string>()
  const commands = (m as PluginManifest).commands
  if (commands !== undefined) {
    if (!Array.isArray(commands)) {
      push('commands', 'commands 须为数组')
    } else {
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

  const matchers = (m as PluginManifest).matchers
  if (matchers !== undefined) {
    if (!Array.isArray(matchers)) {
      push('matchers', 'matchers 须为数组')
    } else {
      for (let i = 0; i < matchers.length; i++) {
        const mt = matchers[i] as PluginMatcher
        const field = `matchers[${i}]`
        if (typeof mt !== 'object' || mt === null) {
          push(field, 'matcher 须为对象')
          continue
        }
        if (mt.type !== 'text' && mt.type !== 'json' && mt.type !== 'regex' && mt.type !== 'files' && mt.type !== 'img') {
          push(field, `type 非法：${JSON.stringify(mt.type)}`)
          continue
        }
        if (typeof mt.label !== 'string' || mt.label === '') {
          push(field, 'label 不能为空')
        }
        if (mt.type === 'files') {
          // 拖入是显式用户动作，反任意匹配探针不适用 files/img
          if (
            mt.extensions !== undefined &&
            (!Array.isArray(mt.extensions) || mt.extensions.some((e) => typeof e !== 'string' || !EXTENSION_RE.test(e)))
          ) {
            push(field, 'extensions 须为小写无点前缀扩展名数组（如 ["pdf"]）')
          }
          if (mt.fileType !== undefined && mt.fileType !== 'file' && mt.fileType !== 'directory' && mt.fileType !== 'both') {
            push(field, `fileType 非法：${String(mt.fileType)}，须为 file | directory | both`)
          }
        }
        if (mt.commandId !== undefined && (typeof mt.commandId !== 'string' || !cmdIds.has(mt.commandId))) {
          push(field, `commandId 须为本清单 commands 之一：${String(mt.commandId)}`)
        }
        if (
          mt.minLength !== undefined &&
          (typeof mt.minLength !== 'number' || !Number.isInteger(mt.minLength) || mt.minLength < 1)
        ) {
          push(field, 'minLength 须为 ≥1 的整数')
        }
        if (
          mt.maxLength !== undefined &&
          (typeof mt.maxLength !== 'number' || !Number.isInteger(mt.maxLength) || mt.maxLength < 1 || mt.maxLength > MATCHER_MAX_LENGTH)
        ) {
          push(field, `maxLength 须为 1..${MATCHER_MAX_LENGTH} 的整数`)
        }
        if (mt.minLength !== undefined && mt.maxLength !== undefined && mt.minLength > mt.maxLength) {
          push(field, 'minLength 不能大于 maxLength')
        }
        if (mt.exclude !== undefined && (typeof mt.exclude !== 'string' || !compilesRegex(mt.exclude))) {
          push(field, `exclude 正则非法：${String(mt.exclude)}`)
        }
        if (mt.type === 'regex') {
          if (typeof mt.match !== 'string' || mt.match === '') {
            push(field, 'regex 型必须声明 match')
          } else if (!compilesRegex(mt.match)) {
            push(field, `match 正则非法：${mt.match}`)
          } else if (MATCHER_PROBES.every((p) => new RegExp(mt.match as string).test(p))) {
            push(field, `match 拒绝任意匹配正则：/${mt.match}/`)
          }
        }
      }
    }
  }

  const subInput = (m as PluginManifest).subInput
  if (subInput !== undefined) {
    if (typeof subInput !== 'object' || subInput === null || Array.isArray(subInput)) {
      push('subInput', 'subInput 须为对象')
    } else {
      const placeholder = (subInput as { placeholder?: unknown }).placeholder
      if (placeholder !== undefined && (typeof placeholder !== 'string' || placeholder === '')) {
        push('subInput.placeholder', 'placeholder 存在时须为非空字符串')
      }
    }
  }
  return errors
}
