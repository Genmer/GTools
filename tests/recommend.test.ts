import { describe, expect, it, vi } from 'vitest'
import type { PluginManifest, PluginMatcher } from '../sdk/manifest'
import type { SearchEntry } from '../src/renderer/src/core/matcher'
import type { MatchFile, RecItem } from '../src/renderer/src/core/recommend'
import { buildRecommendations, dedupeRecs, fileMatcherHits, keywordSideHits, looksLikeJson, matcherHits, mergeQueryRecommendations } from '../src/renderer/src/core/recommend'
import { isSensitiveText } from '../src/renderer/src/core/sensitive'

const entry = (over: Partial<SearchEntry> & { key: string }): SearchEntry => ({ title: over.key, icon: '', ...over })

const manifest = (id: string, over: Partial<PluginManifest> = {}): PluginManifest => ({
  id,
  name: id,
  version: '0.1.0',
  protocolVersion: 1,
  icon: '🧩',
  keywords: [id],
  activation: 'trigger',
  permissions: [],
  source: 'builtin',
  entry: './index.vue',
  ...over
})

const file = (name: string, isDirectory = false): MatchFile => ({
  name,
  path: `C:/tmp/${name}`,
  isDirectory,
  isFile: !isDirectory
})

// files/img 型与 fileType/extensions 归 sdk 车道扩展，落地前以 unknown[] 断言注入（unknown 降转合法）
const withMatchers = (m: PluginManifest, matchers: unknown[]): PluginManifest => ({ ...m, matchers: matchers as PluginMatcher[] })

describe('looksLikeJson', () => {
  it('object/array 且可解析才为真，顶层标量与残缺文本为假', () => {
    expect(looksLikeJson('{"a":1}')).toBe(true)
    expect(looksLikeJson('  [1,2]  ')).toBe(true)
    expect(looksLikeJson('"str"')).toBe(false)
    expect(looksLikeJson('123')).toBe(false)
    expect(looksLikeJson('{bad')).toBe(false)
    expect(looksLikeJson('')).toBe(false)
    expect(looksLikeJson('null')).toBe(false)
  })

  it('超长文本直接假，不进解析', () => {
    const big = '{"a":"' + 'x'.repeat(100_001) + '"}'
    expect(big.length).toBeGreaterThan(100_000)
    expect(looksLikeJson(big)).toBe(false)
  })
})

describe('keywordSideHits', () => {
  const entries: SearchEntry[] = [
    entry({ key: 'translate:_main', title: '聚合翻译', icon: '🌐', pluginId: 'translate', keywords: ['fy', '翻译', 'fanyi'] }),
    entry({ key: 'calc:_main', title: '计算器', icon: '🧮', pluginId: 'calc', keywords: ['calc', 'jsq'] }),
    entry({ key: 'app:vscode', title: 'VS Code', icon: '', keywords: ['vscode', 'code'] })
  ]

  it('CJK keyword ≥2 沾边命中，短 ASCII keyword 不算沾边', () => {
    const hits = keywordSideHits('翻译成英文', entries, new Set())
    expect(hits.map((h) => h.pluginId)).toEqual(['translate'])
    // 'fy' 长 2 < 3 不命中；'fanyi' 长 5 命中
    expect(keywordSideHits('fanyi是什么', entries, new Set()).map((h) => h.pluginId)).toEqual(['translate'])
    expect(keywordSideHits('fy 文档', entries, new Set())).toEqual([])
  })

  it('excludeKeys 排除已入主区的完整命中词条；无 pluginId 的应用词条不产出', () => {
    const hits = keywordSideHits('翻译成英文', entries, new Set(['translate:_main']))
    expect(hits).toEqual([])
    // 应用词条（无 pluginId）即使沾边也不推荐
    expect(keywordSideHits('vscode的配置', entries, new Set())).toEqual([])
  })

  it('按 kw 长度降序、上限 4；query 为空恒空', () => {
    const pool: SearchEntry[] = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      entry({ key: `${id}:_main`, title: id, icon: '', pluginId: id, keywords: [id.repeat(3)] })
    )
    pool.push(entry({ key: 'long:_main', title: 'long', icon: '', pluginId: 'long', keywords: ['abcdefgh'] }))
    const hits = keywordSideHits('aaa bbb ccc ddd eee abcdefgh', pool, new Set())
    expect(hits).toHaveLength(4)
    expect(hits[0].pluginId).toBe('long')
    expect(hits.slice(1).map((h) => h.pluginId)).toEqual(['a', 'b', 'c'])
    expect(keywordSideHits('   ', pool, new Set())).toEqual([])
  })
})

describe('matcherHits', () => {
  it('text 型过长度窗（minLength 缺省 2），maxLength 先截断再判', () => {
    const m = manifest('translate', { matchers: [{ type: 'text', label: '用聚合翻译翻译' }], description: '翻译' })
    const noHit = matcherHits('a', [m])
    expect(noHit).toHaveLength(0)
    const hit = matcherHits(' hello world ', [m])
    expect(hit).toHaveLength(1)
    expect(hit[0].payload).toBe('hello world')
    expect(hit[0].title).toBe('translate')
    expect(hit[0].subtitle).toBe('翻译')
    const capped = manifest('t2', { matchers: [{ type: 'text', label: 'x', maxLength: 2 }] })
    expect(matcherHits('abcd', [capped])[0].payload).toBe('ab')
  })

  it('regex 型：命中、非法正则跳过、exclude 排除', () => {
    const m = manifest('file-search', {
      matchers: [{ type: 'regex', match: '(?:[A-Za-z]:[\\\\/]|\\\\\\\\|/)[^\\s]{2,}', label: '本地搜索' }]
    })
    const hit = matcherHits('打开 C:\\Users\\foo', [m])
    expect(hit).toHaveLength(1)
    expect(hit[0].payload).toBe('打开 C:\\Users\\foo')
    expect(matcherHits('没有路径的普通话', [m])).toEqual([])

    const invalid = manifest('bad', { matchers: [{ type: 'regex', match: '([', label: 'x' }] })
    expect(matcherHits('anything', [invalid])).toEqual([])

    const excluded = manifest('ex', {
      matchers: [{ type: 'regex', match: '.', label: 'x', exclude: '^a' }]
    })
    expect(matcherHits('apple', [excluded])).toEqual([])
    expect(matcherHits('banana', [excluded])).toHaveLength(1)
  })

  it('json 型只测 query 自身（剪贴板源已拆除）', () => {
    const j = manifest('json-editor', { matchers: [{ type: 'json', label: '打开 JSON 编辑器' }] })
    const queryHit = matcherHits('{"a":1}', [j])
    expect(queryHit).toHaveLength(1)
    expect(queryHit[0].pluginId).toBe('json-editor')
    expect(queryHit[0].payload).toBe('{"a":1}')
    // query 非 JSON 不命中；空 query 恒空
    expect(matcherHits('hello', [j])).toEqual([])
    expect(matcherHits('', [j])).toEqual([])

    const t = manifest('translate', { matchers: [{ type: 'text', label: 'x' }] })
    expect(matcherHits('', [t])).toEqual([]) // 空 query 下 text 不产出
  })

  it('json 型 payload 阈值：≤100k（解析上限）全量携带，text/regex 仍 2000 剥离', () => {
    const j = manifest('json-editor', { matchers: [{ type: 'json', label: '打开 JSON 编辑器' }] })
    const ok = `{"a":"${'x'.repeat(1980)}"}`
    expect(ok.length).toBeLessThanOrEqual(2000)
    const [okHit] = matcherHits(ok, [j])
    expect(okHit.payload).toBe(ok)
    expect(okHit.title).toBe('json-editor')
    const big = `{"a":"${'x'.repeat(2100)}"}` // 2000 < len ≤ 100k：json 源全注入（json-editor 消费全文）
    expect(big.length).toBeGreaterThan(2000)
    const [bigHit] = matcherHits(big, [j])
    expect(bigHit.payload).toBe(big)
    const t = manifest('translate', { matchers: [{ type: 'text', label: 'x' }] })
    const bigText = 'x'.repeat(2100)
    expect(matcherHits(bigText, [t])[0].payload).toBeUndefined()
  })

  it('按源组配额：text 上限 4、json 属于 content 组不被挤占', () => {
    const textPlugins = [1, 2, 3, 4, 5].map((i) =>
      manifest(`t${i}`, { matchers: [{ type: 'text', label: `t${i}` }] })
    )
    const jsonPlugin = manifest('json-p', { matchers: [{ type: 'json', label: 'json' }] })
    const hits = matcherHits('{"a":1}', [...textPlugins, jsonPlugin])
    expect(hits.filter((h) => h.source === 'text')).toHaveLength(4)
    expect(hits.filter((h) => h.source === 'json')).toHaveLength(1)
    expect(hits).toHaveLength(5)
  })

  it('每插件每 type 至多一条、总数上限 4', () => {
    const m = manifest('multi', {
      commands: [{ id: 'a', title: 'A' }],
      matchers: [
        { type: 'text', label: 'x1' },
        { type: 'text', label: 'x2' },
        { type: 'text', label: 'x3', commandId: 'a' }
      ]
    })
    expect(matcherHits('hello', [m])).toHaveLength(1)
    const many = [1, 2, 3, 4, 5].map((i) => manifest(`p${i}`, { matchers: [{ type: 'text', label: 'x' }] }))
    expect(matcherHits('hello', many)).toHaveLength(4)
  })

  it('超 2000 字符的命中文本剥离 payload（只进入不注入）', () => {
    const m = manifest('translate', { matchers: [{ type: 'text', label: 'x' }] })
    const big = 'x'.repeat(2001)
    const [hit] = matcherHits(big, [m])
    expect(hit.payload).toBeUndefined()
    const ok = 'x'.repeat(2000)
    expect(matcherHits(ok, [m])[0].payload).toBe(ok)
  })
})

describe('fileMatcherHits（拖入文件/图片推荐源）', () => {
  const filesMatcher = (over: Record<string, unknown> = {}): unknown => ({ type: 'files', label: '用 PDF 工具打开', ...over })
  const imgMatcher = (over: Record<string, unknown> = {}): unknown => ({ type: 'img', label: '用图片工具打开', ...over })

  it('extensions：任一文件后缀命中即中（大小写不敏感），全不命中则不产出', () => {
    const m = withMatchers(manifest('pdf-tools', { name: 'PDF 工具' }), [filesMatcher({ extensions: ['pdf'] })])
    const hit = fileMatcherHits([file('报告.PDF')], [m], false)
    expect(hit).toHaveLength(1)
    expect(hit[0]).toMatchObject({ pluginId: 'pdf-tools', source: 'files', title: 'PDF 工具' })
    expect(hit[0].payload).toBeUndefined()
    // 混入多个文件，任一后缀命中即中
    expect(fileMatcherHits([file('a.txt'), file('b.pdf')], [m], false)).toHaveLength(1)
    expect(fileMatcherHits([file('a.txt'), file('b.docx')], [m], false)).toEqual([])
    // 无后缀名文件不命中任何扩展要求
    expect(fileMatcherHits([file('README')], [m], false)).toEqual([])
  })

  it('fileType 三态：file 要有 isFile、directory 要有 isDirectory、缺省/both 非空即中', () => {
    const f = withMatchers(manifest('p1'), [filesMatcher({ fileType: 'file' })])
    const d = withMatchers(manifest('p2'), [filesMatcher({ fileType: 'directory' })])
    const both = withMatchers(manifest('p3'), [filesMatcher()])
    const dirOnly = [file('目录', true)]
    const fileOnly = [file('a.txt')]
    expect(fileMatcherHits(fileOnly, [f], false)).toHaveLength(1)
    expect(fileMatcherHits(dirOnly, [f], false)).toEqual([])
    expect(fileMatcherHits(dirOnly, [d], false)).toHaveLength(1)
    expect(fileMatcherHits(fileOnly, [d], false)).toEqual([])
    expect(fileMatcherHits(dirOnly, [both], false)).toHaveLength(1)
    expect(fileMatcherHits(fileOnly, [both], false)).toHaveLength(1)
    // 未拖入任何文件恒不产出（both 也一样）
    expect(fileMatcherHits([], [both, f, d], false)).toEqual([])
  })

  it('img 型：hasImage 才命中，与文件列表是否为空无关', () => {
    const m = withMatchers(manifest('img-tool'), [imgMatcher()])
    expect(fileMatcherHits([], [m], true)).toHaveLength(1)
    expect(fileMatcherHits([file('a.png')], [m], true)).toHaveLength(1)
    expect(fileMatcherHits([file('a.png')], [m], false)).toEqual([])
    expect(fileMatcherHits([], [m], false)).toEqual([])
  })

  it('title 取 commandTitle 或插件名；每插件每 source 至多一条', () => {
    const m = withMatchers(manifest('multi', { commands: [{ id: 'open', title: '打开命令' }] }), [
      filesMatcher({ commandId: 'open' })
    ])
    expect(fileMatcherHits([file('a.txt')], [m], false)[0].title).toBe('打开命令')
    const dup = withMatchers(manifest('dup'), [filesMatcher(), filesMatcher()])
    expect(fileMatcherHits([file('a.txt')], [dup], false)).toHaveLength(1)
  })

  it('files 与 img 分别至多一条、总数上限 4', () => {
    const many = [1, 2, 3, 4, 5].map((i) => withMatchers(manifest(`p${i}`), [filesMatcher()]))
    expect(fileMatcherHits([file('a.txt')], many, false)).toHaveLength(4)
    const both = withMatchers(manifest('both-plugin'), [filesMatcher(), imgMatcher()])
    const hits = fileMatcherHits([file('a.png')], [both], true)
    expect(hits.map((h) => h.source)).toEqual(['files', 'img'])
  })
})

describe('buildRecommendations 合并序与拖入源', () => {
  it('合并序 json > files > img > keyword > regex > text（json 源=query 自身检测），同插件 files/img 同键去重保 files', () => {
    const jsonEditor = manifest('json-editor', { matchers: [{ type: 'json', label: 'J' }] })
    const filePlugin = withMatchers(manifest('pdf-tools'), [{ type: 'files', label: 'F', extensions: ['pdf'] }])
    const imgPlugin = withMatchers(manifest('img-tool'), [{ type: 'img', label: 'I' }])
    const regexPlugin = manifest('regex-p', { matchers: [{ type: 'regex', match: '[0-9]+', label: 'R' }] })
    const textPlugin = manifest('text-p', { matchers: [{ type: 'text', label: 'T' }] })
    const entries: SearchEntry[] = [entry({ key: 'kw-p:_main', title: 'kw 沾边', icon: '', pluginId: 'kw-p', keywords: ['abc'] })]
    const r = buildRecommendations({
      query: '{"abc": 1}',
      entries,
      resultKeys: new Set(),
      manifests: [jsonEditor, filePlugin, imgPlugin, regexPlugin, textPlugin],
      files: [file('x.pdf')],
      hasImage: true
    })
    expect(r.map((x) => x.source)).toEqual(['json', 'files', 'img', 'keyword', 'regex', 'text'])

    // 同插件 files+img（同 commandId 缺省键）：合并去重保留优先级更高的 files
    const both = withMatchers(manifest('both'), [{ type: 'files', label: 'F' }, { type: 'img', label: 'I' }])
    expect(buildRecommendations({ query: 'q', files: [file('a.pdf')], hasImage: true, manifests: [both] }).map((x) => x.source)).toEqual(['files'])
  })

  it('空 query 下拖入源仍产出（不受空态短路约束），无拖入恒空', () => {
    const filePlugin = withMatchers(manifest('pdf-tools'), [{ type: 'files', label: 'F' }])
    const r = buildRecommendations({ query: '', manifests: [filePlugin], files: [file('a.pdf')], hasImage: false })
    expect(r.map((x) => x.source)).toEqual(['files'])
    expect(buildRecommendations({ query: '', manifests: [filePlugin] })).toEqual([])
  })
})

describe('buildRecommendations', () => {
  const translate = manifest('translate', {
    name: '聚合翻译',
    keywords: ['fy', '翻译', 'fanyi'],
    matchers: [{ type: 'text', label: '用聚合翻译翻译' }]
  })
  const jsonEditor = manifest('json-editor', { name: 'JSON 编辑器', matchers: [{ type: 'json', label: '打开 JSON 编辑器' }] })
  const entries: SearchEntry[] = [
    entry({ key: 'translate:_main', title: '聚合翻译', icon: '🌐', pluginId: 'translate', keywords: ['翻译'] })
  ]

  it('排序 json > keyword > regex > text，pluginId+commandId 去重先到先得', () => {
    const r = buildRecommendations({
      query: '{"翻译":1}',
      entries,
      resultKeys: new Set(),
      manifests: [jsonEditor, translate]
    })
    // translate 的 text 推荐与 keyword 推荐同指 translate:_main，去重保留优先级更高的 keyword
    expect(r.map((x) => x.source)).toEqual(['json', 'keyword'])
    expect(r.filter((x) => x.pluginId === 'translate')).toHaveLength(1)
    expect(r[1].source).toBe('keyword')
  })

  it('excludeKeys 挡住主结果已有词条', () => {
    // 无 matchers 的插件：excludeKeys 排除后推荐恒空
    const r = buildRecommendations({
      query: '翻译',
      entries,
      resultKeys: new Set(['translate:_main']),
      manifests: []
    })
    expect(r).toEqual([])
  })

  it('空态契约：query 为空各源恒不产出（json 只来自 query 自身）', () => {
    expect(buildRecommendations({ query: '', manifests: [translate, jsonEditor] })).toEqual([])
    const r = buildRecommendations({ query: '{"a":1}', manifests: [jsonEditor] })
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ pluginId: 'json-editor', source: 'json', payload: '{"a":1}' })
  })

  it('matcher 未声明时（如 PluginMatcher 缺省插件）不产出 matcher 推荐', () => {
    const bare = manifest('calc')
    expect(buildRecommendations({ query: 'jsq', manifests: [bare] })).toEqual([])
  })

  it('敏感 query：推荐保留但 payload 为 undefined', () => {
    const secretJson = '{"password":"super-secret-password-123"}'
    expect(isSensitiveText(secretJson)).toBe(true)
    const r = buildRecommendations({
      query: secretJson,
      entries: [],
      manifests: [jsonEditor, translate]
    })
    expect(r.length).toBeGreaterThan(0)
    for (const it of r) {
      expect(it.payload).toBeUndefined()
    }
  })
})

describe('mergeQueryRecommendations（query 态推荐与常驻推送行合并）', () => {
  const jsonEditor = manifest('json-editor', { name: 'JSON 编辑器', matchers: [{ type: 'json', label: '打开 JSON 编辑器' }] })
  const push = (key: string): RecItem => ({
    key,
    pluginId: key.split(':')[0],
    title: key,
    subtitle: '',
    icon: 'x',
    source: 'push'
  })

  it('json 源置顶到推送行之前：纯 JSON 输入的第一条推荐必须是 json 编辑器', () => {
    const recs = buildRecommendations({
      query: '{\n  "a": 1,\n  "b": [2, 3]\n}',
      entries: [],
      resultKeys: new Set(),
      manifests: [jsonEditor]
    })
    const r = mergeQueryRecommendations([push('clipboard:r1'), push('clipboard:r2')], recs)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({ pluginId: 'json-editor', commandId: undefined, source: 'json' })
    expect(r[0].payload).toBe('{\n  "a": 1,\n  "b": [2, 3]\n}')
    expect(r.slice(1).map((x) => x.source)).toEqual(['push', 'push'])
  })

  it('无 json 源时保持 推送行→其它推荐 原序；同 key 去重先到先得', () => {
    const recs = buildRecommendations({
      query: '翻译一下',
      entries: [entry({ key: 'translate:_main', title: '聚合翻译', icon: '', pluginId: 'translate', keywords: ['翻译'] })],
      resultKeys: new Set(),
      manifests: [manifest('translate', { name: '聚合翻译', matchers: [{ type: 'text', label: '用聚合翻译翻译' }] })]
    })
    const r = mergeQueryRecommendations([push('clipboard:r1'), { ...recs[0] }], recs)
    expect(r.map((x) => x.source)).toEqual(['push', 'keyword'])
  })

  it('与 dedupeRecs 语义一致：纯去重不重排', () => {
    const items = [push('a:_main'), push('b:_main'), push('a:_main')]
    expect(dedupeRecs(items)).toEqual([push('a:_main'), push('b:_main')])
  })
})

describe('非 JSON 输入不产出 json 源推荐', () => {
  const jsonEditor = manifest('json-editor', { matchers: [{ type: 'json', label: '打开 JSON 编辑器' }] })

  it('普通词、URL、Windows 路径、算式、普通多行文本均不命中', () => {
    const cases = ['hello world', 'https://example.com/a?b=1', 'C:\\Users\\foo\\bar.json', '1+2*3', '第一行\n第二行', 'resp: {"a":1}']
    for (const q of cases) {
      expect(looksLikeJson(q)).toBe(false)
      expect(
        buildRecommendations({ query: q, entries: [], resultKeys: new Set(), manifests: [jsonEditor] }).filter(
          (x) => x.source === 'json'
        )
      ).toEqual([])
    }
  })
})

describe('剪贴板分析 memo（同文本零重算）', () => {
  const jsonTool = manifest('json-editor', { matchers: [{ type: 'json', label: '打开 JSON 编辑器' }] })

  it('同一剪贴板 JSON 重复推荐不重复 JSON.parse', () => {
    const spy = vi.spyOn(JSON, 'parse')
    const clip = '{"order":"A-1001","items":[{"sku":"x","qty":2}]}'
    const run = (): number => {
      buildRecommendations({ query: clip, manifests: [jsonTool] })
      return spy.mock.calls.length
    }
    const first = run()
    expect(first).toBeGreaterThan(0)
    expect(run()).toBe(first)
    expect(run()).toBe(first)
    spy.mockRestore()
  })

  it('memo 不改变语义：敏感/非敏感文本交替判定与逐次现算一致', () => {
    const plain = '{"note":"hello"}'
    const secret = '{"password":"super-secret-123"}'
    for (let i = 0; i < 3; i++) {
      expect(buildRecommendations({ query: plain, manifests: [jsonTool] })).toHaveLength(1)
      expect(
        buildRecommendations({ query: secret, manifests: [jsonTool] }).filter(
          (it) => it.source === 'json'
        )
      ).toHaveLength(0)
    }
  })
})

describe('float-image 粘贴直贴链路（主面板粘贴图片→img 推荐→pin-clipboard）', () => {
  const floatImageManifest: PluginManifest = {
    id: 'float-image',
    name: '图片悬浮',
    version: '0.1.0',
    protocolVersion: 1,
    icon: '📌',
    keywords: ['float-image'],
    activation: 'trigger',
    permissions: [],
    source: 'builtin',
    entry: './index.vue',
    commands: [
      { id: 'pin-clipboard', title: '贴图：贴出剪贴板图片', keywords: ['tietu'] },
      { id: 'pin-file', title: '贴图：选择图片文件', keywords: ['tupian'] }
    ],
    matchers: [
      { type: 'files', extensions: ['png', 'jpg'], label: '贴图：悬浮图片文件', commandId: 'pin-file' },
      { type: 'img', label: '贴图：贴出剪贴板图片', commandId: 'pin-clipboard' }
    ]
  }

  it('img matcher 指向已存在的 pin-clipboard 命令（激活即回车直贴）', () => {
    const img = floatImageManifest.matchers?.find((m) => (m as PluginMatcher).type === 'img') as PluginMatcher
    expect(img).toBeDefined()
    expect(floatImageManifest.commands?.some((c) => c.id === img.commandId)).toBe(true)
  })

  it('剪贴板有图（无拖入文件）：img 推荐产出且 commandId=pin-clipboard，无图不产出', () => {
    const withImg = fileMatcherHits([], [floatImageManifest], true)
    expect(withImg.map((h) => h.source)).toEqual(['img'])
    expect(withImg[0]?.commandId).toBe('pin-clipboard')
    expect(fileMatcherHits([], [floatImageManifest], false)).toEqual([])
  })
})
