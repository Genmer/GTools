// 风格引擎纯函数测试：分词、七种风格、缩写词四策略、候选生成、布尔/函数前缀提示
import { describe, expect, it } from 'vitest'
import { applyStyle, boolHints, functionHints, generate, tokenize } from '../../../../src/plugins/var-name/logic/engine'
import { GENERIC_PRESET, LANGUAGE_PRESETS } from '../../../../src/plugins/var-name/data/presets'

// 测试数据完备性由 data.test.ts 保证，此处断言非空
const byId = (id: string) => LANGUAGE_PRESETS.find((p) => p.id === id)!

describe('tokenize 分词', () => {
  it('空格/下划线/连字符/点号切分 + 小写化', () => {
    expect(tokenize('user settings')).toEqual(['user', 'settings'])
    expect(tokenize('user_name-style.v2')).toEqual(['user', 'name', 'style', 'v2'])
    expect(tokenize('  USER   Settings ')).toEqual(['user', 'settings'])
  })

  it('驼峰拆分（含大写连串）', () => {
    expect(tokenize('userName')).toEqual(['user', 'name'])
    expect(tokenize('XMLHttpRequest')).toEqual(['xml', 'http', 'request'])
    expect(tokenize('parseJSONData')).toEqual(['parse', 'json', 'data'])
  })

  it('停用词过滤（the/a/of/for），标点剥离', () => {
    expect(tokenize('the length of a list for calc')).toEqual(['length', 'list', 'calc'])
    expect(tokenize("user's name, really!")).toEqual(['user', 'name', 'really'])
  })

  it('全停用词/空输入 → 空数组', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('the a of for')).toEqual([])
  })
})

describe('applyStyle 风格渲染', () => {
  const w = ['user', 'settings']
  it('六种基本风格 + kCamel + lower', () => {
    expect(applyStyle(w, 'camel', 'word')).toBe('userSettings')
    expect(applyStyle(w, 'pascal', 'word')).toBe('UserSettings')
    expect(applyStyle(w, 'snake', 'word')).toBe('user_settings')
    expect(applyStyle(w, 'screaming', 'word')).toBe('USER_SETTINGS')
    expect(applyStyle(w, 'kebab', 'word')).toBe('user-settings')
    expect(applyStyle(w, 'kCamel', 'word')).toBe('kUserSettings')
    expect(applyStyle(w, 'lower', 'word')).toBe('usersettings')
  })

  it('空词组返回空串', () => {
    expect(applyStyle([], 'camel', 'word')).toBe('')
  })

  it('缩写词策略 word：按单词弯折（Java/TS/Rust 派）', () => {
    expect(applyStyle(['load', 'http', 'url'], 'camel', 'word')).toBe('loadHttpUrl')
    expect(applyStyle(['uuid', 'generator'], 'pascal', 'word')).toBe('UuidGenerator')
  })

  it('缩写词策略 go：整体同格（导出 URL / 未导出 url，禁 Url）', () => {
    expect(applyStyle(['url', 'builder'], 'pascal', 'go')).toBe('URLBuilder')
    expect(applyStyle(['url', 'builder'], 'camel', 'go')).toBe('urlBuilder')
    expect(applyStyle(['user', 'id'], 'snake', 'go')).toBe('user_id')
  })

  it('缩写词策略 csharp：两字母全大写、≥3 首字母大写、id/db 当闭合复合词（Id 非 ID）', () => {
    expect(applyStyle(['io', 'stream'], 'pascal', 'csharp')).toBe('IOStream')
    expect(applyStyle(['xml', 'tag'], 'pascal', 'csharp')).toBe('XmlTag')
    expect(applyStyle(['user', 'id'], 'pascal', 'csharp')).toBe('UserId')
    expect(applyStyle(['db', 'pool'], 'pascal', 'csharp')).toBe('DbPool')
  })

  it('缩写词策略 swift：通用度高的缩写统一升/降格（URL / url）', () => {
    expect(applyStyle(['url', 'session'], 'pascal', 'swift')).toBe('URLSession')
    expect(applyStyle(['url', 'session'], 'camel', 'swift')).toBe('urlSession')
    // 非高通用度缩写按普通词
    expect(applyStyle(['ascii', 'table'], 'pascal', 'swift')).toBe('AsciiTable')
  })
})

describe('generate 候选生成（语言预设硬差异）', () => {
  const w = ['max', 'retry', 'count']

  it('JavaScript：变量 camel、枚举值/常量 screaming、包名 kebab', () => {
    const js = byId('javascript')
    const got = generate(w, js)
    expect(got.length).toBe(9)
    expect(got.find((c) => c.contextId === 'variable')?.value).toBe('maxRetryCount')
    expect(got.find((c) => c.contextId === 'constant')?.value).toBe('MAX_RETRY_COUNT')
    expect(got.find((c) => c.contextId === 'package')?.value).toBe('max-retry-count')
  })

  it('Go：常量 Pascal（禁 SCREAMING）、导出=首字母大写、包名全小写连续', () => {
    const go = byId('go')
    expect(generate(w, go).find((c) => c.contextId === 'constant')?.value).toBe('MaxRetryCount')
    expect(generate(w, go).find((c) => c.contextId === 'exported')?.value).toBe('MaxRetryCount')
    expect(generate(w, go).find((c) => c.contextId === 'variable')?.value).toBe('maxRetryCount')
    expect(generate(['user', 'repo'], go).find((c) => c.contextId === 'package')?.value).toBe('userrepo')
  })

  it('Go 缩写整体同格：导出 URL / 未导出 url', () => {
    const go = byId('go')
    expect(generate(['url', 'parser'], go).find((c) => c.contextId === 'exported')?.value).toBe('URLParser')
    expect(generate(['url', 'parser'], go).find((c) => c.contextId === 'variable')?.value).toBe('urlParser')
  })

  it('C++ Google：常量 kCamel、类成员尾下划线、宏 SCREAMING', () => {
    const g = byId('cpp-google')
    expect(generate(w, g).find((c) => c.contextId === 'constant')?.value).toBe('kMaxRetryCount')
    expect(generate(['table', 'name'], g).find((c) => c.contextId === 'member')?.value).toBe('table_name_')
    expect(generate(['my', 'project', 'round'], g).find((c) => c.contextId === 'macro')?.value).toBe('MY_PROJECT_ROUND')
  })

  it('前后缀：C# 接口 I 前缀、Python 异常 Error 后缀、私有 _ 前缀、CSS 自定义属性 --', () => {
    expect(generate(['http', 'client'], byId('csharp')).find((c) => c.contextId === 'interface')?.value).toBe('IHttpClient')
    expect(generate(['timeout'], byId('python')).find((c) => c.contextId === 'exception')?.value).toBe('TimeoutError')
    expect(generate(['cache'], byId('python')).find((c) => c.contextId === 'private')?.value).toBe('_cache')
    expect(generate(['main', 'bg', 'color'], byId('css')).find((c) => c.contextId === 'custom-prop')?.value).toBe('--main-bg-color')
  })

  it('Swift 常量 camel（与常识相反）+ SQL 布尔列 is_ 前缀/外键 _id 后缀', () => {
    expect(generate(w, byId('swift')).find((c) => c.contextId === 'constant')?.value).toBe('maxRetryCount')
    const sql = byId('sql')
    expect(generate(['active'], sql).find((c) => c.contextId === 'bool-column')?.value).toBe('is_active')
    expect(generate(['user'], sql).find((c) => c.contextId === 'foreign-key')?.value).toBe('user_id')
  })

  it('Ruby 谓词方法 ? 后缀；LLVM 变量首字母大写', () => {
    expect(generate(['empty'], byId('ruby')).find((c) => c.contextId === 'predicate')?.value).toBe('empty?')
    expect(generate(['leader'], byId('cpp-llvm')).find((c) => c.contextId === 'variable')?.value).toBe('Leader')
    expect(generate(['open', 'file'], byId('cpp-llvm')).find((c) => c.contextId === 'function')?.value).toBe('openFile')
  })

  it('通用五件套：camel/pascal/snake/kebab/screaming 各一', () => {
    const got = generate(['user', 'config'], GENERIC_PRESET)
    expect(got.map((c) => c.value)).toEqual(['userConfig', 'UserConfig', 'user_config', 'user-config', 'USER_CONFIG'])
  })

  it('空词组 → 空候选', () => {
    expect(generate([], byId('javascript'))).toEqual([])
  })

  it('候选携带规则 note（Go 常量禁 SCREAMING 差异提示）', () => {
    expect(generate(w, byId('go')).find((c) => c.contextId === 'constant')?.note).toContain('SCREAMING')
  })
})

describe('布尔/函数惯用前缀提示', () => {
  it('中文布尔语义 → is/has/can/should 前缀候选（按当前语言变量风格）', () => {
    const got = boolHints('用户是否已启用', ['user', 'enabled'], byId('javascript'))
    expect(got.map((c) => c.value)).toEqual(['isUserEnabled', 'hasUserEnabled', 'canUserEnabled', 'shouldUserEnabled'])
  })

  it('英文布尔词命中同样提示；snake 风格用 _ 连接前缀', () => {
    const got = boolHints('check visible', ['visible'], byId('python'))
    expect(got.map((c) => c.value)).toEqual(['is_visible', 'has_visible', 'can_visible', 'should_visible'])
  })

  it('已带 is 前缀 → 换成其他前缀而非叠加；非布尔描述不提示', () => {
    expect(boolHints('is active', ['is', 'active'], byId('javascript')).map((c) => c.value)).toEqual([
      'hasActive',
      'canActive',
      'shouldActive'
    ])
    expect(boolHints('user name', ['user', 'name'], byId('javascript'))).toEqual([])
  })

  it('中文动词命中 → 惯用英文函数动词前缀', () => {
    const got = functionHints('获取用户配置', ['user', 'settings'], byId('javascript'))
    expect(got.find((c) => c.value === 'getUserSettings')).toBeTruthy()
    expect(got.find((c) => c.value === 'fetchUserSettings')).toBeTruthy()
  })

  it('已用动词 → 惯用配对提示（add↔remove）', () => {
    const got = functionHints('add item', ['add', 'item'], byId('javascript'))
    const pair = got.find((c) => c.label === '动词配对')
    expect(pair?.value).toBe('removeItem')
    expect(pair?.note).toContain('remove')
  })

  it('函数动词在 snake 语言用 snake 风格', () => {
    const got = functionHints('删除用户', ['user'], byId('python'))
    expect(got.map((c) => c.value)).toContain('delete_user')
    expect(got.map((c) => c.value)).toContain('remove_user')
  })
})
