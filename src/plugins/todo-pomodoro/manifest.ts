import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'todo-pomodoro',
  name: '待办 · 番茄钟',
  version: '0.1.0',
  protocolVersion: 1,
  description: '待办清单（优先级 · 今日/全部视图）＋ 番茄钟（25/5 可调 · 到点通知 · 今日统计 · 便签悬浮常驻）',
  icon: '🍅',
  keywords: ['todo-pomodoro', 'todo', '待办', '番茄钟', 'fanqie'],
  activation: 'resident',
  // 通知用于倒计时结束提醒；浮窗用于便签式常驻小窗（backend 驱动，视图关掉也在）
  permissions: ['storage', 'notification', 'window:float'],
  source: 'builtin',
  entry: './index.vue',
  backend: './backend/index.ts'
}

export default manifest
