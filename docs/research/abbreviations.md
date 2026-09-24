# 变量缩写与中英技术命名对照词典（调研稿）

> 调研日期 2026-09-24。目标：为「缩写/术语手册」类插件提供可直接落库的词典数据。
> 三级可信度：**[S1] 官方风格指南 / 权威文档**、**[S2] 社区高星仓库 / 广泛共识**、**[S3] 惯例归纳（未逐项检索佐证，标注「未证实」）**。

## 来源清单

| 编号 | 来源 | 可信度 | 内容 |
|---|---|---|---|
| A1 | [abbrcode/abbreviations-in-code](https://github.com/abbrcode/abbreviations-in-code)（569★，MIT，280 条） | S2 | 编程常用缩写全集，带推荐度：🟢 推荐 / 🟡 上下文敏感 / 🔴 不推荐（应写全称） |
| A2 | [kettanaito/naming-cheatsheet](https://github.com/kettanaito/naming-cheatsheet)（13k★+） | S2 | 布尔 is/has/should 前缀；函数动词 get/set/reset/remove/delete/compose/handle；min/max/prev/next |
| A3 | [Microsoft .NET Framework Design Guidelines — Names of Type Members](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/names-of-type-members) | S1 | 布尔属性可选 Is/Can/Has 前缀，仅在有价值时使用 |
| A4 | [Swift API Design Guidelines](https://www.swift.org/documentation/api-design-guidelines/) | S1 | 布尔读作断言（isEmpty、intersects）；工厂 make 前缀；变异 form 前缀；非变异 -ed/-ing 后缀 |
| A5 | [Google Java Style Guide §5.3](https://google.github.io/styleguide/javaguide.html) | S1 | 缩略词当普通词写：`XmlHttpRequest` ✓、`XMLHTTPRequest` ✗、`supportsIpv6` |
| A6 | [Tips on naming boolean variables (dev.to)](https://dev.to/cleanercode/tips-on-naming-boolean-variables-2dh9) | S2 | 布尔动词全集：is/are/has/was/did/will/should/must/can |
| A7 | [Microsoft Writing Style Guide](https://learn.microsoft.com/style-guide/) + [Windows UX Property Windows](https://learn.microsoft.com/en-us/windows/win32/ctrl/property-sheets) | S1 | settings 首选；options 仅当 UI 如此命名；preferences 属 Apple 惯例；常用自定义摘要用 Personalize |
| A8 | [Google Drive 桌面版配置文档](https://knowledge.workspace.google.com/admin/drive/advanced-drive-for-desktop-configuration) | S1 | user settings / preferences / host settings 层级用法实例 |
| A9 | [Why You Should Avoid Prefixing Boolean Variables with "is" (Stackademic)](https://blog.stackademic.com/) | S2 | 反例警示：Java/Jackson `is` 前缀导致 JSON 字段名与 setter 失配 |
| A10 | [C2 Wiki — Good Variable Names](https://wiki.c2.com/GoodVariableNames) | S2 | 反缩写派：能写全称就写全称（index/count/each） |
| L1 | 本仓库 grep 统计（2026-09-24，`grep -rhoE ... src/ sdk/`，词边界精确匹配） | 本地事实 | err 319 / ctx 301 / props 176 / res 133 / next 124 / src 100 / init 89 / cur 87 / env 75 / req 56 / deps 55 / msg 54 / idx 52 / config 45 / str 35 / obj 32 / buf 26 / num 21 / prev 16 / len 15 / val 11 / tmp 11 / args 10 / cfg 8 |

---

## Part 1 变量缩写词典（主体数据，来源 A1，推荐度沿用其标记）

### 1.1 🟢 推荐缩写（社区普遍识别，可放心用于局部变量/参数）

| 全称 | 缩写 | 备注 |
|---|---|---|
| abbreviation | abbr | |
| absolute | abs | |
| acronym | acro | |
| addition（求和结果） | sum | |
| address | addr | |
| algorithm | algo | |
| alternative | alt | |
| annotation | anno | |
| application | app | |
| argument | arg | 复数 args |
| array | arr | |
| asynchronous | async | 语言关键字级通用 |
| attribute | attr | 复数 attrs |
| authentication | auth | 兼指认证/鉴权上下文 |
| auxiliary | aux | |
| average | avg | |
| background | bg | CSS/UI 语境 |
| binary | bin | |
| boolean | bool | |
| buff（buffer 变体） | buff | ⚠️ 与主流实践有出入，见 §2 |
| button | btn | UI 语境 |
| calculator | calc | |
| callback | cb | |
| certificate | cert | |
| character | char | |
| check | chk | |
| clear | clr | ⚠️ UI 里 clr 也作 color 缩写（S3，未证实 A1 收录） |
| collection | coll | |
| column | col | |
| command | cmd | |
| communication | com | |
| component | comp | |
| concatenation | concat | JS/TS 内建方法级通用 |
| condition | cond | |
| config（全称本身已是通行形态） | config | A1 标 config 🟢、cfg/conf 🔴，与主流实践有出入，见 §2 |
| connection | conn | |
| constant | const | |
| container | cntr | |
| context | ctx | 本仓库 L1：301 次 |
| continue | cont | |
| control | ctrl | |
| conversation | conv | |
| coordinate | coord | |
| database | db | |
| debug | dbg | |
| decimal | dec | |
| declaration | decl | |
| definition | def | |
| degrees | deg | |
| deletion | del | |
| dependency | dep | 复数 deps（L1：55 次） |
| description | desc | 兼「降序」时仅限排序语境（S3） |
| destination | dest | 亦见 dst（S3） |
| developer / development | dev | |
| dimension | dim | |
| direction / directory | dir | |
| disable | dis | |
| display | disp | |
| division | div | |
| document | doc | |
| documentation | docs | |
| driver | drv | |
| dynamic | dyn | |
| element | elm | ⚠️ 现代前端多用 el（S3，未证实 A1 收录） |
| enable | en | |
| environment | env | |
| error | err | L1：319 次，本仓库最高频 |
| event | e / evt | |
| execution | exe | |
| exponential | exp | |
| expression | expr | |
| extension | ext | |
| factory | fac | ⚠️ 实践中多写全称 factory（S3） |
| figure | fig | |
| file chooser | fc | |
| file descriptor | fd | Unix 语境 |
| file processor | fp | |
| file reader | fr | |
| file system | fs | |
| file writer | fw | |
| format | fmt | Go 标准库级通用（fmt 包） |
| fraction | frac | |
| frequency | freq | A1 原文拼写 frequence 有误 |
| function | func | |
| generation | gen | |
| geometry | geom | |
| hexadecimal | hex | |
| identifier | id | |
| image | img | |
| implementation | impl | |
| import | imp | |
| inclusion / increase | inc | increase 仅限循环语境（A1 🟡） |
| index | idx | L1：52 次 |
| information | info | |
| initialization | init | L1：89 次 |
| input | in | |
| insertion | ins | |
| instance | inst | |
| integer | int | |
| interface | iface | |
| inverse | inv | |
| keymap | km | |
| keyword | kwd | |
| language | lang | |
| length | len | |
| level | lvl | |
| library | lib | |
| linked list | ll | 算法语境 |
| location | loc | |
| manager | mng | ⚠️ 实践中多写全称 mgr 亦有（S3，未证实） |
| maximum | max | |
| memory | mem | |
| message | msg | |
| microcontroller | mcu | 嵌入式语境 |
| middle | mid | |
| minimum | min | |
| miscellaneous | misc | |
| modulo | mod | |
| multiplication | mul | |
| navigation | nav | |
| network | net | |
| number (of) | num | |
| object | obj | |
| octal | oct | |
| open source software | oss | |
| operating system | os | |
| option | opt | |
| organization | org | |
| origin | orig | |
| output | out | |
| package | pkg | |
| parameter | param | 复数 params |
| performance | perf | |
| picture | pic | |
| pixel | px | |
| pointer | ptr | |
| prediction | pred | 数据科学语境 |
| preference | pref | |
| previous | prev | L1：16 次 |
| private | priv | |
| production | prod | |
| profiler | prof | |
| property | prop | 复数 props（L1：176 次） |
| public | pub | |
| query | q | 图论/DB 语境 |
| radians | rad | |
| range | rng | |
| receive | recv | 网络编程级通用（BSD socket 惯例，S3） |
| record | rec | |
| reference | ref | 复数 refs（前端框架级通用） |
| regex（通行缩略形态） | regex | 全称 regular expression |
| relation | rel | |
| remote | rem | |
| remove | rm / rmv | ⚠️ rm 与 shell 命令撞名，注意语境 |
| repository | repo | |
| request | req | L1：56 次 |
| response / result | res | L1：133 次 |
| return | ret | |
| revision | rev | |
| selection | sel | |
| separator | sep | |
| sequence | seq | |
| service | svc | K8s/云原生语境 |
| session | sess | ⚠️ 实践中多写全称 session（S3） |
| solution | sol | |
| source | src | L1：100 次 |
| specification | spec | 复数 specs |
| square root | sqrt | C math 库级通用 |
| standard | std | C++ 标准库级通用 |
| standard input output | stdio | C 标准库级通用 |
| statement | stmt | 编译原理/DB 语境 |
| statistic | stat | 复数 stats |
| string | str | Python 内建类型级通用 |
| subtraction | sub | A1 原文拼写 subtration 有误 |
| synchronization | sync | |
| temporary | tmp / temp | L1：tmp 11 次 |
| timer | tmr | 嵌入式语境 |
| timestamp | ts | TypeScript 语境注意撞名 |
| transaction | tx | 数据库/区块链语境 |
| utility | util | |
| value | val | L1：11 次 |
| variable | var | |
| vector | vec | |
| version | v | ⚠️ 单字母易歧义，实践中多写 ver/v 全称（见 §2） |
| vertical | ver | ⚠️ 与 version 缩写撞形 |
| window | win | |
| wizard | wiz | UI 向导语境 |

数学函数名（C `math.h` 惯例，S2）：sin / cos / tan / asin / acos / atan / sec / cosec / cot / asec / acosec / acot / sqrt / exp。

### 1.2 🟡 上下文敏感（仅限标注上下文内使用）

| 全称 | 缩写 | 限定上下文 |
|---|---|---|
| allocation | alloc | 内存管理 |
| breakline | bl | 字符编码 |
| channel | ch | 连接/IO |
| checksum | csum | 运算 |
| circle | circ | 图形 |
| commercial | com | URL |
| comparison | cmp | 条件运算 |
| delta time | dt | 计算/游戏循环 |
| difference | diff | 运算；⚠️ VCS 语境 diff 是通行词（S2） |
| device | dev | 设备枚举；与 developer 撞形，慎用 |
| equal | eq | 二元运算 |
| greater/less than (or equal) | gt / ge / lt / le | 二元运算、shell 语法 |
| height / width | h / w | 图形，且有配套单位时 |
| horizontal | hor | 图形 |
| iterator | iter | 循环 |
| key / value | k / v | 仅键值对连用（k、v、kvp） |
| latitude / longitude | lat / lon | 仅与坐标连用 |
| matrix | mat / mtx | 数学 |
| mutable | mut | 变量修饰（Rust 关键字级通用，S2） |
| newline | nl | 字符编码 |
| no / yes | n / y | 仅 y/n 成对出现 |
| node | $node | DOM |
| not equal / operation | ne / op | 二元运算 |
| order | ord | 数据科学 |
| pointer | p | 内存 |
| power | pwr | 能耗 |
| process | proc | 进程/线程 |
| radius | r | 圆形 |
| random | rand | ⚠️ C `rand()` 与 Go `math/rand` 通行，A1 却标 rand 🟢 / rnd 🔴——一致 |
| rectangle | rect | 图形 |
| semaphore | sem | 并发原语 |
| signed prefix | s | 修饰符 |
| software | sw | 计算机科学 |
| time | t | 物理 |
| type | t | 修饰符；泛型 T（S2） |
| user | u | 仅 URL 语境 |
| value | v | 仅与 k 连用 |
| vector | v | 物理 |
| white space | ws | 字符编码 |

### 1.3 🔴 不推荐（A1 明确标红，应写全称）

act（action/active/actual）、brk（break）、buf（见 §2 分歧）、cls（class）、com/comm（common）、con（connection，用 conn）、cpy（copy）、cfg/conf（configuration，A1 主张用 config，见 §2）、cur（current，A1 主张 curr，见 §2）、def（default）、e（无语境）、f/fn/fun（function，用 func）、hdr（header）、iface 之外的 intf、lnk（link）、qry（query，用 q）、rgx（regex 通行）、rnd（random）、sc（script）、sln（solution）、tgt（target）、tgl（toggle）、txt（text）、tpe（type）、usr（user）、ver（version）、2（to）。

---

## Part 2 与主流实践的分歧点（重要，落库时需人工裁决）

| 条目 | A1 观点 | 实践观察 | 裁决建议 |
|---|---|---|---|
| buffer | buf 🔴 / buff 🟢 | Go 标准库 `bufio`、C 惯例均为 buf；本仓库 L1 buf 26 次 | **词典双收**，标 `buf` 为主形态（S2 实践压过 A1 单点判断；A1 此条视为存疑） |
| configuration | cfg 🔴 / conf 🔴 / config 🟢 | cfg 在 C/嵌入式/Redis（redis-cli CONFIG）生态通行；本仓库 config 45 次 / cfg 8 次 | **双收**：config 为主，cfg 标「嵌入式/C 惯例」 |
| current | cur 🔴 / curr 🟢 | 本仓库 cur 87 次（L1）；`git rev-parse --abbrev-ref` 输出等 | **双收**，均标通行（A1 此条与广泛实践不符，未证实其理由） |
| user | usr 🔴 | Unix `/usr` 目录、usr 生态通行 | 双收，usr 标「Unix 历史惯例」 |
| function | f/fn/fun 🔴 / func 🟢 | Rust/JS 箭头参数 `fn` 常见；`fn` Rust 关键字 | func 为主，fn 标「Rust/匿名函数参数惯例」 |
| session | sess 🟢 | 实践几乎总写全称 session | sess 标低频，主推全称 |
| version | v 🟢 / ver 🔴 | UI 中 `v1.2` 形态通行，变量名用 version 全称居多 | v 仅限「v+版本号」形态；变量名用全称 |

> 结论：A1 是单列表，个别推荐度与生态现实冲突。落库数据建议每条带 `variants` 数组而非单一 `abbr`，推荐度冲突时以「多来源交叉」为准。**本节裁决属 S3 归纳，均已标注**。

---

## Part 3 中文技术描述 → 地道英文短语映射

> 可信度标注：[A7/A8] = 有官方风格指南或大厂文档直接佐证；[S3] = 主流软件 UI / 文档惯例归纳，未逐项检索佐证。

### 3.1 产品与设置

| 中文 | 推荐英文 | 避免（中式直译/误用） | 来源 |
|---|---|---|---|
| 用户配置 / 用户设置 | user settings | ~~user configuration~~（UI 语境生硬，config 指技术配置项） | A7 A8 |
| 偏好设置 | preferences | —（Apple 生态惯用词） | A7 |
| 选项 | options | 仅当产品 UI 本身叫 Options（如 Office） | A7 |
| 系统设置 | system settings | ~~system config~~ | A7 |
| 主机级/工作区级设置 | host-level / workspace settings | — | A8 |
| 个性化 | personalize | ~~individualize~~ | A7 |
| 全局/默认 | global / default | ~~whole-situation~~ | S3 |
| 深色/浅色模式 | dark / light mode | ~~night mode~~（语义偏移） | S3 |
| 开机自启/登录启动 | launch at login / start at login | ~~boot self-start~~ | S3 |
| 系统托盘 | (system) tray；macOS 惯用 menu bar | ~~hold-disk icon~~ | S3 |
| 悬浮窗/浮窗 | floating window / overlay | ~~suspend window~~ | S3 |
| 后台运行 | run in background | ~~backstage running~~ | S3 |

### 3.2 界面操作

| 中文 | 推荐英文 | 避免 | 来源 |
|---|---|---|---|
| 确定/取消 | OK / Cancel | ~~Confirm/Cancel~~（对话框惯用 OK） | S3 |
| 保存/另存为 | Save / Save As | ~~store up~~ | S3 |
| 撤销/重做 | undo / redo | ~~revoke / re-operate~~ | S3 |
| 剪切/复制/粘贴 | cut / copy / paste | — | S3 |
| 剪贴板 | clipboard | ~~cut-board~~ | S3 |
| 收藏/取消收藏 | favorite / unfavorite（或 star/unstar） | ~~collect~~ | S3 |
| 置顶 | pin / pin to top | ~~top-set~~ | S3 |
| 展开收起 | expand / collapse | ~~open-close~~ | S3 |
| 启用/禁用 | enable / disable | ~~open/close the function~~ | S3 |
| 搜索/筛选/排序 | search / filter / sort | ~~search out / screen / order~~ | S3 |
| 刷新 | refresh | ~~brush new~~ | S3 |
| 拖拽 | drag (and drop) | — | S3 |
| 悬停 | hover | ~~float-stop~~ | S3 |
| 双击/右键 | double-click / right-click | — | S3 |
| 上传/下载 | upload / download | — | S3 |
| 导入/导出 | import / export | ~~lead-in / lead-out~~ | S3 |
| 登录/登出 | sign in / sign out（产品 UI 惯用）；log in / log out 亦可 | login/logout 作**动词**（名词才用 login） | S3 |
| 快捷键 | keyboard shortcut；global shortcut（全局） | ~~quick key / hot key~~（hotkey 口语可） | S3 |
| 截图/录屏 | screenshot / screen recording | ~~cut-picture~~ | S3 |
| 占位提示 | placeholder | ~~tip words~~ | S3 |
| 空状态文案「暂无」 | No data yet / Nothing here | ~~no-temporary~~ | S3 |

### 3.3 开发与运行时

| 中文 | 推荐英文 | 避免 | 来源 |
|---|---|---|---|
| 接口（HTTP 意义） | API / endpoint | ~~interface~~（interface 限 OOP 接口） | S3 |
| 请求/响应 | request / response | — | S3 |
| 超时 | timeout | ~~over-time~~ | S3 |
| 重试 | retry | ~~again-try~~ | S3 |
| 轮询 | polling | ~~wheel-ask~~ | S3 |
| 心跳 | heartbeat | — | S3 |
| 断线重连 | reconnect (on disconnect) | ~~break-line again-connect~~ | S3 |
| 缓存 | cache | ~~buffer~~（语义不同） | S3 |
| 会话 | session | — | S3 |
| 白名单/黑名单 | allowlist / blocklist（新）；whitelist/blacklist（旧称仍在用） | — | S3 |
| 权限/授权 | permission / authorization；动词 grant | — | S3 |
| 密钥/令牌 | key / token | ~~password~~（混义） | S3 |
| 代理 | proxy | ~~agent~~（agent 另有 AI 代理义） | S3 |
| 局域网 | LAN / local network | ~~local-area-net~~ 直拼 | S3 |
| 回滚 | roll back / rollback | ~~return-version~~ | S3 |
| 回退（代码） | revert；（导航）go back | 混用 | S3 |
| 兼容性 | compatibility | ~~co-use~~ | S3 |
| 向后兼容 | backward compatible | ~~back-compat~~ 口语可 | S3 |
| 弃用 | deprecated | ~~abandoned~~（语义过强） | S3 |
| 发布/部署 | release / deploy | ~~put-on-line~~ | S3 |
| 灰度发布 | gradual rollout / canary release | ~~gray-release~~ | S3 |
| 版本号 | version (number) | ~~edition number~~ | S3 |

### 3.4 代码与数据

| 中文 | 推荐英文 | 避免 | 来源 |
|---|---|---|---|
| 表单 | form | ~~table~~（表格才是 table，高频混淆） | S3 |
| 字段 | field | ~~paragraph~~ | S3 |
| 条目/记录 | entry / record | — | S3 |
| 标签 | tag（分类）/ label（表单标注）/ tab（页签），三义严格区分 | 一律 tag | S3 |
| 目录 | directory（文件系统）/ contents（书籍目录）/ catalog（商品） | 一律 menu | S3 |
| 文件名 | filename（一个词） | ~~file name~~ 拼两词（旧式） | S3 |
| 扩展名 | file extension | ~~expand name~~ | S3 |
| 默认值 | default (value) | ~~preset value~~（可但少） | S3 |
| 必填/可选 | required / optional | ~~must-fill / can-choose~~ | S3 |
| 大小写敏感 | case-sensitive | — | S3 |
| 去重 | dedupe / deduplicate | ~~cut-repeat~~ | S3 |
| 遍历 | iterate / traverse | ~~circulate~~ | S3 |
| 字符串拼接 | concatenate；数组合并 merge | 混用 | S3 |
| 截取子串 | substring / slice | — | S3 |
| 正则表达式 | regular expression (regex) | ~~regular-formula~~ | S3 |
| 转义 | escape | — | S3 |
| 编码/解码 | encode / decode | 与 加密/解密 encrypt/decrypt 严格区分 | S3 |
| 哈希/摘要/签名/盐 | hash / digest / signature / salt | — | S3 |
| 校验 | validate（表单）/ verify（核对事实） | 混用 | S3 |
| 序列化 | serialize / deserialize | ~~order-lize~~ | S3 |
| 并发/并行 | concurrency / parallelism（≠，严格区分） | 互译 | S3 |
| 阻塞/非阻塞 | blocking / non-blocking | — | S3 |
| 死锁/竞态条件 | deadlock / race condition | — | S3 |
| 幂等 | idempotent | ~~power-equal~~ | S3 |
| 边界情况 | edge case | ~~boundary situation~~（可但少） | S3 |
| 兜底 | fallback | ~~bottom-holding~~ | S3 |
| 硬编码 | hard-coded | ~~dead-write~~ | S3 |
| 魔法数字 | magic number | — | S3 |
| 重构 | refactor | ~~reconstruct~~（建筑工程义） | S3 |
| 解耦 | decouple | ~~untie~~ | S3 |
| 复用 | reuse | ~~repeat-use~~ | S3 |
| 回调/钩子 | callback / hook | — | S3 |
| 生命周期 | lifecycle（一词惯用） | ~~life cycle~~ 拼两词（旧式） | S3 |
| 监听/订阅/发布 | listen (to) / subscribe / publish | — | S3 |
| 依赖注入 | dependency injection (DI) | — | S3 |
| 临时方案 | workaround | ~~temporary plan~~ | S3 |
| 技术债 | technical debt | — | S3 |
| 内存泄漏 | memory leak | ~~memory divulge~~ | S3 |
| 卡顿 | jank / lag | ~~card-ton~~ | S3 |
| 闪退/假死 | crash / hang (freeze) | — | S3 |
| 单元/集成/端到端测试 | unit / integration / end-to-end (E2E) test | — | S3 |
| 模拟/打桩 | mock / stub | 混用 | S3 |
| 冒烟测试/回归测试 | smoke test / regression test | — | S3 |
| 覆盖率 | coverage | ~~cover rate~~ | S3 |

---

## Part 4 函数 / 布尔量命名的惯用形态

### 4.1 布尔量（A2 A3 A4 A6 A9）

- **前缀动词**：`is` / `are` / `has` / `was` / `did` / `will` / `should` / `must` / `can`（A6）——名字读成一句可回答 yes/no 的话。
  - `is`：描述当前上下文的状态/特征，`isBlue`、`isDisabled`（A2）
  - `has`：描述「是否拥有」，`hasProducts`，优于 `isProductsExist` / `areProductsPresent`（A2）
  - `should`：与动作连用的肯定条件，`shouldUpdateUrl`（A2）
  - `can`：能力/权限判定（A3 列 Is/Can/Has 三选）
- **天然布尔形容词无需前缀**：enabled / disabled / visible / hidden / active / readonly / selected / checked——前端框架属性通行（S3）。
- **Swift 断言式**：布尔属性直接读作断言 `x.isEmpty`、`line1.intersects(line2)`（A4）——即「读起来像陈述句」。
- **反例警示**：Java + Jackson 下 `is` 前缀布尔在序列化时字段名会去掉 `is`，导致 JSON 与 setter 失配，一些团队因此存库字段不用 `is`（A9）。
- 命名时表达**期望值**：`isDisabled = itemCount <= 3`，避免在消费点再取反（A2）。
- Unreal/C++ 另有 `b` 前缀（`bIsActive`），仅该生态（S2）。

### 4.2 函数动词（A2 A4）

| 动词 | 语义 | 配对 |
|---|---|---|
| get | 立即取数（内部数据简写 getter）；异步取数也惯用（如 `getUser`） | set |
| set | 声明式地把 A 设为 B | get |
| reset | 恢复到初始值/状态 | — |
| fetch | 发起请求异步获取（`fetchUser`）——与 get 的区分是社区通行细辨（S3，A2 仅作示例提及） | — |
| add | 往某处**添加**（需要目的地） | remove |
| remove | 从某处**移除**（东西还在） | add |
| create | **新建**（无需目的地） | delete |
| delete | 彻底**删除** | create |
| compose | 从既有数据**构造新数据**，`composePageUrl` | — |
| handle | 处理动作，回调惯用 `handleLinkClick`；DOM 属性层用 `on*`（`onClick`），处理函数 `handle*`，两层勿混（A2 举例 + S3） | — |
| make | 工厂方法前缀 `x.makeIterator()`（A4，Swift；`document.createElement` 同构） | — |
| form | 天然是名词的操作的变异版本：`y.formUnion(z)` vs `x = y.union(z)`（A4） | — |
| -ed / -ing 后缀 | 动词的非变异版本：`sort()` / `sorted()`，优先过去分词 -ed；带直接宾语时用 -ing：`stripNewlines()` / `strippingNewlines()`（A4） | — |
| min / max | 边界值（A2） | — |
| prev / next | 前一/后一状态（A2） | — |

### 4.3 大小写与缩略词

- 缩略词当普通单词弯折：`XmlHttpRequest` ✓ / `XMLHTTPRequest` ✗ / `supportsIpv6`（A5）。
- 选定一种大小写风格（camelCase / PascalCase / snake_case）保持一致（A2）。
- 反缩写原则（何时不缩写）：短作用域高频出现且自解释时全称更可读——`index`/`count`/`each`（A10；A2 也明确 "Do not use contractions" `onItemClick` ≠ `onItmClk`）。

---

## Part 5 落库数据结构建议（可直接抄进插件 data 层）

```ts
/** 缩写词条：完整→缩写 */
export interface AbbrEntry {
  full: string                     // 小写全称，如 'database'
  primary: string                  // 主推缩写，如 'db'
  variants: string[]               // 其他通行形态，如 ['cur' 之于 'current']（含 §2 分歧裁决）
  level: 'recommended' | 'contextual' | 'avoid'
  context?: string                 // level=contextual 时必填，如 'memory' / 'loops'
  conflictNote?: string            // 来源间分歧说明（§2）
  sources: ('A1' | 'S3' | 'local')[]  // local = 本仓库 L1 grep 佐证
}

/** 中文→英文短语映射 */
export interface ZhEnEntry {
  zh: string                       // '用户配置'
  en: string[]                     // 按语境排序：['user settings', 'user preferences', 'user config']
  avoid?: string[]                 // 中式直译：['user configuration (UI 语境)']
  domain: 'ui' | 'network' | 'file' | 'code' | 'product'
  sources: ('A7' | 'A8' | 'S3')[]
}

/** 命名形态规则（Part 4，规则型而非词典型） */
export interface NamingRule {
  kind: 'bool-prefix' | 'func-verb' | 'case' | 'pair'
  term: string                     // 'is' | 'get' | 'add' ...
  meaning: string
  pairsWith?: string               // 'remove'
  sources: string[]
}
```

数据文件切分建议：`data/abbrev-en.ts`（Part 1+2，约 280 条）、`data/zh-en.ts`（Part 3）、`data/naming-rules.ts`（Part 4）。词条可平铺进 dev-manual 现有 `RawEntry` 结构（`src/plugins/dev-manual/data/types.ts:1`），`copyText` 放缩写本体、`keywords` 放全称+变体。

## 未证实 / 存疑清单

- Part 1 各表主体逐条来自 A1 仓库 README（S2），其推荐度为**单一来源**，§2 已列已知冲突；其余未交叉验证的条目推荐度以 A1 原样为准。
- 所有标注 **S3** 的条目（本仓库统计、双收裁决、中文映射大部分行、`el`/`mgr`/`clr` 变体、fetch/get 细辨、天然布尔形容词惯例）为**惯例归纳，未逐项检索佐证**，落库前建议抽样核对（对照 VS Code / Chrome / macOS 官方 UI 文案）。
- A1 原仓库存在个别拼写错误（frequence/subtration/poligon），本表已按正确拼写收录。
- 「user configuration 在 UI 语境生硬」为 A7+A8 归纳的倾向性结论，非硬规则；后端配置文件场景 user config 完全正常。
