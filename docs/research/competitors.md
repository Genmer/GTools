# 变量命名工具竞品调研（competitors）

> 调研日期 2026-09-24。目标：为 GTools 变量命名类插件提供功能取舍依据（功能点 × 是否值得做 × 理由）。
> 可信度分级：**[S1] 官方页面/仓库一手数据**、**[S2] 第三方评测/教程/搜索摘要**、**[S3] 未证实（标注原因）**。
> 检索方式：WebSearch（Z.ai web_search_prime）+ WebFetch 页面抓取 + `gh api` GitHub 仓库数据（2026-09-24 执行）。

## 来源清单

| 编号 | 来源 | 可信度 | 提供的信息 |
|---|---|---|---|
| C1 | [unbug/codelf](https://github.com/unbug/codelf)（`gh api` 实测：14,134★ / 959 forks / 43 open issues / 最后 push 2025-06-06） | S1 | 功能、平台覆盖、数据源 |
| C2 | [Codelf VSCode 市场页](https://marketplace.visualstudio.com/items?itemName=unbug.codelf)（WebFetch 实测） | S1 | 安装量 319,394；1 条评价；使用方式 |
| C3 | [Codelf Issue #58「为什么中文无法搜索？」](https://github.com/unbug/codelf/issues/58)（2018-12） | S1/S2 | 中文搜索依赖有道翻译 API 的说明（经搜索摘要转述，原文页未直接抓取） |
| C4 | [qiaoanqiao/codevar](https://github.com/qiaoanqiao/codevar)（`gh api` 实测：47★ / 最后 push 2023-10-28） | S1 | uTools 变量命名插件的完整交互与功能清单、未实现计划 |
| C5 | [uTools 插件市场搜索摘要]（www.u-tools.cn） | S2 | 卷王变量翻译、AI变量命名师、起个变量名(AI)（付费专区）、AI 翻译+自定义变量命名 |
| C6 | [coder-xiaomo/variable-conversion-vscode-extension](https://github.com/coder-xiaomo/variable-conversion-vscode-extension)（`gh api` 实测：仓库 3★ / 最后 push 2026-05-27；package.json 实读 v2.3.2） | S1 | VSCode「Variable Conversion」快捷键/格式全集 |
| C7 | [JetBrains CamelCase 插件页 + 中文教程摘要](https://plugins.jetbrains.com)（WebFetch 超时，信息来自搜索摘要） | S2 | Shift+Alt+U 循环切换、同名批量改 |
| C8 | [AI Translate Variable (JetBrains)](https://plugins.jetbrains.com)（WebFetch 超时，信息来自搜索摘要） | S2 | Alt+P 一键中文→英文标识符；快译/AI 双模式 |
| C9 | [uiuing/varbook](https://github.com/uiuing/varbook)（`gh api` 实测：207★ / 最后 push 2024-06-10；README WebFetch 实读） | S1 | LLM(llama3)+Milvus、约 29.47 万条命名知识库 |
| C10 | [cnblogs「变量命名神器Codelf」评测](https://www.cnblogs.com/wang1024/p/14962650.html)（正文需登录，观点来自搜索摘要） | S2 | 近义词只搜第一个导致不准的吐槽 |
| C11 | 搜索摘要合集（CSDN/掘金/知乎/腾讯云/阿里云开发者社区，2022–2025） | S2 | var-translate-en、Auto En Conver、Easy Naming(Alt+Z)、AI 变量命名助手(VSCode)、CHTML、BFW 等条目 |

---

## Part 1 竞品清单（形态 × 交互 × 关键指标）

### 1.1 uTools 变量命名类插件（GTools 直接对标）

| 插件 | 交互（输入→输出） | 命名格式 | 特性 | 来源 |
|---|---|---|---|---|
| **codevar** | 输入中文 → 翻译成英文 → 列表展示 5 格式 → 上下键选择，回车/点击「自动放入剪切板并自动执行粘贴」 | 小驼峰 xt / 大驼峰 dt / 下划线 xh / 横线 hx / 常量 cl | 无历史、无收藏；翻译引擎/API key 不可自定义；GPL-3.0；**2023-10 后未再更新**，更新计划（自定义引擎、变量名附中文释义）均未实现 | C4 |
| **卷王变量翻译** | 输入文字 → 翻译成指定命名规则的变量名 | 多种规则（未列全） | 提供视频教程 | C5 |
| **AI变量命名师** | 输入中文描述 → AI 生成符合编程规范的英文变量名 | —（AI 决定） | AI 生成 | C5 |
| **起个变量名 (AI)** | 输入中文变量名 → 百度翻译 + AI → 英文变量名 | —（AI 决定） | **付费插件专区** | C5 |
| **AI 翻译 + 自定义变量命名** | 输入「翻译」「AI 翻译」进预览页；输入「变量名」「驼峰」进列表快速命名；**划词选中文本直接呼出**翻译/转变量名 | 列表式 | OpenAI 兼容 API（需自配 Base URL + API Key） | C5 |

uTools 各插件下载量：插件市场为动态页面且直连失败，**未证实**。

### 1.2 编辑器插件

| 插件 | 平台 | 交互（输入→输出） | 规模 | 来源 |
|---|---|---|---|---|
| **Codelf (CODELF)** | VSCode / Atom(已停维护) / Sublime / Chrome / Web；**无 JetBrains** | 选中文本（右键/命令面板）→ 搜索 GitHub/Bitbucket/GitLab/Google Code/Codeplex/Sourceforge/Fedora 真实项目用例（按 star 排序）→ 展示该名字在开源代码中的实际用法 | 14,134★；**VSCode 安装 319,394**；1 条市场评价 | C1 C2 |
| **Variable Conversion（变量命名转换助手）** | VSCode | 选中文本 → 右键菜单 / 快捷键 Shift+Alt+T / 状态栏 → 一键转换或循环转换（Ctrl+Alt+[ / ]） | 纯格式转换、**无翻译**；安装量未证实（市场页抓取超时） | C6 |
| **var-translate-en** | VSCode | 中文 → 一键翻译为英文并转多种命名风格 | 多免费翻译服务（必应等） | C11 |
| **Auto En Conver** | VSCode | 中文 → 百度翻译 API → 驼峰 | 需自行申请百度翻译开放平台 API | C11 |
| **AI 变量命名助手** | VSCode（2025-05） | 选中文本 + 上下文 → AI 生成变量名/方法名，多风格 | 上下文感知 | C11 |
| **CamelCase** | JetBrains | 选中变量 Shift+Alt+U → 在 camel/snake/pascal/UPPER/Space/Dot 间**循环切换**；同名变量可批量修改 | 纯格式转换 | C7 |
| **Translation + CamelCase 组合** | JetBrains | Translation 插件翻中文 → 手动 CamelCase 转格式 | 社区常见工作流 | C7 |
| **AI Translate Variable** | JetBrains | 选中/输入中文 Alt+P → 英文标识符；**快译模式**（机器翻译，适合批量）+ **AI 模式**（地道命名） | 两档模式 | C8 |
| **Easy Naming** | JetBrains | 选中中文 Alt+Z → AI 生成多种命名建议 + 注释生成 | — | C11 |

### 1.3 在线工具

| 工具 | 交互（输入→输出） | 数据/引擎 | 来源 |
|---|---|---|---|
| **Codelf Web**（unbug.github.io/codelf） | 同插件：中文先经有道翻译 → 搜开源代码 | 多代码托管平台 + 有道 API | C1 C3 |
| **VARBook**（varbook.uius.site） | 输入中文关键词（Ctrl 聚焦、Enter 搜索）→ 规范英文命名建议；空格+英文可保留指定关键词 | llama3 + Milvus，从 GitHub/Gitee 优质 repo 学习约 **29.47 万条**命名；命名规则可经 issue 定制（如是否保留 is/has）；VSCode 插件标注「开发中」 | C9 |
| **CHTML / BFW 变量命名神器 / jyshare 变量名助手** | 中文 → 匹配代码库/规则库 → 多语言命名方式展示 | BFW 支持直接搜中文；jyshare 用 AI 按上下文生成 | C11 |
| 腾讯云/阿里云推广的免费工具（称支持 96 种命名格式、Win/Mac/Linux+编辑器） | — | 文章正文未能核实（原链接抓取失败），**产品名与真实能力未证实** | C11 |

---

## Part 2 核心交互形态归纳（3 类）

| 形态 | 代表 | 输入 | 输出 | 解决的问题 |
|---|---|---|---|---|
| **翻译→转格式型** | codevar、卷王、var-translate-en、AI 翻译类 | 中文词/短语 | 同步列出 N 种命名格式，选中即复制（+自动粘贴） | 「这个词英文怎么拼、格式怎么转」的高频摩擦 |
| **真实代码搜索型** | Codelf、BFW | 关键词（中文先经有道翻译） | 该名在开源项目中的真实用法（按 star 排序） | 「真实项目里大家怎么命名」——地道性 |
| **AI 生成型** | VARBook、AI变量命名师、AI Translate Variable、Easy Naming | 中文描述（或选中代码+上下文） | 1~N 个符合语境的候选命名 | 「机器直译不地道」——语义与语境 |

键盘流是共性：上下键选择 + 回车复制（codevar）、循环切换快捷键（CamelCase / Variable Conversion）、单键触发（JetBrains Alt+P / Alt+Z）。

## Part 3 必备功能矩阵（功能 × 竞品覆盖）

| 功能 | codevar | 卷王/AI类 uTools | Codelf | Variable Conversion | CamelCase | VARBook | AI Translate Variable |
|---|---|---|---|---|---|---|---|
| 中译英 | ✅（内置引擎） | ✅（百度/AI/OpenAI 兼容） | ✅（有道，仅作搜索前置） | ❌ | ❌ | ✅（LLM） | ✅ |
| 小驼峰/大驼峰/下划线/横线/常量 五件套 | ✅ 全部 | ✅（未证实是否全含） | ❌（不给格式化结果） | ✅ +空格/点分隔/大小写 | ✅（循环切换） | 未证实 | ✅ |
| 一键复制（含自动粘贴） | ✅ 核心卖点 | ✅ | ❌（供参考） | ❌（就地替换） | ❌（就地替换） | 未证实 | ✅（就地替换） |
| 划词/选中文本呼出 | —（uTools 全局划词能力） | ✅（AI翻译插件明确支持） | ✅（编辑器右键） | ✅（编辑器右键） | ✅（编辑器） | —（网站） | ✅（Alt+P） |
| 历史 | ❌ | 未证实 | ❌ | ❌ | ❌ | 未证实 | 未证实 |
| 收藏/个人词库 | ❌ | 未证实 | ❌ | ❌ | ❌ | 未证实（仅规则级定制） | 未证实 |
| 缩写展开（abbr→全称） | ❌ | ❌ | ❌（只能反查用法） | ❌ | ❌ | ❌ | ❌ |
| 离线可用 | 部分（翻译需网络） | ❌（需 API） | ❌（翻译+搜索全在线） | ✅（纯本地转换） | ✅（纯本地） | ❌（在线服务） | ❌（需 API） |
| 翻译候选词多选 | 未证实（单一结果推断） | AI 类给出多候选 | 近义词多但**只搜第一个**（吐槽点） | — | — | ✅ | ✅ |

**结论**：中译英 + 五格式展示 + 键盘选择复制是事实标准；历史/收藏/缩写展开在所有调研对象中均为空白。

## Part 4 受欢迎的差异化特性（按热度/规模排序）

1. **真实项目用例**（Codelf，14.1k★ / 31.9 万安装的根基）——回答「大家实际怎么命名」而非字典直译。[C1 C2]
2. **LLM + 大规模命名知识库**（VARBook：llama3 + Milvus + 29.47 万条 GitHub/Gitee 优质命名）——机器直译不地道的主要解法。[C9]
3. **上下文感知**（VSCode「AI 变量命名助手」、Easy Naming：选中代码+上下文生成）——比裸翻译更准。[C11]
4. **划词呼出 + 自动粘贴**（codevar 核心体验；uTools「AI 翻译」插件划词直接转变量名）——零摩擦入码。[C4 C5]
5. **循环切换 / 多入口**（CamelCase Shift+Alt+U；Variable Conversion 右键+快捷键+状态栏+循环转换 Ctrl+Alt+[/]）。[C6 C7]
6. **双档模式**（AI Translate Variable：快译=机器翻译省事，AI=地道命名）。[C8]

## Part 5 用户抱怨的短板（带来源）

| 短板 | 对象 | 证据 |
|---|---|---|
| **中文搜索强依赖有道翻译 API**：API 失效/限流/断网时中文搜不了或变慢 | Codelf | Issue #58（2018-12 至今开着），设计上「先翻译再搜索」[C3] |
| **翻译返回多个近义词但只搜索第一个**，结果不准 | Codelf | cnblogs 评测 [C10] |
| **完全在线、无离线模式**；多平台实时搜索慢 | Codelf | C3 C10 |
| 无 JetBrains 版 | Codelf | 官方 README 平台列表 [C1] |
| **翻译引擎/key 不可自定义**、无历史收藏、安装不便（不再发 upx 包） | codevar | README 更新计划未实现；2023-10 停更 [C4] |
| **机器直译不地道、不符代码语境**（催生一批 AI 插件的反面痛点） | 所有词典翻译型 | AI Translate Variable 以「地道英文命名」为卖点反证 [C8] |
| **API Key 配置门槛**（需申请百度 API / 自配 OpenAI Base URL） | Auto En Conver、uTools AI 翻译 | C5 C11 |
| 付费墙（起个变量名 AI 在 uTools 付费专区） | uTools 生态 | C5 |

## Part 6 结论：功能点 × 是否值得做 × 理由

> 判定基准：GTools 是本地优先的启动器 + 插件架构（见 AGENTS.md / docs/DESIGN.md），插件能力走 ctx 受限 net/fs；网络翻译需过 net-guard 域名白名单。

| # | 功能点 | 是否值得做 | 理由 |
|---|---|---|---|
| 1 | 中文→英文翻译，输入即出五格式（小驼峰/大驼峰/下划线/横线/常量） | ✅ 必做 | 全品类事实标准交互（codevar/卷峰/var-translate-en 均此形态）；uTools 生态已验证刚需（多个同类插件并存）[C4 C5] |
| 2 | 上下键选择 + 回车复制（含自动粘贴可选） | ✅ 必做 | codevar 核心体验「放入剪切板并自动执行粘贴」；启动器形态下键盘流是基本盘 [C4] |
| 3 | 划词/关键词呼出（全局快捷键进入命名模式） | ✅ 必做 | uTools「AI 翻译」插件的划词转变量名是明确受欢迎特性；GTools 有全局 shortcut 服务可复用 [C5] |
| 4 | 翻译候选词多选（近义词列表，可切换主词重新生成格式） | ✅ 值得做 | 直接反打 Codelf「只搜第一个近义词」的已知吐槽；成本低（多展示几个候选）[C10] |
| 5 | 离线兜底（本地常用词典，断网/限额时降级可用） | ✅ 值得做 | 「完全在线、慢、API 挂了就废」是 Codelf/在线工具最大抱怨；GTools 本地优先定位天然契合 [C3 C10] |
| 6 | 历史（最近命名记录） | ✅ 值得做 | 全部调研对象均无此功能（Part 3 矩阵空白），实现成本低（复用 storage 服务），高频重复命名场景真实存在 |
| 7 | 收藏/个人词库（收藏候选词 + 中文备注） | ✅ 值得做 | 同上空白；codevar 把「变量名附中文释义」列为计划但三年未做 [C4]；沉淀价值随使用增长 |
| 8 | 缩写展开/反查（abbr ↔ 全称，含推荐度标记） | ✅ 值得做 | 无任何现成工具覆盖（Part 3 矩阵全 ❌）；数据已备——本仓库 `docs/research/abbreviations.md` 有 280 条带推荐度词典；与命名插件天然同屏互补 |
| 9 | AI 模式（可选配置 OpenAI 兼容 API，机器翻译兜底 + AI 增强） | ⚠️ 可选（二期） | 行业趋势（VARBook/AI 插件们）且解决「直译不地道」[C8 C9]；但 API Key 配置门槛是被抱怨点 [C5 C11]，GTools net-guard 也可约束域名；应作为可选增强而非核心依赖 |
| 10 | 真实代码用例搜索（Codelf 式） | ❌ 不做 | 需要持续在线的第三方搜索服务（searchcode/多平台），与本地优先和 net-guard 白名单约束冲突；数据管道维护成本高，Codelf 自己也受困于在线依赖 [C1 C3] |
| 11 | 96 种/超多命名格式 | ❌ 不做 | 「96 种格式」出自未能核实的推广文 [C11 未证实]；实际通用格式五件套 + 空格/点/URL-kebab/HTTP-Header 等少量扩展即覆盖真实需求（Variable Conversion 全集也仅 10 种左右）[C6] |
| 12 | 编辑器内就地循环切换/批量改名（CamelCase 式） | ❌ 不做 | 属于编辑器内改选中文本的场景，与启动器「生成新名→复制走」的形态不同；GTools 无编辑器上下文 [C7] |

**一句话结论**：做「翻译→五格式→键盘复制」的标准形态，补齐全行业空白的历史/收藏/缩写展开，用本地词典兜底离线，AI 留作可选增强；不做代码用例搜索与超全格式。

## 未证实事项汇总

- uTools 各插件下载量、付费价格（市场页动态渲染，直连失败）。
- 「96 种命名格式」免费工具的产品名与真实性（推广文正文抓取失败）。
- 卷王变量翻译、VARBook 支持的具体格式全集与历史/收藏有无（页面未列出）。
- Variable Conversion 的 VSCode 实际安装量（marketplace 页面两次抓取超时，仓库仅 3★ 但持续更新至 2026-05，实际装机大概率远高于仓库 star——此推断亦未证实）。
- C3（issue #58 原文）、C7/C8（JetBrains 插件页）、C10（cnblogs 正文）三次直接抓取失败/需登录，内容依据搜索摘要转述，关键事实（有道 API 依赖、Alt+P、近义词问题）多源交叉出现，可信度 S2。
