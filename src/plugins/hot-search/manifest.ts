import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'hot-search',
  name: '热搜聚合榜',
  version: '0.1.0',
  protocolVersion: 1,
  description: '聚合微博/百度/知乎/B站/抖音/头条实时热搜，关注词过滤，新上榜标『新』，点击直达原文',
  icon: '🔥',
  keywords: ['hot-search', '热搜', 'resou', '热榜'],
  activation: 'trigger',
  // 渲染层经 host.net.fetch 走主进程网络栈（无 CORS、走系统代理），无需 backend
  permissions: ['net', 'storage', 'shell:open'],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
