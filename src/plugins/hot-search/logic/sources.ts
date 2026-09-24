import type { HotItem } from './types'

export interface HotSource {
  readonly id: string
  readonly name: string
  readonly icon: string
  readonly url: string
  readonly headers?: Readonly<Record<string, string>>
  parse(body: string): HotItem[]
}

// 各平台公开接口 2026-09-24 实测可用（本机 curl 验证）；部分接口校验 UA/Referer，统一带通用浏览器头
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

type Rec = Record<string, unknown>

function srcError(name: string, reason: string): never {
  throw new Error(`${name}：${reason}`)
}

function parseObj(name: string, body: string): Rec {
  let v: unknown
  try {
    v = JSON.parse(body)
  } catch {
    srcError(name, '返回的不是合法 JSON')
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) srcError(name, '返回数据结构异常')
  return v as Rec
}

function rec(v: unknown): Rec | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null
}

function recs(v: unknown): Rec[] {
  return Array.isArray(v) ? v.filter((x): x is Rec => rec(x) !== null) : []
}

function s(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function n(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : undefined
  if (typeof v === 'string' && v.trim() !== '') {
    const x = Number(v)
    return Number.isFinite(x) && x >= 0 ? x : undefined
  }
  return undefined
}

function finish(name: string, items: HotItem[]): HotItem[] {
  // 全平台同时结构失效更可能是被墙/被劫持，留错误信息给用户，不要渲染空榜
  if (items.length === 0) srcError(name, '榜单为空（接口结构可能已变化）')
  return items
}

function parseWeibo(body: string): HotItem[] {
  const j = parseObj('微博', body)
  const list = recs(rec(j.data)?.realtime)
  return finish(
    '微博',
    list
      .map((e): HotItem | null => {
        const word = s(e.word)
        if (word === '') return null
        const scheme = s(e.word_scheme).replace(/^#+|#+$/g, '')
        const q = encodeURIComponent(`#${scheme !== '' ? scheme : word}#`)
        const tag = s(e.label_name)
        const heat = n(e.num)
        return { key: word, title: word, url: `https://s.weibo.com/weibo?q=${q}`, ...(tag !== '' ? { tag } : {}), ...(heat !== undefined ? { heat } : {}) }
      })
      .filter((x): x is HotItem => x !== null)
  )
}

function parseBaidu(body: string): HotItem[] {
  const j = parseObj('百度', body)
  const cards = recs(rec(j.data)?.cards)
  const hotCard = cards.find((c) => s(c.component) === 'hotList') ?? cards[0]
  const list = recs(hotCard?.content)
  return finish(
    '百度',
    list
      .map((e): HotItem | null => {
        const word = s(e.word)
        if (word === '') return null
        const raw = s(e.rawUrl) || s(e.url)
        const url = raw !== '' ? raw : `https://www.baidu.com/s?wd=${encodeURIComponent(word)}`
        const heat = n(e.hotScore)
        return { key: word, title: word, url, ...(heat !== undefined ? { heat } : {}) }
      })
      .filter((x): x is HotItem => x !== null)
  )
}

function parseZhihu(body: string): HotItem[] {
  const j = parseObj('知乎', body)
  return finish(
    '知乎',
    recs(j.data)
      .map((e): HotItem | null => {
        const target = rec(e.target)
        const title = s(target?.title).trim()
        if (title === '') return null
        // target.id 超出安全整数会丢精度，问题号必须取字符串 card_id（形如 Q_123）
        const idFromCard = s(e.card_id).replace(/^[A-Za-z]+_/, '')
        let url = ''
        if (/^\d+$/.test(idFromCard)) url = `https://www.zhihu.com/question/${idFromCard}`
        else url = s(target?.url).replace('api.zhihu.com/questions', 'www.zhihu.com/question')
        if (url === '') return null
        const m = /([\d.]+)\s*万/.exec(s(e.detail_text))
        const heat = m !== null ? Math.round(parseFloat(m[1]) * 10_000) : undefined
        return { key: title, title, url, ...(heat !== undefined ? { heat } : {}) }
      })
      .filter((x): x is HotItem => x !== null)
  )
}

function parseBilibili(body: string): HotItem[] {
  const j = parseObj('B站', body)
  if (j.code !== undefined && j.code !== 0) srcError('B站', `接口返回 code=${String(j.code)}`)
  const list = recs(rec(rec(j.data)?.trending)?.list)
  return finish(
    'B站',
    list
      .map((e): HotItem | null => {
        const keyword = s(e.keyword)
        const title = s(e.show_name).trim() || keyword
        if (title === '') return null
        const heat = n(e.heat_score)
        return {
          key: keyword !== '' ? keyword : title,
          title,
          url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword !== '' ? keyword : title)}`,
          ...(heat !== undefined ? { heat } : {})
        }
      })
      .filter((x): x is HotItem => x !== null)
  )
}

function parseDouyin(body: string): HotItem[] {
  const j = parseObj('抖音', body)
  const list = recs(rec(j.data)?.word_list)
  return finish(
    '抖音',
    list
      .map((e): HotItem | null => {
        const word = s(e.word)
        if (word === '') return null
        const heat = n(e.hot_value)
        return { key: word, title: word, url: `https://www.douyin.com/search/${encodeURIComponent(word)}`, ...(heat !== undefined ? { heat } : {}) }
      })
      .filter((x): x is HotItem => x !== null)
  )
}

function parseToutiao(body: string): HotItem[] {
  const j = parseObj('头条', body)
  return finish(
    '头条',
    recs(j.data)
      .map((e): HotItem | null => {
        const title = s(e.Title).trim()
        if (title === '') return null
        const raw = s(e.Url)
        const url = raw !== '' ? raw : `https://so.toutiao.com/search?dvpf=pc&source=input&keyword=${encodeURIComponent(title)}`
        const heat = n(e.HotValue)
        return { key: title, title, url, ...(heat !== undefined ? { heat } : {}) }
      })
      .filter((x): x is HotItem => x !== null)
  )
}

const UA_HEADERS: Readonly<Record<string, string>> = { 'User-Agent': BROWSER_UA }

export const HOT_SOURCES: readonly HotSource[] = [
  {
    id: 'weibo',
    name: '微博',
    icon: '🔴',
    url: 'https://weibo.com/ajax/side/hotSearch',
    headers: { ...UA_HEADERS, Referer: 'https://weibo.com' },
    parse: parseWeibo
  },
  {
    id: 'baidu',
    name: '百度',
    icon: '🔵',
    url: 'https://top.baidu.com/api/board?platform=pc&tab=realtime',
    headers: UA_HEADERS,
    parse: parseBaidu
  },
  {
    id: 'zhihu',
    name: '知乎',
    icon: '💙',
    url: 'https://api.zhihu.com/topstory/hot-list?limit=50',
    headers: UA_HEADERS,
    parse: parseZhihu
  },
  {
    id: 'bilibili',
    name: 'B站',
    icon: '📺',
    url: 'https://api.bilibili.com/x/web-interface/search/square?limit=30',
    headers: UA_HEADERS,
    parse: parseBilibili
  },
  {
    id: 'douyin',
    name: '抖音',
    icon: '🎵',
    url: 'https://www.douyin.com/aweme/v1/web/hot/search/list/',
    headers: { ...UA_HEADERS, Referer: 'https://www.douyin.com/' },
    parse: parseDouyin
  },
  {
    id: 'toutiao',
    name: '头条',
    icon: '📰',
    url: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
    headers: UA_HEADERS,
    parse: parseToutiao
  }
]

export function findSource(id: string): HotSource | undefined {
  return HOT_SOURCES.find((s) => s.id === id)
}
