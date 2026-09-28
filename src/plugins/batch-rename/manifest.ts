import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'batch-rename',
  name: '批量重命名',
  version: '0.1.0',
  protocolVersion: 1,
  description: '拖入/多选文件，规则链实时预览新旧名对照：查找替换(正则)、插入/删除、序号、大小写、扩展名，冲突标红，批量执行 + 撤销',
  icon: '🗂️',
  keywords: ['batch-rename', '批量重命名', '重命名', 'plmm'],
  activation: 'trigger',
  permissions: ['dialog', 'fs', 'storage'],
  source: 'builtin',
  entry: './index.vue',
  // 拖任意文件/目录入主窗即推荐进主入口（无 extensions 不限类型），目录由视图按现有规则过滤
  matchers: [{ type: 'files', fileType: 'both', label: '批量重命名' }]
}

export default manifest
