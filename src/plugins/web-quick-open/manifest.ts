import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'web-quick-open',
  name: '网页快开',
  version: '0.1.0',
  protocolVersion: 1,
  description: '常用站点一敲即开：内置搜索/视频/开发/社交站点库，拼音全拼/首字母模糊匹配，支持自定义站点与「缩写 关键词」直达搜索',
  icon: '🔗',
  keywords: ['web-quick-open', 'web', '网页快开', 'wykk'],
  activation: 'trigger',
  // 无 backend：打开网址走宿主 shell.openExternal（跨平台由宿主消化，插件无平台分支）
  permissions: ['shell:open', 'storage', 'window:hide'],
  source: 'builtin',
  entry: './index.vue'
}

export default manifest
