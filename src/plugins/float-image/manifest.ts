import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'float-image',
  name: '图片悬浮',
  version: '0.1.0',
  protocolVersion: 1,
  description: '贴图：把剪贴板 / 本地图片钉成置顶小窗（可拖动、滚轮缩放、调不透明度），或把剪贴板图片直接存成 PNG 文件',
  icon: '📌',
  keywords: ['float-image', '贴图', 'tietu', 'ft'],
  activation: 'trigger',
  permissions: ['clipboard:read', 'window:float', 'dialog', 'fs', 'storage', 'window:hide'],
  source: 'builtin',
  entry: './index.vue',
  commands: [
    { id: 'pin-clipboard', title: '贴图：贴出剪贴板图片', keywords: ['tietu', 'jianjie'] },
    { id: 'pin-file', title: '贴图：选择图片文件', keywords: ['tupian'] },
    { id: 'save-clipboard', title: '保存剪贴板图片为文件', keywords: ['baocun', 'bcfj'] }
  ],
  matchers: [
    { type: 'files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'], label: '贴图：悬浮图片文件', commandId: 'pin-file' },
    { type: 'img', label: '贴图：贴出剪贴板图片', commandId: 'pin-clipboard' }
  ]
}

export default manifest
