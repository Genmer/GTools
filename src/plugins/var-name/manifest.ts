import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'var-name',
  name: '变量命名',
  version: '0.1.0',
  protocolVersion: 1,
  description: '输入中英文描述 → 按语言预设生成各上下文命名候选，一键复制（中译英经全局 API 中心，离线词典兜底）',
  icon: '🏷️',
  // 已核对不冲突：mm 归 password-vault、重命名/plmm 归 batch-rename、bianma 是 devtools 命令词
  keywords: ['vn', '命名', 'var'],
  activation: 'trigger',
  permissions: ['apis:translate', 'clipboard:read', 'clipboard:write', 'storage'],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
