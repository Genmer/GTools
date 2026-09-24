// mdfind 输出解析的边界补充（tests/file-search-parse.test.ts 覆盖主路径，此处补未覆盖分支）
import { describe, expect, it } from 'vitest'
import {
  fileTypeIcon,
  fileTypeLabel,
  highlightName,
  hitFromPath,
  mdfindLineCount,
  parseMdfindLines
} from '../../../../src/plugins/file-search/logic/parse'

describe('hitFromPath 边界路径', () => {
  it('无斜杠的相对路径：dir 为空串，整个串即名称', () => {
    expect(hitFromPath('file.txt')).toEqual({ path: 'file.txt', name: 'file.txt', dir: '', ext: 'txt', isDirectory: false })
  })

  it('多级相对路径拆出中间目录', () => {
    const h = hitFromPath('relative/dir/file.md')
    expect(h.dir).toBe('relative/dir')
    expect(h.name).toBe('file.md')
    expect(h.ext).toBe('md')
  })

  it('点开头文件名（.env）与多点文件名（archive.tar.gz 只取最后一段）', () => {
    expect(hitFromPath('/a/.env').ext).toBe('')
    expect(hitFromPath('/a/.env').name).toBe('.env')
    expect(hitFromPath('/a/archive.tar.gz').ext).toBe('gz')
    expect(hitFromPath('/a/archive.tar.gz').name).toBe('archive.tar.gz')
  })

  it('仅大小写不同的路径视为不同文件', () => {
    expect(hitFromPath('/a/B.txt')).not.toEqual(hitFromPath('/a/b.txt'))
  })
})

describe('parseMdfindLines 空输出与换行风格', () => {
  it('空串与纯空白输出返回空数组', () => {
    expect(parseMdfindLines('')).toEqual([])
    expect(parseMdfindLines('\n\n  \n')).toEqual([])
  })

  it('CRLF 输出按行正确解析（\\r 不残留在路径里）', () => {
    const hits = parseMdfindLines('/a/b.md\r\n/c/d.txt\r\n')
    expect(hits.map((h) => h.path)).toEqual(['/a/b.md', '/c/d.txt'])
  })

  it('仅大小写不同的重复行不去重（Spotlight 路径大小写敏感）', () => {
    const hits = parseMdfindLines('/a/B.txt\n/a/b.txt')
    expect(hits).toHaveLength(2)
  })

  it('mdfindLineCount 空串为 0，CRLF 行各计 1', () => {
    expect(mdfindLineCount('')).toBe(0)
    expect(mdfindLineCount('\r\n\r\n')).toBe(0)
    expect(mdfindLineCount('/a\r\n/b\r\n')).toBe(2)
  })
})

describe('类型徽标补充', () => {
  it('exe 归应用，未知扩展回退文件图标', () => {
    expect(fileTypeLabel({ ext: 'exe', isDirectory: false })).toBe('应用')
    expect(fileTypeIcon({ ext: 'exe', isDirectory: false })).toBe('🚀')
    expect(fileTypeIcon({ ext: 'zzz', isDirectory: false })).toBe('📄')
  })
})

describe('highlightName 补充', () => {
  it('连续空格分隔的多词：空 token 被过滤，取先命中者', () => {
    expect(highlightName('设计规范文档', '设计   规范')).toEqual({ before: '', match: '设计', after: '规范文档' })
  })

  it('空查询与全运算符查询无高亮', () => {
    expect(highlightName('abc', '')).toBeNull()
    expect(highlightName('kind:pdf a.txt', 'kind:pdf')).toBeNull()
  })
})
