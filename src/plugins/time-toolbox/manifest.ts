import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'time-toolbox',
  name: '时间戳百宝箱',
  version: '0.1.0',
  protocolVersion: 1,
  description: '时间工具百宝箱：当前时间多格式、时间戳↔日期互转（秒/毫秒自动识别）、相对时间计算、常用时区对照',
  icon: '⏰',
  keywords: ['time', '时间戳', '时间', 'sj', 'shijian'],
  activation: 'trigger',
  permissions: ['clipboard:write'],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
