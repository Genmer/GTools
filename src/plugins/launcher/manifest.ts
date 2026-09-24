import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'launcher',
  name: '应用启动器',
  version: '0.1.0',
  protocolVersion: 1,
  description: '搜索并启动本机已安装应用',
  icon: '🚀',
  keywords: ['app', '启动', 'qd'],
  activation: 'trigger',
  permissions: ['shell:open', 'storage', 'notification', 'window:hide'],
  source: 'builtin',
  entry: './index.vue',
  backend: './backend/index.ts'
}

export default manifest
