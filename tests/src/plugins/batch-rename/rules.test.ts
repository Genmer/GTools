import { describe, expect, it } from 'vitest'
import {
  applyChain,
  baseNameOf,
  compileRules,
  dirNameOf,
  draftToRule,
  joinBaseExt,
  joinPath,
  makeDraft,
  makeFileItems,
  normalizeExt,
  normalizePlatform,
  padNumber,
  splitFileName,
  type CompiledRule,
  type RenameRule
} from '../../../../src/plugins/batch-rename/logic/rename'

function chainOf(rules: readonly RenameRule[]): CompiledRule[] {
  const r = compileRules(rules)
  if (!r.ok) throw new Error(r.message)
  return r.chain
}

function applyOne(name: string, rule: RenameRule, index = 0): string {
  return applyChain(name, chainOf([rule]), index)
}

describe('路径与文件名拆合', () => {
  it('baseNameOf/dirNameOf 兼容 / 与 \\', () => {
    expect(baseNameOf('/a/b/c.txt')).toBe('c.txt')
    expect(dirNameOf('/a/b/c.txt')).toBe('/a/b')
    expect(baseNameOf('C:\\Users\\x\\f.jpg')).toBe('f.jpg')
    expect(dirNameOf('C:\\Users\\x\\f.jpg')).toBe('C:\\Users\\x')
    expect(baseNameOf('plain.md')).toBe('plain.md')
    expect(dirNameOf('plain.md')).toBe('')
  })

  it('joinPath 按目录风格选分隔符，根目录不重复加分隔符', () => {
    expect(joinPath('/a/b', 'c.txt')).toBe('/a/b/c.txt')
    expect(joinPath('C:\\x', 'c.txt')).toBe('C:\\x\\c.txt')
    expect(joinPath('C:\\', 'c.txt')).toBe('C:\\c.txt')
    expect(joinPath('', 'c.txt')).toBe('c.txt')
  })

  it('splitFileName：点文件整体视作主名，多段扩展名取最后一段', () => {
    expect(splitFileName('a.txt')).toEqual({ base: 'a', ext: '.txt' })
    expect(splitFileName('archive.tar.gz')).toEqual({ base: 'archive.tar', ext: '.gz' })
    expect(splitFileName('.gitignore')).toEqual({ base: '.gitignore', ext: '' })
    expect(splitFileName('noext')).toEqual({ base: 'noext', ext: '' })
    expect(joinBaseExt('a', '.txt')).toBe('a.txt')
    expect(joinBaseExt('a', 'txt')).toBe('a.txt')
    expect(joinBaseExt('a', '')).toBe('a')
  })

  it('makeFileItems 去重（忽略大小写）且保持顺序', () => {
    const a = makeFileItems(['/d/A.txt', '/d/b.txt'])
    const b = makeFileItems(['/d/a.TXT', '/d/c.txt'], a)
    expect(b.map((f) => f.name)).toEqual(['c.txt'])
    expect(a.map((f) => f.dir)).toEqual(['/d', '/d'])
  })

  it('normalizePlatform', () => {
    expect(normalizePlatform('darwin')).toBe('darwin')
    expect(normalizePlatform('win32')).toBe('win32')
    expect(normalizePlatform('linux')).toBe('linux')
    expect(normalizePlatform('cygwin')).toBe('linux')
  })
})

describe('查找替换', () => {
  it('普通替换全部命中且默认区分大小写', () => {
    const rule: RenameRule = { type: 'replace', find: 'a', replaceWith: 'x', useRegex: false, caseSensitive: true, scope: 'name' }
    expect(applyOne('banana.txt', rule)).toBe('bxnxnx.txt')
    expect(applyOne('Apple.txt', rule)).toBe('Apple.txt')
  })

  it('不区分大小写替换', () => {
    const rule: RenameRule = { type: 'replace', find: 'IMG', replaceWith: '图', useRegex: false, caseSensitive: false, scope: 'name' }
    expect(applyOne('img001.IMG', rule)).toBe('图001.IMG')
  })

  it('正则替换支持分组引用，g 标志全量替换', () => {
    const rule: RenameRule = { type: 'replace', find: '(\\d+)', replaceWith: 'N$1', useRegex: true, caseSensitive: true, scope: 'name' }
    expect(applyOne('v1.2.txt', rule)).toBe('vN1.N2.txt')
  })

  it('scope=name 只作用主名，scope=full 连扩展名一起换（替换文本原样写入）', () => {
    const name: RenameRule = { type: 'replace', find: 'pdf', replaceWith: 'doc', useRegex: false, caseSensitive: false, scope: 'name' }
    const full: RenameRule = { ...name, scope: 'full' }
    expect(applyOne('report.PDF', name)).toBe('report.PDF')
    expect(applyOne('report.PDF', full)).toBe('report.doc')
  })

  it('非法正则与空查找在编译期报错', () => {
    expect(compileRules([{ type: 'replace', find: '', replaceWith: '', useRegex: false, caseSensitive: true, scope: 'name' }])).toEqual({
      ok: false,
      message: '查找替换：查找内容为空'
    })
    const bad = compileRules([{ type: 'replace', find: '([', replaceWith: '', useRegex: true, caseSensitive: true, scope: 'name' }])
    expect(bad.ok).toBe(false)
    expect(bad.ok === false && bad.message).toContain('正则无效')
  })
})

describe('插入 / 删除字符', () => {
  it('插入：开头 / 末尾 / 指定位置 / 负数从末尾数', () => {
    const mk = (at: number | 'start' | 'end'): RenameRule => ({ type: 'insert', text: 'X', at })
    expect(applyOne('ab.txt', mk('start'))).toBe('Xab.txt')
    expect(applyOne('ab.txt', mk('end'))).toBe('abX.txt')
    expect(applyOne('ab.txt', mk(1))).toBe('aXb.txt')
    expect(applyOne('ab.txt', mk(-1))).toBe('aXb.txt')
    expect(applyOne('ab.txt', mk(99))).toBe('abX.txt')
  })

  it('删除：位置 + 个数，越界夹取', () => {
    const mk = (at: number | 'start' | 'end', count: number): RenameRule => ({ type: 'delete', at, count })
    expect(applyOne('abcd.txt', mk('start', 2))).toBe('cd.txt')
    expect(applyOne('abcd.txt', mk(1, 2))).toBe('ad.txt')
    expect(applyOne('abcd.txt', mk(-2, 2))).toBe('ab.txt')
    expect(applyOne('abcd.txt', mk('end', 1))).toBe('abcd.txt')
    expect(applyOne('abcd.txt', mk('start', 99))).toBe('.txt')
  })
})

describe('序号', () => {
  it('起始 / 步长 / 位数补零，按列表序号计数', () => {
    const rule: RenameRule = { type: 'sequence', start: 5, step: 10, digits: 4, position: 'prefix' }
    expect(applyOne('a.txt', rule, 0)).toBe('0005a.txt')
    expect(applyOne('a.txt', rule, 1)).toBe('0015a.txt')
    expect(applyOne('a.txt', rule, 2)).toBe('0025a.txt')
  })

  it('前缀 / 后缀 / 指定位置', () => {
    const pre: RenameRule = { type: 'sequence', start: 1, step: 1, digits: 2, position: 'prefix' }
    const suf: RenameRule = { ...pre, position: 'suffix' }
    const at: RenameRule = { ...pre, position: 2 }
    expect(applyOne('photo.jpg', pre)).toBe('01photo.jpg')
    expect(applyOne('photo.jpg', suf)).toBe('photo01.jpg')
    expect(applyOne('photo.jpg', at)).toBe('ph01oto.jpg')
  })

  it('负数步长与 padNumber', () => {
    expect(padNumber(7, 3)).toBe('007')
    expect(padNumber(1234, 2)).toBe('1234')
    expect(padNumber(-5, 3)).toBe('-005')
    const rule: RenameRule = { type: 'sequence', start: 3, step: -2, digits: 2, position: 'suffix' }
    expect(applyOne('a.txt', rule, 1)).toBe('a01.txt')
  })

  it('非法数值字段在编译期收敛为默认，位数夹取到 10', () => {
    const nan: RenameRule = { type: 'sequence', start: Number.NaN, step: Number.NaN, digits: Number.NaN, position: 'prefix' }
    expect(applyOne('a.txt', nan, 0)).toBe('1a.txt')
    const wide: RenameRule = { type: 'sequence', start: 1, step: 1, digits: 99, position: 'prefix' }
    expect(applyOne('a.txt', wide, 0)).toBe('0000000001a.txt')
  })
})

describe('大小写与扩展名', () => {
  it('大小写三态，中文不受影响', () => {
    const mk = (mode: 'upper' | 'lower' | 'title'): RenameRule => ({ type: 'case', mode })
    expect(applyOne('abc.TXT', mk('upper'))).toBe('ABC.TXT')
    expect(applyOne('Abc.TXT', mk('lower'))).toBe('abc.TXT')
    expect(applyOne('hello WORLD-foo.txt', mk('title'))).toBe('Hello World-Foo.txt')
    expect(applyOne('文件 name.txt', mk('title'))).toBe('文件 Name.txt')
  })

  it('扩展名统一与移除，输入归一', () => {
    const mk = (value: string): RenameRule => ({ type: 'ext', value })
    expect(applyOne('photo.png', mk('jpg'))).toBe('photo.jpg')
    expect(applyOne('photo.png', mk('.JPG'))).toBe('photo.JPG')
    expect(applyOne('photo.png', mk('*.jpg'))).toBe('photo.jpg')
    expect(applyOne('photo.png', mk(''))).toBe('photo')
    expect(applyOne('photo', mk('jpg'))).toBe('photo.jpg')
    expect(normalizeExt('  *.JPG ')).toBe('.JPG')
  })
})

describe('规则链组合与 UI 草稿', () => {
  it('规则按顺序依次应用（替换→序号→大小写→扩展名）', () => {
    const chain = chainOf([
      { type: 'replace', find: 'img', replaceWith: '图', useRegex: false, caseSensitive: false, scope: 'name' },
      { type: 'sequence', start: 1, step: 1, digits: 3, position: 'prefix' },
      { type: 'case', mode: 'upper' },
      { type: 'ext', value: 'png' }
    ])
    expect(applyChain('img-a.jpg', chain, 0)).toBe('001图-A.png')
    expect(applyChain('img-b.jpg', chain, 2)).toBe('003图-B.png')
  })

  it('draftToRule 折叠 UI 草稿的各类型字段', () => {
    expect(draftToRule({ ...makeDraft('replace'), find: 'a', replaceWith: 'b' })).toEqual({
      type: 'replace',
      find: 'a',
      replaceWith: 'b',
      useRegex: false,
      caseSensitive: true,
      scope: 'name'
    })
    expect(draftToRule({ ...makeDraft('insert'), text: 'X', atMode: 'index', at: 2 })).toEqual({
      type: 'insert',
      text: 'X',
      at: 2
    })
    expect(draftToRule({ ...makeDraft('delete'), atMode: 'end', count: 3 })).toEqual({
      type: 'delete',
      at: 'end',
      count: 3
    })
    expect(draftToRule({ ...makeDraft('sequence'), start: 0, step: 2, digits: 2, seqMode: 'suffix' })).toEqual({
      type: 'sequence',
      start: 0,
      step: 2,
      digits: 2,
      position: 'suffix'
    })
    expect(draftToRule({ ...makeDraft('sequence'), seqMode: 'index', at: 1 })).toMatchObject({ position: 1 })
    expect(draftToRule({ ...makeDraft('case'), caseMode: 'title' })).toEqual({ type: 'case', mode: 'title' })
    expect(draftToRule({ ...makeDraft('ext'), extValue: 'jpg' })).toEqual({ type: 'ext', value: 'jpg' })
  })

  it('空规则链原样返回', () => {
    expect(applyChain('a.txt', [], 0)).toBe('a.txt')
  })
})
