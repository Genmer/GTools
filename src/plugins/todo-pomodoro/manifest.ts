import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'todo-pomodoro',
  name: '待办清单',
  version: '0.2.0',
  protocolVersion: 1,
  description: '待办清单：优先级标记、今日/全部视图、快捷添加（长任务配「计时器」插件的番茄钟使用）',
  icon: '📝',
  keywords: ['todo-pomodoro', 'todo', '待办'],
  activation: 'trigger',
  permissions: ['storage'],
  source: 'builtin',
  entry: './index.vue',
  commands: [
    { id: 'add', title: '添加到待办' }
  ],
  matchers: [
    { type: 'text', label: '添加到待办', commandId: 'add' }
  ]
}

export default manifest
