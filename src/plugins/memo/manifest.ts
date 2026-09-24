import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'memo',
  name: '备忘快贴',
  version: '0.1.0',
  protocolVersion: 1,
  description: '极简备忘便签：顶部输入回车即存，单列便签流支持置顶 / 复制 / 删除，本地持久化',
  icon: '🗒️',
  keywords: ['memo', '备忘', 'beiwang', '快贴'],
  activation: 'trigger',
  permissions: ['storage', 'clipboard:write'],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
