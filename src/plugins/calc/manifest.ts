import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'calc',
  name: '计算稿纸',
  version: '0.3.0',
  protocolVersion: 1,
  description: '行式计算稿纸：逐行实时结果（千分位）· 变量/ans/pi · 百分比/幂/括号/常用函数 · Σ 合计 · 本地保存与历史',
  icon: '🧮',
  keywords: ['calc', '计算', 'jisuan', '稿纸', 'gaozhi'],
  activation: 'trigger',
  permissions: ['storage', 'clipboard:write'],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
