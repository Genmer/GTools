import type { RawEntry } from './types'

// 模板字符串里输出单个反斜杠需写 \\，围栏与行内代码的反引号同样要转义
const entries: RawEntry[] = [
  {
    slug: 'literal',
    name: '字面量',
    summary: '普通字符按原样匹配',
    keywords: ['literal', '普通字符'],
    copyText: 'abc',
    md: `普通字符原样匹配自身。

\`\`\`
/abc/  →  "xabcz" 命中 abc
\`\`\`

特殊字符（\`.*+?^$()[]{}|\\\`）想按字面匹配需转义。`
  },
  {
    slug: 'dot',
    name: '. 任意字符',
    summary: '匹配除换行外任意单个字符',
    keywords: ['dot', '任意字符'],
    copyText: '.',
    md: `\`.\` 匹配**除换行符外**的任意一个字符（\`s\` 标志下连换行也算）。

\`\`\`
a.c  →  "abc" "a1c" "a c" 命中；"a\\nc" 不中（无 s 时）
\`\`\``
  },
  {
    slug: 'char-class',
    name: '字符类 [abc]',
    summary: '方括号内任选其一',
    keywords: ['character class', '字符集', '方括号'],
    copyText: '[abc]',
    md: `\`[]\` 内列出可接受的字符，匹配其中任意**一个**。

\`\`\`
/[aeiou]/   匹配元音
/gr[ae]y/   "gray" "grey" 都命中
[abc-]      - 放末尾按字面匹配
\`\`\``
  },
  {
    slug: 'char-range',
    name: '字符范围 [a-z]',
    summary: '区间简写',
    keywords: ['range', '区间'],
    copyText: '[a-zA-Z0-9]',
    md: `- \`[a-z]\` 小写字母；\`[A-Za-z0-9_]\` 常见标识符字符集
- 区间按 Unicode 码点；\`[-a]\` 中开头的 \`-\` 是字面量

\`\`\`
/[0-9]{3}/   三位数字
\`\`\``
  },
  {
    slug: 'negated-class',
    name: '否定字符类 [^abc]',
    summary: '匹配不在集合内的字符',
    keywords: ['negated', '取反', '排除'],
    copyText: '[^abc]',
    md: `\`^\` 在 \`[]\` **内**开头表示取反。

\`\`\`
[^0-9]     任一非数字字符
[^\\n]      除换行外（. 的传统替代）
\`\`\`

注意：否定类仍要消耗一个字符，空串不会命中 \`[^a]\`。`
  },
  {
    slug: 'predefined',
    name: '预定义类 \\d \\w \\s',
    summary: '数字/单词字符/空白',
    keywords: ['digit', 'word', 'space', '数字', '空白'],
    copyText: '\\d\\w\\s',
    md: `| 写法 | 等价 | 含义 |
|---|---|---|
| \`\\d\` | \`[0-9]\` | 数字 |
| \`\\D\` | \`[^0-9]\` | 非数字 |
| \`\\w\` | \`[A-Za-z0-9_]\` | 单词字符 |
| \`\\W\` | 非单词字符 | 取反 |
| \`\\s\` | \`[ \\t\\n\\r\\f\\v]\` | 空白 |
| \`\\S\` | 非空白 | 取反 |

大小写取反。非 ASCII 场景（中文、全角）\`\\w\` \`\\d\` 不涵盖，用 Unicode 属性类。`
  },
  {
    slug: 'unicode-class',
    name: 'Unicode 类 \\p{...}',
    summary: '按 Unicode 属性匹配（需 u 标志）',
    keywords: ['unicode', '中文', 'emoji'],
    copyText: '\\p{Script=Han}',
    md: `\`u\` 标志下按 Unicode 属性匹配。

\`\`\`
/\\p{Script=Han}+/u       匹配中文
/\\p{L}/u                 任意语言的字母
/\\p{Emoji}/u             emoji
/\\P{L}/u                 取反（大写 P）
\`\`\``
  },
  {
    slug: 'anchors',
    name: '锚点 ^ $',
    summary: '行首/行尾零宽断言',
    keywords: ['anchor', '行首', '行尾', '锚点'],
    copyText: '^...$',
    md: `- \`^\` 串首（\`m\` 标志下每行行首）
- \`$\` 串尾（\`m\` 下每行行尾）
- 匹配的是**位置**，不消耗字符

\`\`\`
/^ERROR/        以 ERROR 开头
/\\.log$/        以 .log 结尾
/^head$/m       整行等于 head
\`\`\``
  },
  {
    slug: 'word-boundary',
    name: '词边界 \\b',
    summary: '单词边界（零宽）',
    keywords: ['boundary', '边界', '词首'],
    copyText: '\\b',
    md: `\`\\b\` 匹配 \`\\w\` 与非 \`\\w\` 的交界位置。

\`\`\`
/\\bcat\\b/   "a cat." 命中；"category" 不中
/\\bcat/     "category" 也命中（词首即可）
\`\`\`

中文与英文之间也有边界（中文字符属于 \\W）。`
  },
  {
    slug: 'quantifiers',
    name: '量词 * + ? {n,m}',
    summary: '重复次数',
    keywords: ['quantifier', '重复', '次数'],
    copyText: '{2,5}',
    md: `| 写法 | 次数 |
|---|---|
| \`*\` | 0 或多次 |
| \`+\` | 1 或多次 |
| \`?\` | 0 或 1 次 |
| \`{n}\` | 恰 n 次 |
| \`{n,}\` | 至少 n 次 |
| \`{n,m}\` | n 到 m 次 |

\`\`\`
/colou?r/      color 或 colour
/\\d{11}/      11 位手机号
/\\d{1,3}/     1-3 位数字
\`\`\``
  },
  {
    slug: 'greedy-lazy',
    name: '贪婪与非贪婪',
    summary: '量词默认贪婪，加 ? 变懒惰',
    keywords: ['greedy', 'lazy', '非贪婪', '最小匹配'],
    copyText: '.*?',
    md: `量词默认吃**最多**（贪婪）；后接 \`?\` 变**最少**（非贪婪/懒惰）。

\`\`\`
/<.*>/   对 "<a><b>" 匹配整串（贪婪）
/<.*?>/  只匹配 "<a>"（非贪婪）
\`\`\`

HTML 解析场景非贪婪几乎是必用技巧。`
  },
  {
    slug: 'grouping',
    name: '分组 (...)',
    summary: '捕获分组与整体限定',
    keywords: ['group', '分组', '捕获'],
    copyText: '(\\d+)-(\\d+)',
    md: `\`()\` 把一段当作整体：施加量词、提取子串。

\`\`\`
/ab+/      "abbbb"（+ 只作用于 b）
/(ab)+/    "ababab"（整体重复）
/(\\d{4})-(\\d{2})-(\\d{2})/   日期拆三组
\`\`\`

JS 里匹配结果 \`m[1]\` 按序号取、\`m.groups\` 按名取；替换串用 \`$1\` \`$2\` 引用捕获。`
  },
  {
    slug: 'non-capturing',
    name: '非捕获组 (?:...)',
    summary: '只分组不捕获',
    keywords: ['non-capturing', '非捕获'],
    copyText: '(?:\\d+)',
    md: `\`(?:)\` 分组但不占用组号，省内存也不打乱既有组序号。

\`\`\`
/(?:https?|ftp):\\/(\\S+)/    协议不捕获，域名是 $1
\`\`\``
  },
  {
    slug: 'named-group',
    name: '命名分组 (?<name>...)',
    summary: '按名字取捕获',
    keywords: ['named group', '命名分组'],
    copyText: '(?<year>\\d{4})',
    md: `\`\`\`js
const m = '2024-06-01'.match(/(?<year>\\d{4})-(?<month>\\d{2})/)
m.groups.year    // "2024"
m.groups.month   // "06"

'2024-06-01'.replace(/(?<y>\\d{4})-(?<m>\\d{2})/, '$<m>/$<y>')   // "06/2024"
\`\`\``
  },
  {
    slug: 'backreference',
    name: '反向引用 \\1',
    summary: '引用前面的捕获组',
    keywords: ['backreference', '反向引用', '重复词'],
    copyText: '(\\w+)\\s+\\1',
    md: `组号或组名再引用一次，要求**内容一致**。

\`\`\`
/<(\\w+)>.*?<\\/\\1>/     标签配对
/(\\w+) \\1/            "the the" 重复单词
/(?<q>["'])\\w+\\k<q>/   引号成对（命名引用）
\`\`\``
  },
  {
    slug: 'alternation',
    name: '交替 |',
    summary: '多分支或',
    keywords: ['alternation', '或', '分支'],
    copyText: 'cat|dog',
    md: `左侧优先，从左到右尝试分支。

\`\`\`
/cat|dog|bird/
/(?:https?|ftp)/     用非捕获组包住限定范围
\`\`\`

注意 \`|\` 的作用域到分组或整条模式，想限定范围要加括号。`
  },
  {
    slug: 'lookahead',
    name: '先行断言 (?=) (?!)',
    summary: '向后看零宽：后面是/不是',
    keywords: ['lookahead', '前瞻', '断言'],
    copyText: '(?=...)',
    md: `只判断不消费字符。

\`\`\`
/\\d+(?=元)/        数字后面跟"元"才命中，"元"不进结果
/\\b(?!\\d)\\w+/     词首不是数字
/(?=.*[A-Z])(?=.*\\d).{8,}/   必含大写且含数字的 8 位以上密码
\`\`\``
  },
  {
    slug: 'lookbehind',
    name: '后行断言 (?<=) (?<!)',
    summary: '向前看零宽：前面是/不是',
    keywords: ['lookbehind', '后顾', '后行断言'],
    copyText: '(?<=...)',
    md: `\`\`\`
/(?<=\\$)\\d+/       $100 里只取 100（$ 不消费）
/(?<!\\d)\\d{3}(?!\\d)/   恰三位数字（前后都不是数字）
/(?<!unk)def/       不是 unk 开头的 def
\`\`\`

Safari 16.4+ 才支持，目标环境需确认。`
  },
  {
    slug: 'flags',
    name: '标志 g i m s u y',
    summary: '全局/忽略大小写/多行/点号跨行/Unicode/粘性',
    keywords: ['flags', '标志', 'global', 'ignore case'],
    copyText: 'gimsuy',
    md: `| 标志 | 含义 |
|---|---|
| \`g\` | 全局（match 返回全部；exec 续读） |
| \`i\` | 忽略大小写 |
| \`m\` | ^ $ 按行匹配 |
| \`s\` | \`.\` 也匹配换行 |
| \`u\` | Unicode 模式（\\p{}、代理对按字符） |
| \`y\` | 粘性：从 lastIndex 精确匹配 |

\`\`\`js
/[a-z]+/gi
\`\`\``
  },
  {
    slug: 'escape',
    name: '转义 \\',
    summary: '特殊字符按字面匹配',
    keywords: ['escape', '转义'],
    copyText: '\\.',
    md: `需要转义的特殊字符：\`. * + ? ^ $ ( ) [ ] { } | \\\`

\`\`\`
/3\\.14/     匹配 "3.14" 而非 "3x14"
/\\(tip\\)/   匹配 "(tip)"
\`\`\`

动态拼正则时先转义：\`s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')\`。`
  },
  {
    slug: 'multiline-trick',
    name: '跨行匹配技巧',
    summary: '[\\s\\S] 替代 . 实现跨行',
    keywords: ['跨行', 'multiline', '换行'],
    copyText: '[\\s\\S]*?',
    md: `不想开 \`s\` 标志时，\`[\\s\\S]\` 匹配含换行的任意字符。

\`\`\`
/<script>[\\s\\S]*?<\\/script>/   跨行脚本块
\`\`\``
  },
  {
    slug: 'chinese-match',
    name: '匹配中文',
    summary: 'Unicode 脚本属性或码点区间',
    keywords: ['中文', 'chinese', '汉字'],
    copyText: '\\p{Script=Han}+',
    md: `\`\`\`js
// 推荐：u 标志 + 脚本属性
/\\p{Script=Han}+/u.test('你好abc')    // true

// 传统码点区间
/[\\u4e00-\\u9fa5]/       基本区
/[\\u4e00-\\u9fff\\u3400-\\u4dbf]/  含扩展A
\`\`\``
  },
  {
    slug: 'email-regex',
    name: '常用示例：邮箱',
    summary: '宽松实用的邮箱校验',
    keywords: ['邮箱', 'email', '校验'],
    copyText: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
    md: `严格 RFC 邮箱正则极复杂且没必要，实用宽松版：

\`\`\`js
/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test('a@b.com')   // true
\`\`\`

真要确认邮箱可达，发验证邮件是唯一可靠方案。`
  },
  {
    slug: 'url-regex',
    name: '常用示例：URL',
    summary: '提取 http(s) 链接',
    keywords: ['url', '链接', '网址'],
    copyText: 'https?:\\/\\/[^\\s<>"\']+',
    md: `\`\`\`js
const text = '见 https://a.com/x?q=1 说明'
text.match(/https?:\\/\\/[^\\s<>"']+/g)
\`\`\`

按需调整排除字符集；严格 URL 解析请用 \`new URL()\`。`
  }
]

export default entries
