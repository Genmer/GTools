import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'timer',
  name: '计时器',
  version: '0.1.0',
  protocolVersion: 1,
  description: '倒计时（到点通知 · 标签 · 悬浮球）＋ 番茄钟（25/5 可调 · 今日统计 · 悬浮球）',
  icon: '⏱',
  keywords: ['timer', '计时器', '倒计时', '番茄钟', 'fanqie', 'daojishi', 'djs'],
  activation: 'resident',
  // 通知用于到点提醒；浮窗用于桌面悬浮球；window:main 供球双击唤回主面板（backend 驱动）
  permissions: ['storage', 'notification', 'window:float', 'window:main'],
  source: 'builtin',
  entry: './index.vue',
  backend: './backend/index.ts',
  commands: [
    { id: 'countdown', title: '倒计时', keywords: ['daojishi', 'djs'] },
    { id: 'pomodoro', title: '番茄钟', keywords: ['fanqie', '番茄'] }
  ]
}

export default manifest
