import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'pdf-tools',
  name: 'PDF 工具箱',
  version: '0.1.0',
  protocolVersion: 1,
  description: 'PDF 本地处理：合并、拆分、旋转、删页、提取页、图片转 PDF，全部本地完成不出网',
  icon: '📄',
  keywords: ['pdf', 'PDF工具', 'pdfgj', '合并', '拆分', '旋转'],
  activation: 'trigger',
  permissions: ['dialog', 'fs'],
  source: 'builtin',
  entry: './index.vue',
  // 拖 .pdf 入主窗即推荐进主入口（commandId 缺省），授权与预填由插件视图 initialPayload 自理
  matchers: [{ type: 'files', extensions: ['pdf'], label: '处理 PDF 文件' }]
}

export default manifest
