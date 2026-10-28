import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'json-editor',
  name: 'JSON 编辑器',
  version: '0.3.0',
  protocolVersion: 1,
  description: 'JSON 编辑器：粘贴自动格式化，Ctrl+F 搜索高亮跳转，容忍注释/尾逗号，光标处复制 JSONPath，错误定位到行列；识别 MongoDB 导出（ObjectId/ISODate）等宽松 JSON 自动归一化展开',
  icon: '{ }',
  keywords: ['json', 'json-editor', 'bianjiqi', '编辑器'],
  activation: 'trigger',
  // fs：拖 .json 入主窗推荐进入后插件自行 grant + 读取预填
  permissions: ['storage', 'clipboard:write', 'fs'],
  source: 'builtin',
  entry: './index.vue',
  // 剪贴板 JSON 智能推荐：判定在 sdk/json-detect（主进程 peek-json 网关与渲染层 matcher 共用），激活时全文经 initialText 通道注入（不进 query 通路）
  matchers: [
    { type: 'json', label: '打开 JSON 编辑器' },
    { type: 'files', extensions: ['json'], label: '编辑 JSON 文件' }
  ]
}

export default manifest
