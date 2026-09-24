// 空态应用栏（ui-style-guide §1.5）的共享面：宿主 apps:* 通道返回值校验、置顶重排、字母块配色与 demo 示例数据

export interface NativeAppItem {
  id: string
  name: string
  path: string
  bundleId?: string
  /** 主进程内部解析用，渲染层忽略 */
  iconPath?: string
  /** 64px dataURL；undefined = 字母块兜底 */
  icon?: string
}

export interface AppsSnapshot {
  apps: NativeAppItem[]
  scannedAt: number
  fromCache: boolean
  pinned: string[]
}

/** 宽松校验：单条坏数据跳过，整体坏形状返回 null（触发错误提示与兜底网格） */
export function parseAppsSnapshot(raw: unknown): AppsSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null
  const s = raw as { apps?: unknown; scannedAt?: unknown; fromCache?: unknown; pinned?: unknown }
  if (!Array.isArray(s.apps)) return null
  const apps: NativeAppItem[] = []
  for (const a of s.apps) {
    if (typeof a !== 'object' || a === null) continue
    const e = a as Record<string, unknown>
    if (typeof e.id !== 'string' || e.id === '') continue
    if (typeof e.name !== 'string' || e.name === '' || typeof e.path !== 'string' || e.path === '') continue
    apps.push({
      id: e.id,
      name: e.name,
      path: e.path,
      bundleId: typeof e.bundleId === 'string' && e.bundleId !== '' ? e.bundleId : undefined,
      iconPath: typeof e.iconPath === 'string' && e.iconPath !== '' ? e.iconPath : undefined,
      icon: typeof e.icon === 'string' && e.icon.startsWith('data:image') ? e.icon : undefined
    })
  }
  return {
    apps,
    scannedAt: typeof s.scannedAt === 'number' ? s.scannedAt : 0,
    fromCache: s.fromCache === true,
    pinned: parsePinnedIds(s.pinned) ?? []
  }
}

export function parsePinnedIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  return raw.filter((x): x is string => typeof x === 'string' && x !== '')
}

/** pin/unpin 后按服务端返回的全量置顶序本地重排；非置顶保持原相对序（list 返回时已按名称排好） */
export function reorderApps<T extends { id: string }>(apps: T[], pinned: readonly string[]): T[] {
  const rank = new Map(pinned.map((id, i) => [id, i]))
  return [...apps].sort((a, b) => {
    const pa = rank.get(a.id)
    const pb = rank.get(b.id)
    if (pa !== undefined && pb === undefined) return -1
    if (pa === undefined && pb !== undefined) return 1
    if (pa !== undefined && pb !== undefined) return pa - pb
    return 0
  })
}

const TILE_COLORS = ['blue', 'green', 'amber', 'rose', 'violet', 'teal'] as const

/** 无图标应用的字母块配色：按稳定 hash 六色轮换（对应 themes.css --tile-*） */
export function tileColorClass(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `t-${TILE_COLORS[h % TILE_COLORS.length]}`
}

/** 应用栏折叠态显示的应用数：1 行 × 9 列 − 1（末格留给「展开」抽屉按钮）；空态总行数 = 最近打开 1 行 + 应用 1 行 */
export const APPS_FOLD_COUNT = 8

// #demo=1 截图/演示场景注入的示例应用（无图标走彩色字母块；打开与置顶均为本地演示，不落宿主数据）。
// 20 个 > APPS_FOLD_COUNT，让 demo/截图能看到折叠按钮形态
export const DEMO_APPS: NativeAppItem[] = [
  { id: 'com.tencent.xinWeChat', name: '微信', path: '/Applications/WeChat.app' },
  { id: 'com.google.Chrome', name: 'Google Chrome', path: '/Applications/Google Chrome.app' },
  { id: 'com.apple.Safari', name: 'Safari', path: '/Applications/Safari.app' },
  { id: 'com.microsoft.VSCode', name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' },
  { id: 'com.alibaba.DingTalk', name: '钉钉', path: '/Applications/DingTalk.app' },
  { id: 'com.netease.163music', name: '网易云音乐', path: '/Applications/NeteaseMusic.app' },
  { id: 'com.figma.Desktop', name: 'Figma', path: '/Applications/Figma.app' },
  { id: 'ru.keepcoder.Telegram', name: 'Telegram', path: '/Applications/Telegram.app' },
  { id: 'us.zoom.xos', name: 'Zoom', path: '/Applications/zoom.us.app' },
  { id: 'cn.yinxiang.Mac', name: '印象笔记', path: '/Applications/Evernote.app' },
  { id: 'com.valvesoftware.steam', name: 'Steam', path: '/Applications/Steam.app' },
  { id: 'com.apple.iWork.Keynote', name: 'Keynote', path: '/System/Applications/Keynote.app' },
  { id: 'org.mozilla.firefox', name: 'Firefox', path: '/Applications/Firefox.app' },
  { id: 'com.tencent.qq', name: 'QQ', path: '/Applications/QQ.app' },
  { id: 'com.sina.weibo', name: '微博', path: '/Applications/Weibo.app' },
  { id: 'com.baidu.BaiduNetdisk', name: '百度网盘', path: '/Applications/BaiduNetdisk.app' },
  { id: 'com.jetbrains.intellij', name: 'IntelliJ IDEA', path: '/Applications/IntelliJ IDEA.app' },
  { id: 'net.kdentes.NotePlan', name: 'WPS Office', path: '/Applications/wpsoffice.app' },
  { id: 'com.readdle.Spark', name: 'Spark Mail', path: '/Applications/Spark.app' },
  { id: 'com.apple.iWork.Pages', name: 'Pages', path: '/System/Applications/Pages.app' }
]

/** demo 态预置 2 个置顶 id：微信（建议项）+ 钉钉（验证重排，第 5 位移到最前） */
export const DEMO_PINNED_IDS = ['com.tencent.xinWeChat', 'com.alibaba.DingTalk']

/** 示例最近行取前 N 个示例应用（真实 localStorage 记录按时间排在其前）；取 9 展示满行形态 */
export const DEMO_RECENT_COUNT = 9

export interface RecentTile {
  key: string
  kind: 'plugin' | 'app'
  title: string
  /** 插件 = manifest emoji；应用 = dataURL；undefined 走字母块 */
  icon?: string
  appId?: string
  pluginId?: string
  commandId?: string
}
