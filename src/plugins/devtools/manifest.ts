import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'devtools',
  name: '开发者工具集',
  version: '0.1.0',
  protocolVersion: 1,
  description: 'JSON / 时间戳 / UUID / Base64 / 正则 / 颜色 / JWT',
  icon: '🧰',
  keywords: ['dev', '开发者', 'kfz'],
  activation: 'trigger',
  permissions: ['storage'],
  source: 'builtin',
  entry: './index.vue',
  commands: [
    // json 一词归专门的 json-editor 插件，此处用 jsonformat 避免跨插件触发词冲突
    { id: 'json-format', title: 'JSON 格式化', keywords: ['jsonformat', 'geshihua'] },
    // time 一词归专门的 time-toolbox 插件
    { id: 'timestamp', title: '时间戳互转', keywords: ['timestamp', 'shijianchuo'] },
    { id: 'uuid', title: 'UUID 生成', keywords: ['uuid'] },
    { id: 'base64', title: 'Base64 编解码', keywords: ['base64', 'bianma'] },
    { id: 'regex', title: '正则测试', keywords: ['regex', 'zhengze'] },
    { id: 'color', title: '颜色转换', keywords: ['color', 'yanse'] },
    { id: 'jwt', title: 'JWT 解码', keywords: ['jwt', 'jiema'] }
  ]
}

export default manifest
