import { hitFromPath, type FileHit } from './parse'

// demo 态稳定示例（截图与新手引导用），路径均为虚构 /Users/demo 前缀
export const DEMO_QUERY = '设计'

const RAW_PATHS = [
  '/Users/demo/Documents/软考架构/2026-论文',
  '/Users/demo/Documents/设计/设计规范-v3.pdf',
  '/Users/demo/Documents/工作/会议纪要-0924.md',
  '/Users/demo/Movies/travel-2026.mp4',
  '/Users/demo/Downloads/GTools-0.1.1.dmg'
]

export const DEMO_HITS: FileHit[] = RAW_PATHS.map((p) => hitFromPath(p))

DEMO_HITS[0].isDirectory = true
