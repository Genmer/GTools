import { describe, expect, it } from 'vitest'
import {
  asciiFallbackName,
  contentDispositionHeader,
  contentTypeFor,
  decodeRel,
  humanSize,
  joinRel,
  normalizeRelPath,
  parentRel,
  previewKindFor,
  sanitizeFilename,
  uniqueFileName
} from '../../../../src/plugins/lan-file-share/logic/paths'

describe('normalizeRelPath / decodeRel', () => {
  it('普通相对路径原样归一', () => {
    expect(normalizeRelPath('a/b/c.txt')).toBe('a/b/c.txt')
    expect(normalizeRelPath('')).toBe('')
  })
  it('丢弃空段与当前目录段', () => {
    expect(normalizeRelPath('/a//./b/')).toBe('a/b')
    expect(normalizeRelPath('a/./b')).toBe('a/b')
  })
  it('.. 回退一级', () => {
    expect(normalizeRelPath('a/b/../c')).toBe('a/c')
    expect(normalizeRelPath('a/b/../..')).toBe('')
  })
  it('.. 越出根返回 null（目录穿越拦截）', () => {
    expect(normalizeRelPath('../etc/passwd')).toBeNull()
    expect(normalizeRelPath('a/../../b')).toBeNull()
  })
  it('含反斜杠或 NUL 拒绝（防 win32 分隔符歧义）', () => {
    expect(normalizeRelPath('a\\b')).toBeNull()
    expect(normalizeRelPath('a\0b')).toBeNull()
  })
  it('decodeRel 解码百分号编码，非法输入返回 null', () => {
    expect(decodeRel('%E6%96%87%E4%BB%B6.txt')).toBe('文件.txt')
    expect(decodeRel('a%2Fb')).toBe('a/b')
    expect(decodeRel('bad%')).toBeNull()
  })
})

describe('joinRel / parentRel', () => {
  it('根下拼接与父路径', () => {
    expect(joinRel('', 'a.txt')).toBe('a.txt')
    expect(joinRel('sub', 'a.txt')).toBe('sub/a.txt')
    expect(parentRel('sub/deep/a.txt')).toBe('sub/deep')
    expect(parentRel('a.txt')).toBe('')
    expect(parentRel('')).toBeNull()
  })
})

describe('sanitizeFilename', () => {
  it('取 basename 并去非法字符', () => {
    expect(sanitizeFilename('C:\\Users\\a\\照片.jpg')).toBe('照片.jpg')
    expect(sanitizeFilename('/etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('a<b>c:d*e?f"g|h')).toBe('abcdefgh')
  })
  it('去首尾空白与点、折叠空白、控制字符剔除', () => {
    expect(sanitizeFilename('  name.txt.. ')).toBe('name.txt')
    expect(sanitizeFilename('a  b.txt')).toBe('a b.txt')
    expect(sanitizeFilename('a\tb\x01c.txt')).toBe('abc.txt') // 控制字符（含 \t）直接剔除
  })
  it('空名兜底 file，超长截断', () => {
    expect(sanitizeFilename('???')).toBe('file')
    expect(sanitizeFilename('.')).toBe('file')
    expect(sanitizeFilename('x'.repeat(300)).length).toBe(200)
  })
})

describe('uniqueFileName', () => {
  it('不重名直接用原名', () => {
    expect(uniqueFileName(['a.txt'], 'b.txt')).toBe('b.txt')
  })
  it('重名追加 (n) 序号，扩展名保留', () => {
    expect(uniqueFileName(['a.txt'], 'a.txt')).toBe('a (1).txt')
    expect(uniqueFileName(['a.txt', 'a (1).txt'], 'a.txt')).toBe('a (2).txt')
  })
  it('隐藏文件（点开头无扩展名）序号缀在末尾', () => {
    expect(uniqueFileName(['.gitignore'], '.gitignore')).toBe('.gitignore (1)')
  })
  it('大小写不敏感比较（win32 同名不同大小写也规避）', () => {
    expect(uniqueFileName(['A.TXT'], 'a.txt')).toBe('a (1).txt')
  })
})

describe('contentTypeFor / previewKindFor / humanSize', () => {
  it('扩展名映射（大小写无关）', () => {
    expect(contentTypeFor('a.PNG')).toBe('image/png')
    expect(contentTypeFor('b.json')).toBe('application/json; charset=utf-8')
    expect(contentTypeFor('c.unknownext')).toBe('application/octet-stream')
    expect(contentTypeFor('noext')).toBe('application/octet-stream')
  })
  it('预览分类', () => {
    expect(previewKindFor('a.jpg')).toBe('image')
    expect(previewKindFor('a.mp4')).toBe('video')
    expect(previewKindFor('a.mp3')).toBe('audio')
    expect(previewKindFor('a.pdf')).toBe('pdf')
    expect(previewKindFor('a.md')).toBe('text')
    expect(previewKindFor('a.zip')).toBeNull()
  })
  it('体积可读化', () => {
    expect(humanSize(0)).toBe('0 B')
    expect(humanSize(1023)).toBe('1023 B')
    expect(humanSize(1024)).toBe('1.0 KB')
    expect(humanSize(1024 * 1024)).toBe('1.0 MB')
  })
})

describe('Content-Disposition', () => {
  it('ASCII 名直接做兜底', () => {
    expect(contentDispositionHeader('report.pdf', 'attachment')).toBe(
      'attachment; filename="report.pdf"; filename*=UTF-8\'\'report.pdf'
    )
  })
  it('中文名 RFC 5987 编码 + ASCII 兜底', () => {
    const h = contentDispositionHeader('年度总结.docx', 'inline')
    expect(h).toContain(`inline; filename="download"`)
    expect(h).toContain(`filename*=UTF-8''${encodeURIComponent('年度总结.docx')}`)
    expect(asciiFallbackName('中文')).toBe('download')
  })
  it('兜底名中的引号与反斜杠转义', () => {
    expect(asciiFallbackName('a"b\\c.txt')).toBe('a_b_c.txt')
  })
})
