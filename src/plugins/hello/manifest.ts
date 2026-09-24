import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'hello',
  name: 'Hello 示例',
  version: '0.1.0',
  protocolVersion: 1,
  description: '新增插件零改动公共代码的最小示例',
  icon: '👋',
  keywords: ['hello', '你好'],
  activation: 'trigger',
  permissions: [],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
