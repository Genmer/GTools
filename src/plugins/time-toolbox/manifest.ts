import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'time-toolbox',
  name: '时间戳百宝箱',
  version: '0.2.0',
  protocolVersion: 1,
  description: '时间工具百宝箱：当前时间多格式、时间戳↔日期互转（秒/毫秒自动识别）、相对时间计算、倒计时提醒、常用时区对照',
  icon: '⏰',
  keywords: ['time', '时间戳', '时间', 'sj', 'shijian'],
  activation: 'trigger',
  // 通知用于倒计时到点提醒（backend 驱动：窗口隐藏后渲染层 timer 被节流，到点判定须在主进程）
  permissions: ['clipboard:write', 'notification'],
  source: 'builtin',
  entry: './index.vue',
  backend: './backend/index.ts',
  commands: [{ id: 'countdown', title: '倒计时', keywords: ['daojishi', 'djs'] }]
}

export default manifest
