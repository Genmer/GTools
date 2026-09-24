import { describe, expect, it } from 'vitest'
import {
  buildPreview,
  makeFileItems,
  planExecution,
  type FileItem,
  type RenameRule
} from '../../../../src/plugins/batch-rename/logic/rename'

const D = '/work/photos'

function itemsOf(names: string[], dir = D): FileItem[] {
  return makeFileItems(names.map((n) => `${dir}/${n}`))
}

function existingOf(names: string[], dir = D): Map<string, Set<string>> {
  return new Map([[dir.toLowerCase(), new Set(names.map((n) => n.toLowerCase()))]])
}

const seqRule: RenameRule = { type: 'sequence', start: 1, step: 1, digits: 2, position: 'prefix' }
const caseRule: RenameRule = { type: 'case', mode: 'upper' }
const delAll: RenameRule = { type: 'delete', at: 'start', count: 999 }
const slashRule: RenameRule = { type: 'insert', text: '/', at: 'end' }
const dotsRule: RenameRule = { type: 'insert', text: '..', at: 'end' }

describe('预览基础', () => {
  it('常规预览：计数正确，未变化行不执行', () => {
    const pv = buildPreview(itemsOf(['a.txt', 'b.txt']), [seqRule], new Map(), 'darwin')
    expect(pv.ok).toBe(true)
    expect(pv.rows.map((r) => r.newName)).toEqual(['01a.txt', '02b.txt'])
    expect(pv.changedCount).toBe(2)
    expect(pv.conflictCount).toBe(0)
    expect(planExecution(pv.rows).map((o) => o.to)).toEqual(['/work/photos/01a.txt', '/work/photos/02b.txt'])
  })

  it('无规则 = 全部无变化、不产生执行项', () => {
    const pv = buildPreview(itemsOf(['a.txt']), [], new Map(), 'darwin')
    expect(pv.changedCount).toBe(0)
    expect(planExecution(pv.rows)).toEqual([])
  })

  it('规则编译失败：ok=false + 可读信息，行退化为原名对照', () => {
    const bad: RenameRule = { type: 'replace', find: '(', replaceWith: '', useRegex: true, caseSensitive: true, scope: 'name' }
    const pv = buildPreview(itemsOf(['a.txt']), [bad], new Map(), 'darwin')
    expect(pv.ok).toBe(false)
    expect(pv.ok === false && pv.message).toContain('正则无效')
    expect(pv.rows[0]?.newName).toBe('a.txt')
    expect(planExecution(pv.rows)).toEqual([])
  })

  it('不同目录同名文件互不冲突', () => {
    const items = [...itemsOf(['a.txt'], '/x'), ...itemsOf(['a.txt'], '/y')]
    const pv = buildPreview(items, [seqRule], new Map(), 'darwin')
    expect(pv.conflictCount).toBe(0)
  })
})

describe('冲突检测', () => {
  it('批内目标重名（忽略大小写）全部标红', () => {
    const dup: RenameRule = {
      type: 'replace',
      find: '^.*$',
      replaceWith: 'dup',
      useRegex: true,
      caseSensitive: true,
      scope: 'name'
    }
    const items = itemsOf(['a.txt', 'B.txt'])
    const pv = buildPreview(items, [dup], new Map(), 'darwin')
    expect(pv.rows.map((r) => r.newName)).toEqual(['dup.txt', 'dup.txt'])
    const conflicts = pv.rows.filter((r) => r.conflict === '重名')
    expect(conflicts).toHaveLength(2)
    expect(planExecution(pv.rows)).toEqual([])
  })

  it('目标名撞盘上现存文件（大小写不敏感）→ 与现存文件冲突', () => {
    const toA: RenameRule = { type: 'replace', find: 'b', replaceWith: 'a', useRegex: false, caseSensitive: true, scope: 'name' }
    const pv = buildPreview(itemsOf(['b.txt']), [toA], existingOf(['A.txt']), 'darwin')
    expect(pv.rows[0]?.newName).toBe('a.txt')
    expect(pv.rows[0]?.conflict).toBe('与现存文件冲突')
    expect(pv.conflictCount).toBe(1)
  })

  it('纯大小写调整不算冲突（同一文件的改名；大小写规则只作用主名）', () => {
    const pv = buildPreview(itemsOf(['a.txt']), [caseRule], existingOf(['a.txt']), 'darwin')
    expect(pv.rows[0]?.newName).toBe('A.txt')
    expect(pv.rows[0]?.conflict).toBeNull()
    expect(pv.rows[0]?.changed).toBe(true)
  })

  it('腾位链放行：目标名是批内将被改走的文件', () => {
    // a.txt→b.txt（先经 b→c 腾位），b.txt→c.txt
    const rules: RenameRule[] = [
      { type: 'replace', find: 'b', replaceWith: 'c', useRegex: false, caseSensitive: true, scope: 'name' },
      { type: 'replace', find: 'a', replaceWith: 'b', useRegex: false, caseSensitive: true, scope: 'name' }
    ]
    const items = itemsOf(['a.txt', 'b.txt'])
    const pv = buildPreview(items, rules, existingOf(['a.txt', 'b.txt']), 'darwin')
    expect(pv.rows[0]?.newName).toBe('b.txt')
    expect(pv.rows[0]?.conflict).toBeNull()
    expect(pv.conflictCount).toBe(0)
    expect(planExecution(pv.rows).map((o) => o.from)).toEqual(['/work/photos/a.txt', '/work/photos/b.txt'])
  })

  it('腾位者自身无改动时仍判冲突（占位者不走）', () => {
    const items = [...itemsOf(['a.txt']), ...itemsOf(['b.txt'], '/other')]
    const rules: RenameRule[] = [
      { type: 'replace', find: 'a', replaceWith: 'b', useRegex: false, caseSensitive: true, scope: 'name' }
    ]
    const pv = buildPreview(items, rules, existingOf(['a.txt', 'b.txt']), 'darwin')
    expect(pv.rows[0]?.conflict).toBe('与现存文件冲突')
  })
})

describe('目标名校验（平台分支）', () => {
  it('空名 / .. / 斜杠在两平台都非法', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      const empty = buildPreview(itemsOf(['noext']), [delAll], new Map(), platform)
      expect(empty.rows[0]?.invalid).toBe('文件名为空')
      const dots = buildPreview(itemsOf(['noext']), [delAll, dotsRule], new Map(), platform)
      expect(dots.rows[0]?.newName).toBe('..')
      expect(dots.rows[0]?.invalid).toBe('不能为 . 或 ..')
      const slash = buildPreview(itemsOf(['a.txt']), [slashRule], new Map(), platform)
      expect(slash.rows[0]?.invalid).toBe('不能包含 /')
    }
  })

  it('win32 专属：非法字符 / 保留名 / 结尾点空格', () => {
    const char: RenameRule = { type: 'insert', text: '<', at: 'end' }
    expect(buildPreview(itemsOf(['a.txt']), [char], new Map(), 'win32').rows[0]?.invalid).toContain('Windows 不允许')
    // darwin 上同样输入合法
    expect(buildPreview(itemsOf(['a.txt']), [char], new Map(), 'darwin').rows[0]?.invalid).toBeNull()

    const toCon: RenameRule = { type: 'replace', find: 'a', replaceWith: 'CON', useRegex: false, caseSensitive: true, scope: 'name' }
    expect(buildPreview(itemsOf(['a.txt']), [toCon], new Map(), 'win32').rows[0]?.invalid).toContain('保留设备名')

    const trailDot: RenameRule = { type: 'ext', value: 'txt.' }
    expect(buildPreview(itemsOf(['a.txt']), [trailDot], new Map(), 'win32').rows[0]?.invalid).toContain('点或空格结尾')
  })

  it('darwin 下冒号拦下，win32 不额外报冒号（已被字符规则覆盖）', () => {
    const colon: RenameRule = { type: 'insert', text: ':', at: 'end' }
    expect(buildPreview(itemsOf(['a.txt']), [colon], new Map(), 'darwin').rows[0]?.invalid).toContain(':')
    expect(buildPreview(itemsOf(['a.txt']), [colon], new Map(), 'win32').rows[0]?.invalid).toContain('Windows 不允许')
  })

  it('非法行不进执行清单，但可读原因保留在行内', () => {
    const pv = buildPreview(itemsOf(['noext1', 'noext2']), [delAll], new Map(), 'darwin')
    const ops = planExecution(pv.rows)
    expect(ops).toEqual([])
    expect(pv.invalidCount).toBe(2)
  })
})
