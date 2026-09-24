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
  entry: './index.vue'
}

export default manifest
