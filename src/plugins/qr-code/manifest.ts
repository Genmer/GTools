import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'qr-code',
  name: '二维码生成',
  version: '0.1.0',
  protocolVersion: 1,
  description: 'URL 或文本一键生成二维码：识别到链接直接出码，支持复制二维码图片到剪贴板',
  icon: '🔳',
  keywords: ['qr', '二维码', 'erweima'],
  activation: 'trigger',
  permissions: ['clipboard:write'],
  source: 'builtin',
  entry: './index.vue',
  commands: [{ id: 'gen', title: '生成二维码' }],
  matchers: [{ type: 'regex', match: '^https?://\\S+$', label: '生成二维码', commandId: 'gen' }]
}

export default manifest
