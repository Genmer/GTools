// 广播通道注册表：登记的通道投递所有存活窗口，未登记通道一律只发主窗（fail-closed）
// settings-changed 必须留主窗定向：detached 主题走 detached:theme 专用同步链，全窗化会让 detached 的
// App.vue 处理器触发主窗专属剪贴板探查；command-hotkey 同理，detached 收到即误触发插件进入
export const ALL_WINDOWS_BROADCAST_CHANNELS: readonly string[] = ['plugin-state-changed', 'api-services-changed']

export function isAllWindowsBroadcast(channel: string): boolean {
  return ALL_WINDOWS_BROADCAST_CHANNELS.includes(channel)
}
