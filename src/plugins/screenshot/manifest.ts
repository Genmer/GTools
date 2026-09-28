import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'screenshot',
  name: '截图',
  version: '0.1.0',
  protocolVersion: 1,
  description: '框选屏幕任意区域截图，复制到剪贴板或另存为 PNG；可在 设置→指令热键 绑定全局快捷键直达',
  icon: '✂️',
  keywords: ['截图', 'screenshot', 'jietu'],
  activation: 'trigger',
  permissions: ['screenshot', 'clipboard:write', 'dialog', 'fs'],
  source: 'builtin',
  entry: './index.vue',
  commands: [{ id: 'capture', title: '屏幕截图' }]
}

export default manifest
