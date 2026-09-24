import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'clipboard',
  name: '剪贴板历史',
  version: '0.2.0',
  protocolVersion: 1,
  description: '后台记录文本/图片剪贴板历史，分类浏览、搜索、固定置顶、一键复制',
  icon: '📋',
  keywords: ['cb', '剪贴板', 'jtb'],
  activation: 'resident',
  permissions: ['clipboard:read', 'clipboard:write', 'storage'],
  source: 'builtin',
  entry: './index.vue',
  backend: './backend/index.ts'
}

export default manifest
