import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'lan-file-share',
  name: '局域网文件共享',
  version: '0.1.0',
  protocolVersion: 1,
  description: '选文件夹在局域网起 HTTP 服务：手机扫码即可上传/下载/在线预览，多文件打包下载，实时连接设备与传输日志',
  icon: '📡',
  keywords: ['lan-file-share', '共享', '文件共享', 'wjgx'],
  activation: 'trigger',
  permissions: ['dialog', 'fs', 'net', 'storage', 'notification', 'shell:open'],
  source: 'builtin',
  entry: './index.vue',
  backend: './backend/index.ts'
}

export default manifest
