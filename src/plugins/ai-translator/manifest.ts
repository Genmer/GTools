import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'ai-translator',
  name: 'AI翻译',
  version: '0.1.0',
  protocolVersion: 1,
  icon: '🤖',
  // fy/翻译/fanyi 已被聚合翻译占用；aitr 为精确串主关键词
  keywords: ['aitr', 'ai翻译'],
  activation: 'trigger',
  // 翻译经全局 API 中心 AI 品类代理（host.apis），无内置免 Key 默认；按需最小授权
  permissions: ['apis:ai', 'clipboard:write', 'storage'],
  source: 'builtin',
  entry: './index.vue',
  // 宿主推荐行（uTools over 风格）：任意非空查询压底推荐，命中文本经既有 query 通路注入
  matchers: [{ type: 'text', label: '用 AI翻译翻译' }]
}

export default manifest
