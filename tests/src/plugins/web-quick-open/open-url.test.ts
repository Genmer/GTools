import { describe, expect, it } from 'vitest'
import {
  buildOpenUrl,
  fillSearchUrl,
  hostOf,
  looksLikeUrl,
  normalizeUserUrl
} from '../../../../src/plugins/web-quick-open/open-url'

describe('normalizeUserUrl', () => {
  it('补 https 前缀并去空白', () => {
    expect(normalizeUserUrl('  baidu.com ')).toBe('https://baidu.com')
    expect(normalizeUserUrl('http://baidu.com')).toBe('http://baidu.com')
    expect(normalizeUserUrl('https://github.com/x?y=1')).toBe('https://github.com/x?y=1')
  })

  it('路径中的 {} 占位符必须原样保留（URL 编码器会把它变成 %7B%7D）', () => {
    expect(normalizeUserUrl('https://so.iqiyi.com/so/q_{}')).toBe('https://so.iqiyi.com/so/q_{}')
    expect(normalizeUserUrl('so.iqiyi.com/so/q_{}')).toBe('https://so.iqiyi.com/so/q_{}')
  })

  it('非法输入返回 null', () => {
    expect(normalizeUserUrl('')).toBeNull()
    expect(normalizeUserUrl('   ')).toBeNull()
    expect(normalizeUserUrl('不是网址')).toBeNull()
    expect(normalizeUserUrl('baidu..com')).toBeNull()
    expect(normalizeUserUrl('https://')).toBeNull()
    expect(normalizeUserUrl('ftp://baidu.com')).toBeNull()
    expect(normalizeUserUrl('my site.com')).toBeNull()
  })

  it('localhost 主机放行（本机服务场景）', () => {
    expect(normalizeUserUrl('localhost:3000')).toBe('https://localhost:3000')
  })
})

describe('looksLikeUrl', () => {
  it('域名与完整 URL 形态识别', () => {
    expect(looksLikeUrl('github.com')).toBe(true)
    expect(looksLikeUrl('https://github.com/electron/electron')).toBe(true)
    expect(looksLikeUrl('192.168.1.10:8080')).toBe(true)
    expect(looksLikeUrl('g.cn')).toBe(true)
  })

  it('非网址输入不误判', () => {
    expect(looksLikeUrl('bilibili')).toBe(false)
    expect(looksLikeUrl('bd 天气')).toBe(false)
    expect(looksLikeUrl('3.1.4')).toBe(false)
    expect(looksLikeUrl('e.g')).toBe(false)
    expect(looksLikeUrl('')).toBe(false)
    expect(looksLikeUrl('淘宝')).toBe(false)
  })
})

describe('hostOf', () => {
  it('取 hostname，非法输入返回空串', () => {
    expect(hostOf('https://www.baidu.com/s?wd=x')).toBe('www.baidu.com')
    expect(hostOf('not a url')).toBe('')
  })
})

describe('fillSearchUrl', () => {
  it('替换首个 {} 并对关键词 URL 编码', () => {
    expect(fillSearchUrl('https://www.baidu.com/s?wd={}', '三体')).toBe(
      'https://www.baidu.com/s?wd=%E4%B8%89%E4%BD%93'
    )
    expect(fillSearchUrl('https://so.iqiyi.com/so/q_{}', 'a b')).toBe('https://so.iqiyi.com/so/q_a%20b')
  })

  it('兼容 %s 占位符；只替换首个', () => {
    expect(fillSearchUrl('https://x.com/s?q=%s&ref=%s', 'vue')).toBe('https://x.com/s?q=vue&ref=%s')
  })

  it('无占位符或空关键词返回 null', () => {
    expect(fillSearchUrl('https://x.com/s', 'vue')).toBeNull()
    expect(fillSearchUrl('https://x.com/s?q={}', '  ')).toBeNull()
  })
})

describe('buildOpenUrl', () => {
  const site = { url: 'https://www.zhihu.com', searchUrl: 'https://www.zhihu.com/search?q={}' }

  it('有搜索模板且有词 → 搜索结果页', () => {
    expect(buildOpenUrl(site, 'electron')).toBe('https://www.zhihu.com/search?q=electron')
    expect(buildOpenUrl(site, ' electron ')).toBe('https://www.zhihu.com/search?q=electron')
  })

  it('无词或无模板 → 主页', () => {
    expect(buildOpenUrl(site)).toBe('https://www.zhihu.com')
    expect(buildOpenUrl(site, '')).toBe('https://www.zhihu.com')
    expect(buildOpenUrl({ url: 'https://www.v2ex.com' }, 'vue')).toBe('https://www.v2ex.com')
  })

  it('模板损坏时回退主页，不产出坏 URL', () => {
    expect(buildOpenUrl({ url: 'https://a.com', searchUrl: 'https://a.com/s' }, 'x')).toBe('https://a.com')
  })
})
