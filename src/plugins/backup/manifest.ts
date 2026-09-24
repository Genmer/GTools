import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'backup',
  name: '数据备份迁移',
  version: '0.1.0',
  protocolVersion: 1,
  description: '导出全部数据为单个 .gtools 文件，跨 win/mac 迁移，导入前可预览差异',
  icon: '📦',
  keywords: ['backup', 'beifen', '备份', '迁移'],
  activation: 'trigger',
  permissions: ['dialog', 'fs', 'storage', 'shell:open'],
  source: 'builtin',
  entry: './index.vue',
  backend: './backend/index.ts',
  commands: [
    { id: 'export', title: '导出数据备份', keywords: ['daochu'] },
    { id: 'import', title: '导入数据备份', keywords: ['daoru', 'huanyuan'] }
  ]
}

export default manifest
