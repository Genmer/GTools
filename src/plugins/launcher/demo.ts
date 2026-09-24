import type { AppEntry } from './types'

// demo 态稳定示例应用列表（截图与新手引导用），路径均为虚构
export const DEMO_APPS: AppEntry[] = [
  { name: '微信', path: '/Applications/WeChat.app' },
  { name: 'Google Chrome', path: '/Applications/Google Chrome.app' },
  { name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' },
  { name: '网易云音乐', path: '/Applications/NeteaseCloudMusic.app' },
  { name: 'Obsidian', path: '/Applications/Obsidian.app' },
  { name: '飞书', path: '/Applications/Feishu.app' },
  { name: 'Figma', path: '/Applications/Figma.app' },
  { name: 'WezTerm', path: '/Applications/WezTerm.app' },
  { name: 'Postman', path: '/Applications/Postman.app' },
  { name: '企业微信', path: '/Applications/WeCom.app' },
  { name: 'QQ', path: '/Applications/QQ.app' },
  { name: '终端', path: '/System/Applications/Utilities/Terminal.app' }
]
