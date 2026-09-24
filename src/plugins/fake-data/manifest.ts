import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'fake-data',
  name: '随机假数据',
  version: '0.1.0',
  protocolVersion: 1,
  description: '本地生成中文姓名/手机号/邮箱/身份证/地址/公司名/时间/金额等测试数据，支持字段组合模板',
  icon: '🎲',
  keywords: ['fake-data', '假数据', 'jiashuju', '随机数据'],
  activation: 'trigger',
  permissions: ['storage', 'clipboard:write'],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
