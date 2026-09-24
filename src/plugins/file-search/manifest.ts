import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'file-search',
  name: '本地搜索',
  version: '0.1.0',
  protocolVersion: 1,
  description: '按文件名搜本机文件：macOS 走 Spotlight（mdfind），类型徽标 + 回车打开 + ⌘C 复制路径；Windows 支持规划中',
  icon: '🔎',
  keywords: ['fs', '文件搜索', '本地搜索', 'wjsousuo', 'bendisousuo'],
  activation: 'trigger',
  // backend 跑 mdfind（node:child_process）；渲染层经 storage 写请求、订阅 emit 收结果
  permissions: ['storage', 'shell:open', 'window:hide', 'clipboard:write', 'notification'],
  source: 'builtin',
  entry: './index.vue',
  backend: './backend/index.ts'
}

export default manifest
