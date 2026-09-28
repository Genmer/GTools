import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'text-batch',
  name: '文本批量处理',
  version: '0.1.0',
  protocolVersion: 1,
  description: '多行文本批处理：查找替换、正则替换、去重、排序、大小写、trim、加前后缀、按行过滤，规则链实时预览，一键复制结果',
  icon: '🧾',
  keywords: ['text-batch', '文本批量', '批量处理', 'wbpl'],
  activation: 'trigger',
  // 复制结果走渲染层 navigator.clipboard（无需权限），纯前端无存储无网络
  permissions: [],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
