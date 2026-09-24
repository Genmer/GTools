import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'dev-manual',
  name: '程序员离线手册',
  version: '0.1.0',
  protocolVersion: 1,
  description: 'Linux 命令 / Git / HTTP 状态码 / 正则语法 / VSCode 快捷键离线速查，支持拼音搜索与收藏',
  icon: '📘',
  keywords: ['dev-manual', '手册', 'shouce', 'linux'],
  activation: 'trigger',
  permissions: ['storage', 'clipboard:write'],
  source: 'builtin',
  entry: './index.vue',
  commands: [
    { id: 'linux', title: 'Linux 命令速查', keywords: ['mingling'] },
    { id: 'git', title: 'Git 操作速查', keywords: ['caozuo'] },
    { id: 'http', title: 'HTTP 状态码速查', keywords: ['zhuangtaima'] },
    { id: 'regex-syntax', title: '正则语法速查', keywords: ['regexp', 'yufa'] },
    { id: 'vscode', title: 'VSCode 快捷键速查', keywords: ['kjj'] },
    { id: 'favorites', title: '手册收藏', keywords: ['shoucang', 'fav'] }
  ]
}

export default manifest
