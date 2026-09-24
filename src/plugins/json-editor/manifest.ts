import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'json-editor',
  name: 'JSON 编辑器',
  version: '0.1.0',
  protocolVersion: 1,
  description: 'JSON 编辑器：左编辑右树视图，格式化/压缩/校验/复制，错误定位到行列，大 JSON 懒渲染',
  icon: '{ }',
  keywords: ['json', 'json-editor', 'bianjiqi', '编辑器'],
  activation: 'trigger',
  permissions: ['storage', 'clipboard:write'],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
