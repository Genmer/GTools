import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'float-image',
  name: '图片悬浮',
  version: '0.1.0',
  protocolVersion: 1,
  description: '贴图：把剪贴板 / 本地图片钉成置顶小窗，可拖动、滚轮缩放、调不透明度，位置与缩放会被记住',
  icon: '📌',
  keywords: ['float-image', '贴图', 'tietu', 'ft'],
  activation: 'trigger',
  permissions: ['clipboard:read', 'window:float', 'dialog', 'fs', 'storage'],
  source: 'builtin',
  entry: './index.vue',
  commands: [
    { id: 'pin-clipboard', title: '贴图：贴出剪贴板图片', keywords: ['tietu', 'jianjie'] },
    { id: 'pin-file', title: '贴图：选择图片文件', keywords: ['tupian'] }
  ]
}

export default manifest
