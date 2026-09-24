// 语言×上下文预设，数据源 docs/research/naming-conventions.md（DESIGN 附录 C.3 逐语言明细为权威）。
// 'lower' 风格 = 全小写直接连接（Java/Kotlin/Go 包名），规格六种 StyleId 之外的必要补充。

export type StyleId = 'camel' | 'pascal' | 'snake' | 'screaming' | 'kebab' | 'kCamel' | 'lower'

export type InitialismPolicy = 'word' | 'go' | 'csharp' | 'swift'

export interface ContextRule {
  id: string
  label: string
  style: StyleId
  prefix?: string
  suffix?: string
  note?: string
}

export interface LanguagePreset {
  id: string
  name: string
  contexts: ContextRule[]
  initialism: InitialismPolicy
}

const GENERIC: LanguagePreset = {
  id: 'generic',
  name: '通用',
  initialism: 'word',
  contexts: [
    { id: 'camel', label: 'camelCase 变量', style: 'camel' },
    { id: 'pascal', label: 'PascalCase 类型', style: 'pascal' },
    { id: 'snake', label: 'snake_case 变量', style: 'snake' },
    { id: 'kebab', label: 'kebab-case 文件/CSS', style: 'kebab' },
    { id: 'screaming', label: 'SCREAMING_SNAKE 常量', style: 'screaming' }
  ]
}

const PRESETS: LanguagePreset[] = [
  {
    id: 'javascript',
    name: 'JavaScript',
    initialism: 'word',
    contexts: [
      { id: 'variable', label: '变量', style: 'camel' },
      { id: 'param', label: '参数', style: 'camel' },
      { id: 'function', label: '函数/方法', style: 'camel' },
      { id: 'class', label: '类/接口/类型', style: 'pascal' },
      { id: 'enum-name', label: '枚举名', style: 'pascal' },
      { id: 'enum-value', label: '枚举值', style: 'screaming' },
      { id: 'constant', label: '模块级常量', style: 'screaming', note: '仅模块级 const；函数内 const 保持 camelCase' },
      { id: 'file', label: '文件名', style: 'kebab', note: '全小写，_ 或 - 分词均可' },
      { id: 'package', label: 'npm 包名', style: 'kebab', note: 'npm 禁大写字母' }
    ]
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    initialism: 'word',
    contexts: [
      { id: 'variable', label: '变量/参数/属性', style: 'camel' },
      { id: 'function', label: '函数/方法', style: 'camel' },
      { id: 'type', label: '类/接口/type/枚举名', style: 'pascal' },
      { id: 'constant', label: '模块级常量/枚举值', style: 'screaming', note: '局部 const 保持 camelCase' },
      { id: 'member', label: '私有成员', style: 'camel', note: 'Google TS 明令禁 _ 前缀/后缀' },
      { id: 'file', label: '文件名', style: 'snake', note: 'Google TS 版；社区亦见 kebab/Pascal' }
    ]
  },
  {
    id: 'python',
    name: 'Python',
    initialism: 'word',
    contexts: [
      { id: 'variable', label: '变量', style: 'snake' },
      { id: 'function', label: '函数/方法', style: 'snake' },
      { id: 'class', label: '类', style: 'pascal' },
      { id: 'exception', label: '异常类', style: 'pascal', suffix: 'Error' },
      { id: 'constant', label: '常量', style: 'screaming' },
      { id: 'module', label: '模块名', style: 'snake', note: '全小写，可用下划线' },
      { id: 'package', label: '包名', style: 'snake', note: '全小写，不鼓励下划线' },
      { id: 'private', label: '非公开成员', style: 'snake', prefix: '_' }
    ]
  },
  {
    id: 'java',
    name: 'Java',
    initialism: 'word',
    contexts: [
      { id: 'variable', label: '变量/字段/参数', style: 'camel' },
      { id: 'function', label: '方法', style: 'camel' },
      { id: 'class', label: '类/接口', style: 'pascal' },
      { id: 'constant', label: '常量', style: 'screaming', note: '仅 static final 深不可变才算常量' },
      { id: 'package', label: '包名', style: 'lower', note: '全小写直接连接，禁下划线' },
      { id: 'file', label: '文件名', style: 'pascal', note: '须与顶层类名一致' }
    ]
  },
  {
    id: 'kotlin',
    name: 'Kotlin',
    initialism: 'csharp',
    contexts: [
      { id: 'variable', label: '变量/属性', style: 'camel' },
      { id: 'function', label: '函数/方法', style: 'camel', note: '返回抽象类型的工厂函数可用 PascalCase' },
      { id: 'class', label: '类/对象', style: 'pascal' },
      { id: 'constant', label: '常量', style: 'screaming', note: 'const val / 顶层深不可变 val' },
      { id: 'enum-value', label: '枚举值', style: 'screaming', note: 'PascalCase 亦可' },
      { id: 'file', label: '文件名', style: 'pascal', note: 'PascalCase.kt' },
      { id: 'private', label: '后备属性', style: 'camel', prefix: '_' }
    ]
  },
  {
    id: 'go',
    name: 'Go',
    initialism: 'go',
    contexts: [
      { id: 'variable', label: '变量（未导出）', style: 'camel', note: '小写首字母 = 未导出' },
      { id: 'exported', label: '导出符号', style: 'pascal', note: '函数/类型/常量通用：首字母大写 = 导出' },
      { id: 'constant', label: '常量', style: 'pascal', note: '禁 SCREAMING_SNAKE（官方明说）' },
      { id: 'package', label: '包名', style: 'lower', note: '全小写单词，无下划线无驼峰' },
      { id: 'file', label: '文件名', style: 'snake', note: '小写下划线（社区惯例）' }
    ]
  },
  {
    id: 'rust',
    name: 'Rust',
    initialism: 'word',
    contexts: [
      { id: 'variable', label: '变量', style: 'snake' },
      { id: 'function', label: '函数/方法/模块', style: 'snake' },
      { id: 'type', label: '类型/trait/枚举变体', style: 'pascal', note: '缩写按单词：Uuid 非 UUID' },
      { id: 'constant', label: '常量/静态', style: 'screaming' }
    ]
  },
  {
    id: 'csharp',
    name: 'C#',
    initialism: 'csharp',
    contexts: [
      { id: 'variable', label: '参数/局部变量', style: 'camel' },
      { id: 'private-field', label: '私有字段', style: 'camel', prefix: '_', note: '社区主流（Roslyn）' },
      { id: 'function', label: '方法/属性/事件', style: 'pascal' },
      { id: 'class', label: '类/枚举值', style: 'pascal' },
      { id: 'interface', label: '接口', style: 'pascal', prefix: 'I' },
      { id: 'constant', label: '常量', style: 'pascal' },
      { id: 'namespace', label: '命名空间', style: 'pascal' }
    ]
  },
  {
    id: 'cpp-google',
    name: 'C++ (Google)',
    initialism: 'word',
    contexts: [
      { id: 'variable', label: '变量/参数', style: 'snake' },
      { id: 'member', label: '类数据成员', style: 'snake', suffix: '_', note: 'struct 成员无尾下划线' },
      { id: 'function', label: '函数', style: 'pascal', note: 'accessor/mutator 可 snake_case' },
      { id: 'class', label: '类型', style: 'pascal' },
      { id: 'constant', label: '常量', style: 'kCamel' },
      { id: 'enum-value', label: '枚举值', style: 'kCamel', note: '按常量命名，不按宏' },
      { id: 'macro', label: '宏', style: 'screaming', note: 'UPPER_SNAKE + 项目前缀' },
      { id: 'namespace', label: '命名空间', style: 'snake', note: '全小写' }
    ]
  },
  {
    id: 'cpp-llvm',
    name: 'C++ (LLVM)',
    initialism: 'word',
    contexts: [
      { id: 'variable', label: '变量（首字母大写）', style: 'pascal' },
      { id: 'function', label: '函数（首字母小写）', style: 'camel' },
      { id: 'class', label: '类型', style: 'pascal' },
      { id: 'enum-value', label: '枚举器', style: 'screaming', note: '大写带前缀或裸常量' }
    ]
  },
  {
    id: 'php',
    name: 'PHP',
    initialism: 'word',
    contexts: [
      { id: 'variable', label: '变量/属性', style: 'camel', note: 'PSR-1 故意不规定属性，默认 camelCase' },
      { id: 'function', label: '方法', style: 'camel' },
      { id: 'class', label: '类', style: 'pascal' },
      { id: 'constant', label: '类常量', style: 'screaming' },
      { id: 'namespace', label: '命名空间', style: 'pascal' },
      { id: 'file', label: '文件名', style: 'pascal', note: 'PSR-4：类名.php' }
    ]
  },
  {
    id: 'ruby',
    name: 'Ruby',
    initialism: 'word',
    contexts: [
      { id: 'variable', label: '变量', style: 'snake' },
      { id: 'function', label: '方法', style: 'snake' },
      { id: 'predicate', label: '谓词方法', style: 'snake', suffix: '?', note: '禁 is_ 前缀（empty? 非 is_empty）' },
      { id: 'class', label: '类/模块', style: 'pascal', note: '缩写保持全大写（SomeXML）' },
      { id: 'constant', label: '常量', style: 'screaming', note: '类/模块也是常量但用 PascalCase' }
    ]
  },
  {
    id: 'swift',
    name: 'Swift',
    initialism: 'swift',
    contexts: [
      { id: 'variable', label: '变量', style: 'camel' },
      { id: 'function', label: '函数/方法', style: 'camel', note: '工厂可用 make 前缀' },
      { id: 'class', label: '类型/协议', style: 'pascal' },
      { id: 'constant', label: '常量', style: 'camel', note: '连全局常量也是 camelCase；禁 k/g 前缀' },
      { id: 'bool', label: '布尔', style: 'camel', note: '断言式命名（isEmpty）' }
    ]
  },
  {
    id: 'css',
    name: 'CSS/BEM',
    initialism: 'word',
    contexts: [
      { id: 'class', label: '类名', style: 'kebab' },
      { id: 'id', label: 'ID', style: 'kebab' },
      { id: 'custom-prop', label: '自定义属性', style: 'kebab', prefix: '--' }
    ]
  },
  {
    id: 'sql',
    name: 'SQL',
    initialism: 'word',
    contexts: [
      { id: 'column', label: '列名', style: 'snake' },
      { id: 'table', label: '表名', style: 'snake' },
      { id: 'bool-column', label: '布尔列', style: 'snake', prefix: 'is_', note: '亦用 has_ 前缀' },
      { id: 'foreign-key', label: '外键', style: 'snake', suffix: '_id', note: '主键固定 id' }
    ]
  },
  {
    id: 'shell',
    name: 'Shell',
    initialism: 'word',
    contexts: [
      { id: 'variable', label: '变量/函数', style: 'snake' },
      { id: 'constant', label: '常量/导出变量', style: 'screaming', note: 'readonly / export，文件顶部声明' },
      { id: 'file', label: '文件名', style: 'snake', note: '全小写下划线，禁连字符' }
    ]
  }
]

export const GENERIC_PRESET = GENERIC
export const LANGUAGE_PRESETS: readonly LanguagePreset[] = PRESETS
export const ALL_PRESETS: readonly LanguagePreset[] = [GENERIC, ...PRESETS]

// ---- 布尔/函数惯用前缀提示（数据源 docs/research/abbreviations.md Part 4）----

/** 布尔前缀动词全集（A6）；天然布尔形容词命中时同样提示可加前缀 */
export const BOOL_PREFIXES = ['is', 'has', 'can', 'should'] as const

export const BOOL_MARKER_ZH = [
  '是否', '启用', '禁用', '可见', '隐藏', '激活', '开启', '关闭', '可选', '必填', '有效', '在线', '已登录', '为空'
] as const

export const BOOL_MARKER_EN = [
  'enable', 'enabled', 'disable', 'disabled', 'visible', 'hidden', 'active', 'selected', 'checked',
  'readonly', 'valid', 'empty', 'online', 'visible', 'available'
] as const

/** 中文动词 → 惯用英文函数动词（A2/A4）；命中后按当前语言函数风格生成建议 */
export const FUNC_VERB_ZH: Readonly<Record<string, readonly string[]>> = {
  获取: ['get', 'fetch'],
  创建: ['create'],
  删除: ['delete', 'remove'],
  添加: ['add'],
  设置: ['set'],
  重置: ['reset'],
  处理: ['handle'],
  检查: ['check'],
  校验: ['validate', 'verify'],
  发送: ['send'],
  加载: ['load'],
  保存: ['save'],
  更新: ['update'],
  计算: ['calculate'],
  解析: ['parse'],
  格式化: ['format']
}

/** 惯用函数动词配对（A2）：取一个提示另一个 */
export const FUNC_VERB_PAIRS: Readonly<Record<string, string>> = {
  get: 'set',
  set: 'get',
  add: 'remove',
  remove: 'add',
  create: 'delete',
  delete: 'create',
  fetch: 'get',
  send: 'receive'
}
