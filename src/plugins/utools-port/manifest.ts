import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'utools-port',
  name: 'UTools 移植',
  version: '0.1.0',
  protocolVersion: 1,
  description: 'uTools 插件兼容容器 POC：加载运行 userData/utools-plugins/ 下的插件（不执行 preload.js）',
  icon: '🧩',
  keywords: ['utools', '移植', '兼容'],
  activation: 'trigger',
  permissions: [],
  source: 'builtin',
  entry: './index.vue',
  commands: [{ id: 'utools', title: 'UTools 插件管理' }]
}

export default manifest
