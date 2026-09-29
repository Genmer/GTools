import { describe, expect, it } from 'vitest'
import {
  buildUtoolsEntries,
  parseUtoolsCommandId,
  type UtoolsEntryScan
} from '../src/renderer/src/core/utools-entries'

const scan = (over: Partial<UtoolsEntryScan> = {}): UtoolsEntryScan => ({
  id: 'json-tool',
  manifest: {
    name: 'JSON 工具',
    description: 'JSON 格式化',
    version: '1.0.0',
    main: 'index.html',
    logo: 'logo.png',
    features: [
      { code: 'format', explain: '格式化', cmds: ['格式化 JSON', 'format-json'] },
      { code: 'compress', explain: '压缩', cmds: ['压缩'] }
    ]
  },
  ...over
})

describe('buildUtoolsEntries', () => {
  it('每个 feature 一条词条：key/commandId/pluginId/形状正确，keywords 聚合 name+cmds+code+explain', () => {
    const out = buildUtoolsEntries([scan()])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      key: 'utools-port:json-tool/format',
      kind: 'plugin',
      pluginId: 'utools-port',
      commandId: 'json-tool/format',
      title: '格式化 JSON',
      subtitle: 'JSON 工具',
      icon: '🧩',
      keywords: ['JSON 工具', '格式化 JSON', 'format-json', 'format', '格式化']
    })
    expect(out[1].key).toBe('utools-port:json-tool/compress')
  })

  it('title 取首个含 CJK 的 cmd（斗图 cmds[0]=doutu → 斗图）；空 cmds 兜底 code', () => {
    const out = buildUtoolsEntries([
      scan({
        id: 'doutu',
        manifest: {
          name: '斗图',
          description: '',
          version: '',
          main: 'index.html',
          logo: '',
          features: [{ code: 'dt', explain: '斗图', cmds: ['doutu', '斗图', '斗图'] }]
        }
      }),
      scan({
        id: 'empty-cmds',
        manifest: { name: '空', description: '', version: '', main: 'index.html', logo: '', features: [{ code: 'fallback', explain: '', cmds: [] }] }
      })
    ])
    expect(out[0].title).toBe('斗图')
    expect(out[1].title).toBe('fallback')
  })

  it('error 项（无 manifest）不产词条', () => {
    expect(buildUtoolsEntries([{ id: 'broken', error: 'plugin.json 不是合法 JSON' }])).toEqual([])
    expect(buildUtoolsEntries([])).toEqual([])
  })

  it('同 manifest 重复 code 只保留首个；不同目录同名 code 并存（key 含目录名不撞）', () => {
    const dup: UtoolsEntryScan = scan({
      manifest: {
        name: 'x',
        description: '',
        version: '',
        main: 'index.html',
        logo: '',
        features: [
          { code: 'same', explain: '', cmds: ['第一个'] },
          { code: 'same', explain: '', cmds: ['第二个'] }
        ]
      }
    })
    const out = buildUtoolsEntries([dup, scan({ id: 'other-dir' })])
    expect(out.map((e) => e.commandId)).toEqual(['json-tool/same', 'other-dir/format', 'other-dir/compress'])
    expect(new Set(out.map((e) => e.key)).size).toBe(out.length)
  })
})

describe('parseUtoolsCommandId', () => {
  it('按首个 / 切分；无斜杠/空段/只有斜杠返回 null', () => {
    expect(parseUtoolsCommandId('doutu/dt')).toEqual({ id: 'doutu', code: 'dt' })
    expect(parseUtoolsCommandId('a/b/c')).toEqual({ id: 'a', code: 'b/c' })
    expect(parseUtoolsCommandId('utools')).toBeNull()
    expect(parseUtoolsCommandId('/dt')).toBeNull()
    expect(parseUtoolsCommandId('dir/')).toBeNull()
    expect(parseUtoolsCommandId('')).toBeNull()
  })
})
