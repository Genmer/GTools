export type ThemeName = 'light' | 'dark' | 'glass'

export interface AppSettings {
  hotkey: { darwin: string; win32: string }
  theme: ThemeName
  disabledPlugins: string[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  // Windows 上 Alt+Space 是系统菜单键，平台默认分开存
  hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' },
  theme: 'light',
  disabledPlugins: []
}
