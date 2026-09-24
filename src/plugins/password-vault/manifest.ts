import type { PluginManifest } from '@sdk/manifest'

const manifest: PluginManifest = {
  id: 'password-vault',
  name: '密码管理器',
  version: '0.1.0',
  protocolVersion: 1,
  description: '主密码 + PBKDF2/AES-GCM 本地加密保存账号，复制密码 30 秒自动清空剪贴板，附随机密码生成器',
  icon: '🔐',
  keywords: ['password-vault', '密码', 'mm', 'passwd'],
  activation: 'trigger',
  // 渲染层 crypto.subtle 直接做加解密（DESIGN 附录 A.6），不需要 net/dialog 等
  permissions: ['storage', 'clipboard:read', 'clipboard:write'],
  source: 'builtin',
  entry: './index.vue',
  commands: [{ id: 'generate', title: '随机密码生成', keywords: ['sjmm'] }]
}

export default manifest
