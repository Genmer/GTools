import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'translate',
  name: '聚合翻译',
  version: '0.3.0',
  protocolVersion: 1,
  description: '左右双栏聚合翻译：引擎切换（取设置 → API 服务 已启用引擎）· 交换语种 · 复制与发音，默认 MyMemory 免 Key',
  icon: '🌐',
  keywords: ['fy', '翻译', 'fanyi'],
  activation: 'trigger',
  // 翻译经全局 API 中心代理（host.apis），不再自持 net；按需最小授权
  permissions: ['apis:translate', 'clipboard:read', 'clipboard:write', 'storage'],
  source: 'builtin',
  entry: './index.vue',
  // 宿主推荐行（uTools over 风格）：任意非空查询压底推荐，命中文本经既有 query 通路注入
  matchers: [{ type: 'text', label: '用聚合翻译翻译' }]
}

export default manifest
