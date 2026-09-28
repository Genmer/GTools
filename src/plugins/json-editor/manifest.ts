import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'json-editor',
  name: 'JSON 编辑器',
  version: '0.1.0',
  protocolVersion: 1,
  description: 'JSON 编辑器：左编辑右树视图，格式化/压缩/校验/复制，错误定位到行列，大 JSON 懒渲染',
  icon: '{ }',
  keywords: ['json', 'json-editor', 'bianjiqi', '编辑器'],
  activation: 'trigger',
  // fs：拖 .json 入主窗推荐进入后插件自行 grant + 读取预填
  permissions: ['storage', 'clipboard:write', 'fs'],
  source: 'builtin',
  entry: './index.vue',
  // 剪贴板 JSON 智能推荐（C2）：JSON 判定在宿主 core，激活时整段文本追加进草稿不覆盖
  matchers: [
    { type: 'json', label: '打开 JSON 编辑器' },
    { type: 'files', extensions: ['json'], label: '编辑 JSON 文件' }
  ]
}

export default manifest
