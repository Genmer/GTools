export type ThemeName = 'light' | 'dark' | 'glass'

/** 透明效果：所有主题可开。opacity 为透明度 0-100（越大越透），blur 为实时模糊（Win11 亚克力 / macOS vibrancy）；
 *  glass 主题的磨砂/清透也由 blur 决定（磨霜=系统实时材质，清透=透明窗直透桌面） */
export interface TransparencySettings {
  enabled: boolean
  opacity: number
  blur: boolean
}

export const DEFAULT_TRANSPARENCY: TransparencySettings = { enabled: true, opacity: 55, blur: true }

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
  disabledPlugins: string[]
  /** 机器相关设置：随备份迁移无意义，导入恢复不覆盖（见 ipc.ts 备份恢复的显式字段枚举） */
  launchAtLogin: boolean
  /** 行为偏好，备份导入不恢复（ipc.ts 备份恢复显式字段枚举不含，同 launchAtLogin） */
  clipboardSuggest: boolean
  hideOnBlur: boolean
  /** 行为偏好，同上不随备份恢复（恢复枚举在 ipc.ts，归 P7）；热键注册生效也归 P7，本字段先只做存取 */
  commandHotkeys: CommandHotkey[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  // Windows 上 Alt+Space 是系统菜单键，平台默认分开存
  hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' },
  theme: 'light',
  transparency: { ...DEFAULT_TRANSPARENCY },
  disabledPlugins: [],
  launchAtLogin: false,
  clipboardSuggest: true,
  hideOnBlur: true,
  commandHotkeys: []
}
