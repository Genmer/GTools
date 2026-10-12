export type ThemeName = 'light' | 'dark' | 'glass'

/** 轮廓环颜色：auto=跟随主题组默认（浅色黑线/深色白线/透明七彩），rainbow-gradient=平滑渐变环，custom=用户自选色 */
export type OutlineColor = 'auto' | 'white' | 'black' | 'rainbow' | 'rainbow-gradient' | 'custom'

/** 透明效果：所有主题可开。opacity 为透明度 0-100（越大越透），blur 为实时模糊（Win11 亚克力 / macOS vibrancy）；
 *  glass 主题的磨砂/清透也由 blur 决定（磨霜=系统实时材质，清透=透明窗直透桌面） */
export interface TransparencySettings {
  enabled: boolean
  opacity: number
  blur: boolean
}

export const DEFAULT_TRANSPARENCY: TransparencySettings = { enabled: true, opacity: 55, blur: true }

/** 自定义环色默认值（与七彩源色 c3 同族蓝，浅深色/玻璃下均可读） */
export const OUTLINE_CUSTOM_COLOR_DEFAULT = '#42a5f5'

export const OUTLINE_FLOW_SPEED_MIN = 1
export const OUTLINE_FLOW_SPEED_MAX = 10
export const OUTLINE_FLOW_SPEED_DEFAULT = 3

/** 插件指令热键绑定，双平台各存一份展示形态加速键；校验用 @sdk/shortcut-rules */
export interface CommandHotkey {
  pluginId: string
  commandId: string
  darwin: string
  win32: string
}

export interface AppSettings {
  hotkey: { darwin: string; win32: string }
  theme: ThemeName
  transparency: TransparencySettings
  /** 窗口轮廓环（黑/白线或透明模式七彩环）总开关；视觉偏好，随备份迁移 */
  outlineEnabled: boolean
  /** 环宽 px（OUTLINE_WIDTH_MIN..MAX 整数，0=隐形）；视觉偏好，随备份迁移 */
  outlineWidth: number
  /** 轮廓环颜色（auto=跟随主题组默认，其余强制覆写）；视觉偏好，随备份迁移 */
  outlineColor: OutlineColor
  /** 自定义环色 #rrggbb，仅 outlineColor='custom' 时被 CSS 消费；无 alpha（与七彩源色站 rgba 的 0.8 半透明质感略异，custom 环全不透明）；视觉偏好，随备份迁移 */
  outlineCustomColor: string
  /** 七彩/七彩渐变的流动速度 1-10 档（环带巡游一圈时长 = 36/s 秒，3 档 = 12s）；仅 rainbow 两档消费；视觉偏好，随备份迁移 */
  outlineFlowSpeed: number
  disabledPlugins: string[]
  /** 机器相关设置：随备份迁移无意义，导入恢复不覆盖（见 ipc.ts 备份恢复的显式字段枚举） */
  launchAtLogin: boolean
  /** 行为偏好，备份导入不恢复（ipc.ts 备份恢复显式字段枚举不含，同 launchAtLogin） */
  clipboardSuggest: boolean
  hideOnBlur: boolean
  /** 行为偏好，同上不随备份恢复（恢复枚举在 ipc.ts，归 P7）；热键注册生效也归 P7，本字段先只做存取 */
  commandHotkeys: CommandHotkey[]
  /** 上次主窗位置（用户拖动后记忆，仅当所在屏与唤起时光标屏一致时沿用）；机器相关，不随备份迁移 */
  windowPos: { x: number; y: number } | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  // Windows 上 Alt+Space 是系统菜单键，平台默认分开存
  hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' },
  theme: 'light',
  transparency: { ...DEFAULT_TRANSPARENCY },
  outlineEnabled: true,
  outlineWidth: 3,
  outlineColor: 'auto',
  outlineCustomColor: OUTLINE_CUSTOM_COLOR_DEFAULT,
  outlineFlowSpeed: OUTLINE_FLOW_SPEED_DEFAULT,
  disabledPlugins: [],
  launchAtLogin: false,
  clipboardSuggest: true,
  hideOnBlur: true,
  commandHotkeys: [],
  windowPos: null
}

export const OUTLINE_WIDTH_MIN = 0
export const OUTLINE_WIDTH_MAX = 5

/** 非有限数返回 null（调用方剔除回退现值），否则 round 后夹 MIN..MAX */
export function sanitizeOutlineWidth(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(OUTLINE_WIDTH_MAX, Math.max(OUTLINE_WIDTH_MIN, Math.round(v)))
}

/** 自定义环色只收 #rgb/#rrggbb：3 位扩 6 位并小写化输出规范 #rrggbb，其余（非字符串/位数不对/无 #）返回 null 由调用方剔除保现值 */
export function sanitizeOutlineCustomColor(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)
  if (!m) return null
  const hex = m[1].length === 3
    ? m[1][0] + m[1][0] + m[1][1] + m[1][1] + m[1][2] + m[1][2]
    : m[1]
  return `#${hex.toLowerCase()}`
}

/** 非有限数返回 null（调用方剔除回退现值），否则 round 后夹 MIN..MAX */
export function sanitizeOutlineFlowSpeed(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return Math.min(OUTLINE_FLOW_SPEED_MAX, Math.max(OUTLINE_FLOW_SPEED_MIN, Math.round(v)))
}

/** 流动一圈时长（秒）：36/s，默认 3 档 = 12s 与 themes.css 的 --rim-flow-period 兜底值一致；坏值回 12s */
export function rimFlowPeriodSeconds(speed: unknown): number {
  const s = sanitizeOutlineFlowSpeed(speed)
  return s === null ? 12 : 36 / s
}

export function isOutlineColor(v: unknown): v is OutlineColor {
  return v === 'auto' || v === 'white' || v === 'black' || v === 'rainbow' || v === 'rainbow-gradient' || v === 'custom'
}
