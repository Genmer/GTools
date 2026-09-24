import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'image-bed',
  name: '图床上传',
  version: '0.1.0',
  protocolVersion: 1,
  description: '拖入 / 粘贴 / 选择图片上传图床（默认 sm.ms，兼容兰空 lsky 与自定义接口），成功即复制链接，Markdown/HTML/URL 三格式切换，本地保留上传历史',
  icon: '🖼️',
  keywords: ['image-bed', '图床', 'tuchuang', 'tc'],
  activation: 'trigger',
  // 按需最小授权：上传走 net，粘贴/复制走 clipboard，选文件走 dialog（自动授权 fs）
  permissions: ['net', 'clipboard:read', 'clipboard:write', 'storage', 'dialog', 'fs', 'shell:open'],
  source: 'builtin',
  entry: './index.vue',
  commands: [{ id: 'history', title: '图床上传历史', keywords: ['tuchuanglishi', 'history'] }]
}

export default manifest
