export type ThemeName = 'light' | 'dark' | 'glass'

/** 玻璃主题的身景风格：wallpaper=透明浮岛+弹窗快照折射；acrylic=不透明窗+系统实时磨砂；clear=透明窗直透桌面（真·实时零算力） */
export type GlassMaterial = 'wallpaper' | 'acrylic' | 'clear'

/** 透明效果：所有主题可开。opacity 为透明度 0-100（越大越透），blur 为实时模糊（Win11 亚克力 / macOS vibrancy） */
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
  /** 仅 glass 主题消费；win32 wallpaper 模式走「弹窗瞬间取屏快照」折射（常驻流方案见 docs/DESIGN.md §5.1） */
  glassMaterial: GlassMaterial
  /** 材质来源：'user'=用户显式选择（load 的平台默认校正不动它）；缺省视为 auto（0.0.18 曾把 win32 默认误设 acrylic，靠此标记区分误写与选择） */
  glassMaterialSource?: 'auto' | 'user'
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
  glassMaterial: 'wallpaper',
  disabledPlugins: [],
  launchAtLogin: false,
  clipboardSuggest: true,
  hideOnBlur: true,
  commandHotkeys: []
}
