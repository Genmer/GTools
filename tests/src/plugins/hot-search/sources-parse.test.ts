import { describe, expect, it } from 'vitest'
import { findSource, HOT_SOURCES } from '../../../../src/plugins/hot-search/logic/sources'

// fixture 均取自 2026-09-24 六平台公开接口的真实响应（截取 2-3 条）
const WEIBO_BODY = JSON.stringify({
  ok: 1,
  data: {
    realtime: [
      { word: '小米电视', word_scheme: '小米电视', num: 478744, label_name: '' },
      { word: '花少2搬箱子楼梯实际长这样', word_scheme: '#花少2搬箱子楼梯实际长这样#', num: 336819, label_name: '新' },
      { word: '中国天眼实现一批原创突破', word_scheme: '#中国天眼实现一批原创突破#', num: 301750, label_name: '沸' }
    ]
  }
})

const BAIDU_BODY = JSON.stringify({
  success: true,
  data: {
    cards: [
      {
        component: 'hotList',
        content: [
          {
            word: '习近平离京对美国进行国事访问',
            hotScore: '7808718',
            rawUrl: 'https://www.baidu.com/s?wd=%E4%B9%A0%E8%BF%91%E5%B9%B3',
            hotTag: '0',
            index: 0
          },
          { word: '打一针管数月的降压疫苗要来了', hotScore: '7714539', hotTag: '3', index: 1 },
          { word: '', hotScore: '1', index: 2 }
        ]
      }
    ]
  }
})

const ZHIHU_BODY = JSON.stringify({
  data: [
    {
      card_id: 'Q_2085881529876718129',
      target: { id: 2085881529876718000, title: '华人藏家花费 2400 万元追回疑似圆明园龙首，此事具有哪些意义？', url: 'https://api.zhihu.com/questions/2085881529876718129' },
      detail_text: '470 万热度'
    },
    {
      card_id: '',
      target: { id: 123, title: '无 card_id 的兜底条目', url: 'https://api.zhihu.com/questions/1234567890123' },
      detail_text: ''
    }
  ]
})

const BILIBILI_BODY = JSON.stringify({
  code: 0,
  message: 'OK',
  data: {
    trending: {
      title: 'bilibili热搜',
      list: [
        { keyword: '张展硕200米自由泳破纪录夺冠', show_name: '张展硕200米自由泳破纪录夺冠', heat_score: 4246143 },
        { keyword: '宋雨琦入驻B站', show_name: '', heat_score: 3937002 },
        { keyword: '', show_name: '', heat_score: 1 }
      ]
    }
  }
})

const DOUYIN_BODY = JSON.stringify({
  status_code: 0,
  data: {
    word_list: [
      { word: '中美元首半年内实现互访', hot_value: 12084681, position: 2 },
      { word: '第五届数贸会亮点抢先看', hot_value: 11555704, position: 3 }
    ]
  }
})

const TOUTIAO_BODY = JSON.stringify({
  status: 'success',
  data: [
    { ClusterId: 7687889715441389119, Title: '中美元首半年内实现互访', HotValue: '19484538', Url: 'https://www.toutiao.com/trending/7687889715441389119/' },
    { ClusterId: 7688701472178966054, Title: '小米18Pro价格', HotValue: '17630339', Url: '' }
  ]
})

describe('六平台解析器（真实响应结构）', () => {
  it('六个源定义齐全且 id 唯一', () => {
    expect(HOT_SOURCES.map((s) => s.id)).toEqual(['weibo', 'baidu', 'zhihu', 'bilibili', 'douyin', 'toutiao'])
    expect(new Set(HOT_SOURCES.map((s) => s.id)).size).toBe(HOT_SOURCES.length)
    for (const s of HOT_SOURCES) {
      expect(s.url.startsWith('https://')).toBe(true)
      expect(typeof s.parse).toBe('function')
    }
  })

  it('微博：word/热度/标签，搜索链接用 word_scheme 包 #', () => {
    const items = findSource('weibo')!.parse(WEIBO_BODY)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ key: '小米电视', title: '小米电视', heat: 478744 })
    expect(items[0].tag).toBeUndefined()
    expect(decodeURIComponent(items[0].url)).toBe('https://s.weibo.com/weibo?q=#小米电视#')
    expect(items[1].tag).toBe('新')
    // word_scheme 自带 # 时不重复包裹
    expect(decodeURIComponent(items[1].url)).toBe('https://s.weibo.com/weibo?q=#花少2搬箱子楼梯实际长这样#')
  })

  it('百度：hotScore 字符串转数值，优先用 rawUrl，缺省回退搜索页', () => {
    const items = findSource('baidu')!.parse(BAIDU_BODY)
    expect(items).toHaveLength(2) // 空 word 条目被丢弃
    expect(items[0]).toMatchObject({ title: '习近平离京对美国进行国事访问', heat: 7808718 })
    expect(items[0].url).toBe('https://www.baidu.com/s?wd=%E4%B9%A0%E8%BF%91%E5%B9%B3')
    expect(decodeURIComponent(items[1].url)).toBe('https://www.baidu.com/s?wd=打一针管数月的降压疫苗要来了')
  })

  it('知乎：问题号取字符串 card_id（target.id 大整数丢精度），热度解析 万 单位', () => {
    const items = findSource('zhihu')!.parse(ZHIHU_BODY)
    expect(items).toHaveLength(2)
    expect(items[0].url).toBe('https://www.zhihu.com/question/2085881529876718129')
    expect(items[0].heat).toBe(4_700_000)
    // card_id 缺失时回退 target.url 并换成浏览器域名
    expect(items[1].url).toBe('https://www.zhihu.com/question/1234567890123')
    expect(items[1].heat).toBeUndefined()
  })

  it('B站：show_name 缺省回退 keyword，code 非 0 报错', () => {
    const items = findSource('bilibili')!.parse(BILIBILI_BODY)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ title: '张展硕200米自由泳破纪录夺冠', heat: 4246143 })
    expect(items[1].title).toBe('宋雨琦入驻B站')
    expect(decodeURIComponent(items[1].url)).toBe('https://search.bilibili.com/all?keyword=宋雨琦入驻B站')
    const bad = JSON.parse(BILIBILI_BODY) as { code?: number }
    bad.code = -509
    expect(() => findSource('bilibili')!.parse(JSON.stringify(bad))).toThrowError(/B站：接口返回 code=-509/)
  })

  it('抖音与头条：热度数值化，头条 Url 缺省回退搜索页', () => {
    const douyin = findSource('douyin')!.parse(DOUYIN_BODY)
    expect(douyin).toHaveLength(2)
    expect(douyin[0]).toMatchObject({ title: '中美元首半年内实现互访', heat: 12084681 })
    expect(decodeURIComponent(douyin[0].url)).toBe('https://www.douyin.com/search/中美元首半年内实现互访')

    const toutiao = findSource('toutiao')!.parse(TOUTIAO_BODY)
    expect(toutiao).toHaveLength(2)
    expect(toutiao[0]).toMatchObject({ heat: 19484538 })
    expect(toutiao[0].url).toBe('https://www.toutiao.com/trending/7687889715441389119/')
    expect(toutiao[1].url).toContain('https://so.toutiao.com/search?')
    expect(decodeURIComponent(toutiao[1].url)).toContain('小米18Pro价格')
  })

  it('坏数据一律抛带平台名的可读错误，不返回半截列表', () => {
    for (const s of HOT_SOURCES) {
      expect(() => s.parse('not json')).toThrowError(new RegExp(`${s.name}：`))
      expect(() => s.parse('{}')).toThrowError(/榜单为空|返回数据结构异常/)
      expect(() => s.parse('[]')).toThrowError(/返回数据结构异常/)
    }
    expect(() => findSource('weibo')!.parse(JSON.stringify({ ok: 1, data: { realtime: [] } }))).toThrowError(/微博：榜单为空/)
    expect(() => findSource('weibo')!.parse(JSON.stringify({ ok: 1, data: { realtime: [{ num: 1 }] } }))).toThrowError(/微博：榜单为空/)
  })
})
