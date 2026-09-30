import type { PluginManifest } from '@sdk/manifest'
import { buildQuickSearchMatcherSource } from './match'
import { BUILTIN_SITES } from './sites'

// 全局栏「bd 天气」快搜：matcher 由内置站点别名全集生成（自定义站点别名进不了静态正则，全局覆盖不到属预期）
const allAliases = BUILTIN_SITES.flatMap((s) => s.aliases ?? [])

// 高频站点直达命令：keywords 进全局词条池（id + 中文名 + 长别名，短缩写不放防噪声）
const OPEN_COMMANDS: PluginManifest['commands'] = [
  { id: 'search', title: '网页快搜' },
  { id: 'baidu', title: '百度一下' },
  { id: 'open-baidu', title: '打开 百度', keywords: ['baidu', '百度'] },
  { id: 'open-bilibili', title: '打开 哔哩哔哩', keywords: ['bilibili', '哔哩哔哩', 'bili'] },
  { id: 'open-github', title: '打开 GitHub', keywords: ['github'] },
  { id: 'open-google', title: '打开 Google', keywords: ['google'] },
  { id: 'open-youtube', title: '打开 YouTube', keywords: ['youtube', '油管'] },
  { id: 'open-zhihu', title: '打开 知乎', keywords: ['zhihu', '知乎'] },
  { id: 'open-weibo', title: '打开 微博', keywords: ['weibo', '微博'] },
  { id: 'open-douban', title: '打开 豆瓣', keywords: ['douban', '豆瓣'] }
]

const manifest: PluginManifest = {
  id: 'web-quick-open',
  name: '网页快开',
  version: '0.1.0',
  protocolVersion: 1,
  description: '常用站点一敲即开：内置搜索/视频/开发/社交站点库，拼音全拼/首字母模糊匹配，支持自定义站点与「缩写 关键词」直达搜索',
  icon: '🔗',
  keywords: ['web-quick-open', 'web', '网页快开', 'wykk'],
  activation: 'trigger',
  // 无 backend：打开网址走宿主 shell.openExternal（跨平台由宿主消化，插件无平台分支）
  permissions: ['shell:open', 'storage', 'window:hide'],
  source: 'builtin',
  entry: './index.vue',
  commands: OPEN_COMMANDS,
  matchers: [
    {
      type: 'regex',
      match: buildQuickSearchMatcherSource(allAliases),
      label: '网页快搜',
      commandId: 'search'
    },
    {
      type: 'text',
      label: '百度一下',
      commandId: 'baidu'
    }
  ],
  // 激活后主框进入子输入态，占位归插件声明
  subInput: { placeholder: '输入网址或关键词…' }
}

export default manifest
