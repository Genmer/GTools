import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'diff',
  name: '代码对比',
  version: '0.1.0',
  protocolVersion: 1,
  description: '左右两栏文本/代码对比：行级+词级高亮、同步滚动、增删改统计、忽略大小写/空白、结果可复制',
  icon: '🔀',
  keywords: ['diff', '对比', 'duibi', 'db'],
  activation: 'trigger',
  // storage 持久化选项；clipboard 读入两侧文本与复制结果
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
