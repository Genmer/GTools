import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'markdown-notes',
  name: 'Markdown 笔记',
  version: '0.2.0',
  protocolVersion: 1,
  description: '速记型 Markdown 笔记本：列表管理 + 编辑/预览切换，本地持久化，导出 .md / 复制富文本',
  icon: '📝',
  keywords: ['markdown-notes', 'md', 'markdown', '笔记', 'biji'],
  activation: 'trigger',
  permissions: ['storage', 'clipboard:write', 'dialog', 'fs'],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
