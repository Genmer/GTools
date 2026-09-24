# 主流语言命名约定调研（预设数据）

> 调研日期：2026-09-24。目的：为「命名规范」类功能提供可落成预设数据的结构化结论。
> 依据标注说明：每条结论后带来源编号（S1–S24，见文末清单）。
> - **[官方]** = 本会话直读官方/权威原文并摘引；
> - **[主流]** = 广泛采用但无官方强制条文的惯例；
> - **[搜索佐证]** = 官方原文因网络原因未能直连，经多个搜索结果一致确认；
> - **[未证实]** = 无法在本次调研中验证，工程引用前需自行确认。
> 风格记号：`camelCase`（小驼峰）、`PascalCase`（大驼峰/UpperCamelCase/CapWords/StudlyCaps 同义）、`snake_case`、`SCREAMING_SNAKE_CASE`（全大写下划线）、`kebab-case`（连字符）、`kCamelCase`（k 前缀驼峰，C++ Google 流派常量）。

---

## 1. 跨语言总对照矩阵（核心预设数据）

| 语言 | 变量 | 函数/方法 | 类/类型 | 常量 | 文件名 | 包/模块/命名空间 |
|---|---|---|---|---|---|---|
| JavaScript | camelCase | camelCase | PascalCase | SCREAMING_SNAKE（仅模块级） | 全小写，`_` 或 `-` 分词 | npm 包名禁大写；包名 lowerCamelCase |
| TypeScript | camelCase | camelCase | PascalCase | SCREAMING_SNAKE（仅模块级/枚举值） | snake_case（Google 版） | 同 npm |
| Python | snake_case | snake_case | CapWords | SCREAMING_SNAKE | snake_case（=模块名） | 全小写；模块可 `_`，包不鼓励 |
| Java | camelCase | camelCase | PascalCase | SCREAMING_SNAKE | `类名.java`（语言强制） | 全小写连续单词，无 `_` |
| Kotlin | camelCase | camelCase | PascalCase | SCREAMING_SNAKE | PascalCase`.kt` | 全小写，不用 `_` |
| Go | mixedCaps | MixedCaps/mixedCaps | MixedCaps（无 class） | MixedCaps（**不**用 SCREAMING） | 小写下划线 [主流] | 全小写单层，无 `_` 无 camel |
| Rust | snake_case | snake_case | UpperCamelCase | SCREAMING_SNAKE | snake_case（=模块路径） | 模块 snake_case；crate 大小写官方标 unclear |
| C# | camelCase 参数；私有字段 `_camelCase` [主流] | PascalCase | PascalCase（接口 `I` 前缀） | PascalCase | PascalCase [主流] | PascalCase（namespace） |
| C++（Google 流派） | snake_case（类成员尾 `_`） | PascalCase（accessor 可 snake） | PascalCase | kCamelCase | 全小写 `_`/`-` | namespace snake_case |
| C++（LLVM 流派） | CamelCase（**首字母大写**） | camelCase（首字母小写） | CamelCase | `MaxSize = 42`（无前缀） | — | — |
| PHP | 不规定（PSR 故意留白） | camelCase | PascalCase | SCREAMING_SNAKE（类常量） | `类名.php`（PSR-4） | `Vendor\Namespace` PascalCase |
| Ruby | snake_case | snake_case（`?`/`!` 后缀） | CamelCase | SCREAMING_SNAKE | snake_case`.rb` | snake_case（=目录名） |
| Swift | camelCase | camelCase | PascalCase | **camelCase**（连全局常量也是） | PascalCase`.swift` | —（模块=target 名） |
| CSS | — | — | — | — | kebab-case [主流] | — |
| BEM 类名 | — | — | — | — | — | — |
| SQL | 列 snake_case [主流] | — | 表 snake_case [主流] | — | 迁移脚本 [主流] snake/kebab | schema snake_case [主流] |
| Shell | snake_case | snake_case（库用 `::`） | — | SCREAMING_SNAKE（readonly/导出） | 全小写 `_` | — |

---

## 2. 各语言明细（每语言一节预设表）

### 2.1 JavaScript（依据：Google JavaScript Style Guide [S16，官方直读]）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 局部变量 | lowerCamelCase | `userName` | §6.2.8 |
| 函数/方法 | lowerCamelCase | `sendMessage` | §6.2.3 |
| 类/接口/record/typedef | UpperCamelCase | `ImmutableList` | §6.2.2 |
| 枚举 | 名 PascalCase + 值 CONSTANT_CASE | `enum Color { RED }` | §6.2.4 |
| 常量（模块级 const，深不可变） | CONSTANT_CASE（SCREAMING_SNAKE） | `MAX_RETRY` | §6.2.5 |
| 函数内 const | 保持 lowerCamelCase | `const prefix = ...` | §6.2.8 |
| 参数 | lowerCamelCase | `pageSize` | §6.2.7 |
| 文件名 | 全小写，`_` 或 `-` 分词均可，无其他标点 | `make_template.js` | §2.1 |
| 包名 | lowerCamelCase（或 TS 路径式小写下划线） | `myPackage` | §6.2.1 |
| npm 包名 | 禁大写字母 | `my-tool` | npm 官方 [S21，官方直读] |

同语言内多上下文差异：模块级常量 SCREAMING vs 函数内 const camelCase（§6.2.5.1 明确"局部 const 不是常量"）；枚举名 PascalCase 而枚举项 SCREAMING。

### 2.2 TypeScript（依据：Google TypeScript Style Guide [S17，官方直读]）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 变量/参数/函数/方法/属性 | lowerCamelCase | `loadHttpUrl` | Rules 表 |
| class/interface/type/enum/decorator/类型参数 | UpperCamelCase | `HttpClient`、`TSession` | Rules 表 |
| 全局常量 + 枚举值 | CONSTANT_CASE | `MAX_COUNT` | "Only symbols declared on the module level…" |
| 局部 const | 必须 lowerCamelCase | `const maxCount = 3` | 同上 |
| 文件名 | snake_case | `string_utils.ts` | "files are snake_case"（import 规则节） |

特别规则：**明令禁止 `_` 前缀/后缀**私有成员（与 C++/Python 相反）；缩写词按单词处理 `loadHttpUrl` 而非 `loadHTTPURL`；测试名允许 `testX_whenY_doesZ()` 结构化下划线。
[未证实] TS 官方 handbook 无命名专章；社区文件名实践多样（Angular kebab-case、React 组件 PascalCase.tsx），Google 版为 snake_case。

### 2.3 Python（依据：PEP 8 [S1，官方直读]）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 变量/函数/方法 | lower_case_with_underscores | `max_overflow` | "Function and Variable Names" |
| 类 | CapWords（PascalCase）；异常加 `Error` 后缀 | `HttpRequest`、`TimeoutError` | "Class Names" / "Exception Names" |
| 常量 | 全大写下划线 | `MAX_OVERFLOW`、`TOTAL` | "Constants" |
| 模块名 | 全小写，可用 `_` | `string_utils` | "Package and Module Names" |
| 包名 | 全小写，**不鼓励** `_` | `myplugin` | 同上 |
| 非公开成员 | 单 `_` 前缀；双 `__` 触发 name mangling | `_cache`、`__internal` | "Descriptive: Naming Styles" |
| 关键字冲突 | 尾 `_` | `class_`（好于 `clss`） | "Function and Method Arguments" |

禁则：不用 `l`/`O`/`I` 单字符名；不发明双前后下划线魔法名。

### 2.4 Java（依据：Google Java Style Guide [S7，官方直读]；Oracle 官方 Code Conventions [S25] 因 oracle.com 超时未直读——其规则与 Google 版一致的部分以 Google 版为准）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 局部变量/字段/参数 | lowerCamelCase | `computedValues` | §5.2.5–5.2.7 |
| 方法 | lowerCamelCase | `sendMessage` | §5.2.3 |
| 类/接口 | UpperCamelCase，名词 | `ImmutableList`；测试类 `*Test` | §5.2.2 |
| 常量（static final 深不可变） | UPPER_SNAKE_CASE | `NUMBER`、`COMMA_JOINER` | §5.2.4 |
| 包名 | 全小写、无下划线、直接连接 | `com.example.deepspace` | §5.2.1 |
| 文件名 | 顶层类名（大小写敏感）+ `.java`，一个文件恰好一个顶层类 | `MyClass.java` | §2.1 |
| 类型变量 | 单大写字母（`E`/`T`/`K`/`V`）或 `RequestT` | `<K, V>` | §5.2.8 |

特别规则：非 `static final` 深不可变者不算常量（`static final Set mutableCollection` 不用 SCREAMING）；缩写词转驼峰时按词首大写：`XmlHttpRequest`、`supportsIpv6OnIos`（§5.3）；禁 `name_`/`mName`/`s_name`/`kName` 前后缀（§5.1）。

### 2.5 Kotlin（依据：官方 Coding Conventions [S2，官方直读]）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 函数/属性/局部变量 | camelCase，无下划线 | `processDeclarations()` | "Naming rules" |
| 类/对象 | upper camel case | `DeclarationProcessor` | 同上 |
| 文件名 | upper camel case + `.kt`；多平台后缀 `.jvm.kt` | `ProcessDeclarations.kt` | 同上 |
| 常量（const / 顶层 val 深不可变） | SCREAMING_SNAKE_CASE | `const val MAX_COUNT = 8` | 同上 |
| 枚举值 | SCREAMING_SNAKE 或 PascalCase 皆可 | `RED` | 同上 |
| 包名 | 全小写、不用下划线 | `org.example.project` | 同上 |
| 私有后备属性 | `_` 前缀 | `_elementList` | "Backing properties" |

特别规则：返回抽象类型的工厂函数可用 PascalCase（`fun Foo(): Foo`）；`@Composable` 函数 PascalCase；缩写词两字母全大写 `IOStream`、三字母以上仅首字母大写 `XmlFormatter`；测试允许反引号带空格名。

### 2.6 Go（依据：Go Blog "Package Names" [S4，官方直读] + Google Go Style Guide Guide/Decisions [S5][S6，官方直读]）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 变量（局部） | mixedCaps（首字母小写） | `maxLength` | [S5] Naming |
| 函数/方法/类型/常量（导出） | MixedCaps（**首字母大写 = 导出**） | `MaxLength` | [S5] "a constant is MaxLength (not MAX_LENGTH) if exported…" |
| 常量 | MixedCaps，**禁止** `MAX_PACKET_SIZE`/`kMaxBufferSize` | `MaxAllowedConnections` | [S6] "Constant names" |
| 包名 | 全小写、无下划线、无 camel、简短名词 | `strconv`（非 `priority_queue`/`computeServiceClient`） | [S4] |
| 接收者变量 | 1–2 字母、类型缩写、全类型一致、禁 `this`/`self` | `func (t *Tray)` | [S6] "Receiver names" |
| 文件名 | 小写下划线 | `net_http.go` | [主流]，官方无专门条文 |
| Getter | **无** Get 前缀 | `Counts` 非 `GetCounts`；开销大用 `Compute`/`Fetch` | [S6] "Getters" |

特别规则：初始缩写词整体同大小写——导出 `URL`/`ID`/`DB`、未导出 `url`/`id`，**绝不 `Url`/`Id`**（[S6] Initialisms）；名字一般不含下划线（仅 `*_test.go`、生成代码等例外）；包名与导出符号不重复（`http.Server` 非 `http.HTTPServer`，[S4]）；"local variables are considered unexported"（[S5]）。
[未证实] Effective Go [S26] 因 go.dev 超时未直读；「接口以方法名 `-er` 命名（`Reader`）」出自该文，本次未验证原文。

### 2.7 Rust（依据：Rust API Guidelines（RFC 430 系）[S3，官方直读]）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 局部变量/函数/方法/模块/宏 | snake_case | `btree_map`、`is_xid_start()` | C-CASE |
| 类型/trait/枚举变体 | UpperCamelCase | `HttpServer`；**缩写按一个词：`Uuid` 非 `UUID`** | C-CASE |
| 常量 const / 静态 static | SCREAMING_SNAKE_CASE | `MAX_LEVELS` | C-CASE |
| 生命周期 | 短小写，常单字母 | `'a`、`'src` | C-CASE |
| 类型参数 | 单大写或 UpperCamelCase | `T` | C-CASE |
| crate 名 | **官方标 [unclear]**（原文自注 issue #29） | `serde`（生态实践全小写连字符 [主流]） | C-CASE |
| 文件名 | = 模块路径 → snake_case | `string_utils.rs` | 由"modules snake_case"+模块即文件推出 [推断] |

特别规则：snake_case 中单词不拆单字母（`btree_map` 非 `b_tree_map`，除非是末词）；crate 名禁 `-rs`/`-rust` 后缀；feature 名大小写官方也标 unclear、且禁否定式（`no-abc`）。

### 2.8 C#（依据：MS Learn《Framework Design Guidelines》[S12][S13，官方直读]）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 命名空间/类型/接口/方法/属性/事件/公有字段/枚举值 | PascalCase | `StreamReader`、`ToString()`、`FileMode.Append` | [S12] 大小写表 |
| 参数 | camelCase | `ToInt32(string value)` | [S12] "camelCasing… used only for parameter names" |
| 接口 | `I` 前缀 | `IComponent`、`IPersistable` | [S13] "DO prefix interface names with the letter I" |
| 泛型参数 | 描述名 `T` 前缀或单字母 `T` | `TSession` | [S13] |
| 常量（const） | PascalCase | `public const Min = 0;` | [S12] Field 行示例 |
| 私有字段 | `_camelCase` | `_elementList` | [主流]（Roslyn/微软自家代码广泛使用；本次两个官方页 404，未读到官方条文 [未证实]） |
| 文件名 | PascalCase（=主类型名） | `MainWindow.xaml.cs` | [主流] |
| 命名空间 | PascalCase | `System.Security` | [S12] |

特别规则：**两字母缩写全大写 `IOStream`，≥3 字母仅首大写 `XmlTag`**（[S12]）；闭合复合词当一个词（`FileName`/`UserName`，禁 `Filename`/`ID`——`Id` 才对，与 Go 的 `ID` 针锋相对）；禁匈牙利；公共标识符禁下划线（私有字段 `_` 是社区现实与官方公共 API 规则的分层差异）；Attribute/Exception/EventArgs/Collection 等后缀有专门表格（[S13]）。

### 2.9 C/C++（依据：Google C++ Style Guide [S18，官方直读] + LLVM Coding Standards [S19，官方直读]。两流派差异显著，预设需按项目选定）

Google 流派：

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 类型（class/struct/enum/alias/模板类型参数） | PascalCase | `UrlTable` | "Type Names" |
| 函数 | PascalCase；accessor/mutator 可 snake_case | `AddTableEntry()`；`int count()` / `set_count()` | "Function Names" |
| 变量（含参数） | snake_case | `table_name` | "Variable Names" |
| 类数据成员 | snake_case + **尾 `_`**（struct 成员无尾 `_`） | `table_name_` | "Class Data Members" |
| 常量（const/constexpr/static 存储期） | **kCamelCase** | `kDaysInAWeek`、`kAndroid8_0_0` | "Constant Names" |
| 枚举值 | 按常量命名 `kEnumName`，**不按宏** | `kOk`、`kOutOfMemory` | "Enumerator Names" |
| 宏 | UPPER_SNAKE + 项目前缀 | `MYPROJECT_ROUND(x)` | "Macro Names" |
| 命名空间 | snake_case（全小写） | `namespace my_lib` | "Namespace Names" |
| 文件名 | 全小写，`_` 或 `-`，`.cc`/`.h` | `my_useful_class.cc` | "File Names" |

LLVM 流派（[S19]，同一语言的另一权威标准）：类型 CamelCase（`TextFileReader`）；**变量 CamelCase 首字母大写**（`Leader`、`Boats`）；函数 camelCase 首字母小写（`isLValue()`、`openFile()`）；枚举器大写带前缀（`VK_Argument`）或裸常量（`MaxSize = 42`）；仿 STL 的类可全 snake_case（`begin()`/`push_back()`）。C 标准库本身全 snake_case（`isalpha`、`size_t`）[通识，未逐条验证]。

### 2.10 PHP（依据：PSR-1 [S8]、PSR-12 [S9]，PHP-FIG 官方，直读）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 类 | StudlyCaps（=PascalCase） | `MyClass` | PSR-1 §1 |
| 类常量 | 全大写下划线分隔 | `DATE_APPROVED` | PSR-1 §4.1 |
| 方法 | camelCase | `getName()` | PSR-1 §4.3 |
| 属性 | **PSR-1 故意不做规定**（三选一均可，须一致） | `$studlyCaps`/`$camelCase`/`$under_score` | PSR-1 §4.2 原文 |
| 可见性前缀 | 禁止单 `_` 前缀表示 protected/private | — | PSR-12 §4.3/4.4 |
| 关键字/类型 | 全小写，用短形式 | `bool` 非 `boolean` | PSR-12 §2.5 |
| 命名空间 | 跟随 autoload 结构（PSR-4） | `Vendor\Sub\Model`（PascalCase） | PSR-1 §3 |
| 文件名 | 类名结尾 + `.php`（PSR-4 autoloading 要求） | `MyClass.php` | PSR-1 §3 推导；PSR-4 原文未直读 |

### 2.11 Ruby（依据：community Ruby Style Guide rubystyle.guide [S14，直读]）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 变量/symbol/方法 | snake_case | `some_var1`（数字紧跟字母） | "Naming" 节 |
| 类/模块 | CamelCase；缩写保持全大写 | `SomeXML` 非 `SomeXml` | 同上 |
| 常量（非类模块） | SCREAMING_SNAKE_CASE | `SOME_CONST = 5` | 同上 |
| 文件/目录 | snake_case，类即文件 | `hello_world.rb` | 同上 |
| 谓词方法 | `?` 后缀，禁 `is_`/`does_` 前缀 | `empty?` 非 `is_empty` | 同上 |
| 危险方法 | `!` 后缀（仅存在安全版时） | `sort` / `sort!` | 同上 |
| setter | `name=` 而非 `set_name`；getter 无 `get_` | — | 同上 |
| 未用变量 | `_` 前缀 | `_k` | 同上 |

### 2.12 Swift（依据：Swift API Design Guidelines [S10，官方直读] + Google Swift Style Guide [S11，官方直读]）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 类型/协议 | UpperCamelCase；其余一切 lowerCamelCase | `RadarScanner` | [S10] "Names of types and protocols are UpperCamelCase. Everything else is lowerCamelCase." |
| 变量/函数/方法 | lowerCamelCase | `enjoysScubaDiving` | [S10] |
| 全局常量 | **lowerCamelCase**，禁 `g`/`k` 匈牙利前缀 | `maxRetryCount` | [S11] "Like other variables, global constants are lowerCamelCase." |
| 枚举 case | lowerCamelCase | `.red` | [S11] |
| 文件名 | 主类型名；协议扩展 `MyType+MyProtocol.swift` | `MyViewController+UITableViewDataSource.swift` | [S11] File Names |
| 缩写词 | 通用全大写词统一升/降格 | `utf8` / `URL`（`URL.CodeUnit`） | [S10] |

特别规则：可变/不可变方法对 `sort()`/`sorted()`、`formUnion`；工厂 `make` 前缀；布尔读作断言 `isEmpty`；能力型协议 `-able`/`-ible`/`-ing` 后缀、名词型协议用名词（`Collection`）。

### 2.13 CSS（含 BEM）（依据：Google HTML/CSS Style Guide [S20，官方直读]；BEM 官方 [S24] 因 bem.info 404 / getbem.net DNS 失败，经搜索多源佐证）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 类名 | kebab-case（连字符分词） | `.video-id` 非 `.error_status`/`.demoimage` | [S20] "Separate words in class names by a hyphen." |
| ID | 尽量不用；必须用则含连字符（防成 JS 全局属性） | `user-profile` | [S20] |
| 选择器 | 优先类选择器，避免 ID/类型限定 | `.error {}` 非 `div.error {}` | [S20] |
| CSS 自定义属性 | `--kebab-case` | `--main-bg-color` | [主流] [未证实官方条文] |
| 文件名 | 无官方规定（Google 指南未涉及） | 惯例 kebab-case | [未证实] |

BEM（`__` 元素、`--` 修饰符，两版本流派）：

| 结构 | 语法 | 示例 |
|---|---|---|
| 块 | `block`（kebab） | `.card` |
| 元素 | `block__element`（双下划线） | `.card__title` |
| 修饰符（社区流行版，getbem） | `block--mod` / `block__elem--mod`（双连字符） | `.card--featured` |
| 修饰符（Yandex 经典版） | `block_mod[_val]`（单下划线） | `.card_featured` |

[搜索佐证] 官方站点本次均未能直连；「双下划线分隔元素」各源一致，「修饰符分隔符」存在上述两流派，工程预设建议取 `--` 流行版并注明。

### 2.14 SQL（无任何官方统一 style guide——预设只能基于方言行为 + 主流惯例）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 表/列/索引 | snake_case | `user_account`、`created_at` | [主流]，无官方规范 |
| 表名单复数 | 社区分歧，无标准 | `users` vs `user` | [未证实/无共识] |
| 关键字 | 大写惯例 | `SELECT … FROM` | [主流] |
| 布尔列 | `is_`/`has_` 前缀惯例 | `is_active` | [主流] |
| 主键 | `id`；外键 `<表单数>_id` | `user_id` | [主流] |

方言大小写行为（这是硬规则，非约定）：
- **PostgreSQL**：未加引号标识符一律**折叠为小写**（与 SQL 标准折叠为大写相反）；双引号 `"Name"` 保留大小写且区分。所以实际效果是「不引号就等于全小写」。[搜索佐证]（postgresql.org 本机超时未直读；多个二手源与邮件列表一致确认）[S22]
- **MySQL**：列名/索引/存储例程/别名**任何平台都不区分大小写**；表名/库名大小写敏感性取决于 `lower_case_table_names` 与 OS 文件系统（Linux 默认敏感、Windows/macOS 不敏感）。[搜索佐证]（官方 11.2.3 节内容经搜索确认，dev.mysql.com 超时未直读）[S23]

### 2.15 Shell / Bash（依据：Google Shell Style Guide [S15，官方直读]）

| 上下文 | 风格 | 示例 | 依据 |
|---|---|---|---|
| 函数名 | 小写 + 下划线；库用 `::` 分层 | `make_template`、`lib::func` | Naming 节 |
| 变量名 | 同函数（小写下划线） | `zone` | 同上 |
| 常量/导出到环境的变量 | **全大写下划线**，文件顶部声明，立即 `readonly`/`declare -xr` | `readonly PATH_TO_FILES=…` | 同上 |
| 文件名 | 全小写下划线 | `make_template`（可 `maketemplate`，**禁** `make-template`） | 同上 |
| 循环变量 | 与被循环对象对应 | `for zone in "${zones[@]}"` | 同上 |

camelCase 在该指南中从未被允许（以 snake_case 全面替代）。

---

## 3. 「同一语言内多上下文风格不同」汇总（工程预设最易踩的点）

1. **常量 vs 变量不同风格**（最多语言）：Python、Java、Kotlin、Rust、Ruby、JS、TS、PHP、Shell 中常量 SCREAMING_SNAKE 而变量/函数 camel/snake；函数内 const 在 JS/TS 中**不升级**为 SCREAMING（仅模块级）。
2. **类/类型 vs 函数/变量不同风格**：几乎所有 PascalCase 类语言（Python/JS/TS/Java/Kotlin/Rust/Ruby/PHP/Swift）类型 Pascal、成员小写。
3. **Go：风格不区分上下文，但大小写承载导出语义**——同一 `MixedCaps` 家族里 `MaxLength`（导出）/`maxLength`（未导出）是不同可见性；常量**不**用 SCREAMING（官方明说"即使与其他语言惯例冲突"）。
4. **C++（Google）：四种风格并存**——类型/函数 Pascal、变量 snake、常量 `k`Camel、宏 SCREAMING；类成员尾 `_` 而 struct 成员无。
5. **Kotlin：常规成员 camelCase，但常量 SCREAMING、后备属性 `_` 前缀、测试可反引号带空格**。
6. **JS/TS：枚举名 Pascal 而枚举值 SCREAMING**；Google JS 允许文件名 `-` 或 `_`，Google TS 却规定文件 snake_case（同公司两指南不同）。
7. **PHP：类 Pascal、方法 camel、类常量 SCREAMING、属性官方不规定**（一语言内四种答案）。
8. **Shell：函数/变量 snake，但常量与导出环境变量必须 SCREAMING**。
9. **Ruby：常量 SCREAMING 但类/模块也是常量、用 CamelCase**——"SCREAMING 仅指非类模块常量"（原文如此）。
10. **BEM：一条类名内三层语法叠加**——`__` 分隔元素、`--` 分隔修饰符、块内多词仍用单连字符。

## 4. 「语言之间确实不同」汇总（跨语言差异硬点）

1. **常量风格三派**：SCREAMING_SNAKE（Python/Java/Kotlin/Rust/Ruby/JS/TS/PHP/shell、C 宏）vs MixedCaps（Go `MaxLength`）vs camel/Pascal（Swift `camelCase`、C# Pascal、C++ Google `kDaysInAWeek`）——Go 与 Swift 是与"常识"最相反的两个。
2. **变量/函数两大派**：snake_case（Python/Rust/Ruby/shell/PHP 变量惯例、Google C++）vs camelCase（JS/TS/Java/Kotlin/Swift/C#/Go/PHP 方法、LLVM C++）。
3. **导出/可见性编码方式**：Go 首字母大写=导出（编译器语义）；Rust/Python `snake`+`_` 前缀=私有（约定级，Rust 有 lint）；Java/Kotlin/Swift/C# 用关键字（`public`/`pub`/`export`）与命名完全解耦；TS 明令禁止 `_` 前缀。
4. **包/命名空间命名互斥**：Java/Kotlin 全小写**无**下划线 vs Python 模块可下划线 vs Go 禁下划线禁驼峰（单词或 `strconv` 式缩写）vs C#/PHP 命名空间 PascalCase vs npm 禁大写允许 `-`。
5. **文件名三派**：Pascal（Java=类名强制、Kotlin、Swift、C# 惯例）vs snake（Python/Ruby/Rust/Google C++/shell/Google TS/Go 惯例）vs kebab（CSS/HTML、Google JS 二选一允许）。
6. **缩写词大小写四派**：Go 整体同格（`URL`/`url`，禁 `Url`）；C# 两字母全大写 `IOStream`、三字母以上 `XmlTag` 且 `Id` 不写 `ID`；Rust 完全单词化 `Uuid`；Swift 按通用度统一（`URL` vs `utf8`）。同一缩写在 Go 是 `ID`、在 C# 是 `Id`、在 Rust 是 `Uuid`。
7. **Getter 约定相反**：JS/Java/C# 惯例 `getFoo`；Go 明令禁 Get 前缀（`Counts`）；Ruby `name`/`name=`；Swift 直接属性。
8. **布尔命名**：JS `isFoo`/`hasFoo`（Google JS §6.2.3）vs Ruby `foo?` 且明令禁 `is_` 前缀 vs Swift 断言式 `isEmpty`（无 is 也无 ?）。
9. **私有成员标记相反**：C++（Google）类成员**尾**下划线、Python/Kotlin 头下划线、TS 禁下划线、C# 私有字段 `_camelCase`（社区）vs 公共禁下划线（官方）。
10. **SQL 标识符折叠**：PostgreSQL 未引号折叠**小写**（与 SQL 标准折叠大写相反）、MySQL 列名天然不区分大小写——跨方言迁移时 `UserName`/`username`/`"UserName"` 行为完全不同。

## 5. 来源清单

**本会话直读原文（一手）**：
- [S1] PEP 8 — https://peps.python.org/pep-0008/
- [S2] Kotlin Coding Conventions — https://kotlinlang.org/docs/coding-conventions.html
- [S3] Rust API Guidelines: Naming — https://rust-lang.github.io/api-guidelines/naming.html
- [S4] Go Blog: Package Names — https://go.dev/blog/package-names
- [S5] Google Go Style Guide (Guide) — https://google.github.io/styleguide/go/guide.html
- [S6] Google Go Style Guide (Decisions) — https://google.github.io/styleguide/go/decisions.html
- [S7] Google Java Style Guide — https://google.github.io/styleguide/javaguide.html（§2.1、§5）
- [S8] PSR-1 — https://www.php-fig.org/psr/psr-1/
- [S9] PSR-12 — https://www.php-fig.org/psr/psr-12/
- [S10] Swift API Design Guidelines — https://www.swift.org/documentation/api-design-guidelines/
- [S11] Google Swift Style Guide — https://google.github.io/swift/
- [S12] MS Learn: Capitalization Conventions — https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/capitalization-conventions
- [S13] MS Learn: Names of Classes, Structs, and Interfaces — https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/names-of-classes-structs-and-interfaces ；General Naming Conventions — https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/general-naming-conventions
- [S14] Ruby Style Guide — https://rubystyle.guide/
- [S15] Google Shell Style Guide — https://google.github.io/styleguide/shellguide.html
- [S16] Google JavaScript Style Guide — https://google.github.io/styleguide/jsguide.html
- [S17] Google TypeScript Style Guide — https://google.github.io/styleguide/tsguide.html
- [S18] Google C++ Style Guide（Naming 节，curl 抓取原文解析）— https://google.github.io/styleguide/cppguide.html
- [S19] LLVM Coding Standards（curl 抓取原文解析）— https://llvm.org/docs/CodingStandards.html
- [S20] Google HTML/CSS Style Guide — https://google.github.io/styleguide/htmlcssguide.html
- [S21] npm Package Name Guidelines — https://docs.npmjs.com/package-name-guidelines

**搜索佐证（官方原文未直连成功）**：
- [S22] PostgreSQL Identifiers（postgresql.org 超时；折叠小写规则经搜索多源确认）
- [S23] MySQL 11.2.3 Identifier Case Sensitivity（dev.mysql.com 超时；内容经搜索确认）
- [S24] BEM 官方（bem.info 404 / getbem.net DNS 失败；`__`/`--` 结构经 CSS-Tricks、BigBinary、GitHub cheatsheet 等多源一致）

**未读到、相关条目已在上文标注**：
- [S25] Oracle Java Code Conventions（oracle.com 超时）
- [S26] Effective Go（go.dev/doc/effective_go 超时；接口 `-er` 规则未证实）
