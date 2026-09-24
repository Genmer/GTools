import { describe, expect, it } from 'vitest'
import {
  MAX_HITS,
  fileTypeIcon,
  fileTypeLabel,
  highlightName,
  hitFromPath,
  mdfindLineCount,
  parseMdfindLines
} from '../src/plugins/file-search/logic/parse'
import { DEMO_HITS } from '../src/plugins/file-search/logic/demo'

describe('hitFromPath 路径拆分', () => {
  it('绝对路径 → 名称/目录/小写扩展名', () => {
    expect(hitFromPath('/Users/a/Docs/Report.PDF')).toEqual({
      path: '/Users/a/Docs/Report.PDF',
      name: 'Report.PDF',
      dir: '/Users/a/Docs',
      ext: 'pdf',
      isDirectory: false
    })
  })

  it('点开头文件名整体视为名称，不产出扩展名', () => {
    const h = hitFromPath('/repo/.gitignore')
    expect(h.name).toBe('.gitignore')
    expect(h.ext).toBe('')
  })

  it('无扩展名与尾部斜杠容忍', () => {
    expect(hitFromPath('/Users/a/README').ext).toBe('')
    expect(hitFromPath('/Users/a/folder/').name).toBe('folder')
    expect(hitFromPath('/Users/a/folder/').path).toBe('/Users/a/folder')
  })

  it('根目录文件 dir 为 /', () => {
    expect(hitFromPath('/hosts')).toEqual({ path: '/hosts', name: 'hosts', dir: '/', ext: '', isDirectory: false })
  })
})

describe('parseMdfindLines stdout 解析', () => {
  it('逐行转命中，跳过空行并去重', () => {
    const out = ['/a/b/1.txt', '', '  /a/b/2.md  ', '/a/b/1.txt', '\n'].join('\n')
    const hits = parseMdfindLines(out)
    expect(hits.map((h) => h.name)).toEqual(['1.txt', '2.md'])
    expect(hits[1].dir).toBe('/a/b')
  })

  it('超过 limit 截断（默认 50）', () => {
    const many = Array.from({ length: 120 }, (_, i) => `/x/f${i}.txt`).join('\n')
    expect(parseMdfindLines(many)).toHaveLength(MAX_HITS)
    expect(parseMdfindLines(many, 3)).toHaveLength(3)
    expect(mdfindLineCount(many)).toBe(120)
    expect(mdfindLineCount('/a\n\n/b\n')).toBe(2)
  })
})

describe('类型徽标', () => {
  it('文件夹优先于扩展名推断', () => {
    expect(fileTypeLabel({ ext: '', isDirectory: true })).toBe('文件夹')
    expect(fileTypeLabel({ ext: 'pdf', isDirectory: true })).toBe('文件夹')
    expect(fileTypeIcon({ ext: '', isDirectory: true })).toBe('📁')
  })

  it('扩展名映射与未知回退', () => {
    expect(fileTypeLabel({ ext: 'pdf', isDirectory: false })).toBe('PDF')
    expect(fileTypeLabel({ ext: 'MD', isDirectory: false })).toBe('Markdown')
    expect(fileTypeLabel({ ext: 'mp4', isDirectory: false })).toBe('视频')
    expect(fileTypeLabel({ ext: 'dmg', isDirectory: false })).toBe('镜像')
    expect(fileTypeLabel({ ext: 'zzz', isDirectory: false })).toBe('文件')
  })
})

describe('highlightName 高亮区间', () => {
  it('大小写不敏感命中第一个普通词', () => {
    expect(highlightName('设计规范-v3.pdf', '设计')).toEqual({ before: '', match: '设计', after: '规范-v3.pdf' })
    expect(highlightName('Report.PDF', 'report')?.match).toBe('Report')
  })

  it('Spotlight 运算符不参与匹配，多词取先命中者', () => {
    expect(highlightName('a-b.txt', 'kind:txt')).toBeNull()
    expect(highlightName('photo-2026.jpg', 'zzz photo')).toEqual({ before: '', match: 'photo', after: '-2026.jpg' })
  })
})

describe('demo 数据稳定性', () => {
  it('固定 5 条、字段完整、含 1 个文件夹', () => {
    expect(DEMO_HITS).toHaveLength(5)
    expect(DEMO_HITS.filter((h) => h.isDirectory)).toHaveLength(1)
    for (const h of DEMO_HITS) {
      expect(h.name.length).toBeGreaterThan(0)
      expect(h.dir.startsWith('/Users/demo/')).toBe(true)
      expect(typeof h.ext).toBe('string')
    }
  })
})
