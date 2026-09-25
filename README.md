# GTools

自制类 uTools 的桌面效率启动器：全局快捷键唤起 → 搜索 → 按关键字路由进插件。插件化架构，内置插件随应用打包，外部插件协议已预留。

## 技术栈

- Electron 44 + Vue 3（组合式 API）+ TypeScript
- 构建 electron-vite 5（主进程 ESM / preload CJS / 渲染层 Vite），打包 electron-builder（mac dmg + win nsis）
- 测试 vitest（node 环境，纯逻辑）
- 运行时依赖仅 `vue` 与 `pinyin-pro`（无原生编译依赖）

## 安装与运行

```bash
npm install        # 依赖安装（.npmrc 已配置 npmmirror 与 electron 镜像）
npm run dev        # 本地调试（GUI，需人工交互环境）
npm run build      # 编译主/预加载/渲染三段产物到 out/
npm test           # vitest 单测
npm run typecheck  # tsc + vue-tsc 类型检查
npm run dist       # 出 macOS 安装包（release/）
npm run dist:win   # 出 Windows 安装包（需在 Windows 环境实测）
```

`dist` 首次运行需下载打包二进制，建议设置镜像：

```bash
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
```

## 使用

- **默认全局快捷键**：macOS `Alt+Space`（Option+空格），Windows `Alt+Space` / `Ctrl+Alt+Space`
- **独立窗口快捷键**：macOS `Cmd+D`，Windows `Ctrl+D`（进入插件后可将插件独立为桌面窗口）
- **输入即搜**：支持中文、英文、全拼（`geshi` →「JSON 格式化」）、首字母（`kfz` →「开发者工具」）、英文别名（`wx` →「微信」、`code` →「VS Code」）
- **空态九宫格**：9 列标准图标网格，第一行为「最近打开」（应用+插件混合），下方为「应用栏」（支持置顶与抽屉折叠）
- **搜索结果网格化**：搜索结果采用统一 9 列网格展示，底部浮出选中条目功能详情
- **顶栏一体化**：进入插件后顶栏嵌入 Tag 胶囊与参数输入框，按 `Backspace` 或 `Esc` 平滑退回全局搜索
- **托盘菜单**：显示 / 设置 / 退出（无 Dock 常驻，托盘是唯一退出入口；macOS 菜单栏自动黑白自适应）
- **主题**：白色 / 黑色 / 玻璃（macOS vibrancy 毛玻璃、Windows 亚克力）

## 内置插件（25 个）

| 插件 | 关键字 | 说明 |
|---|---|---|
| **JSON 编辑器** | `json` / `格式化` | JSON 校验格式化、五彩简约高亮、折叠树视图、节点复制 |
| **计算稿纸** | `calc` / `jsq` / `计算` | 多行连续计算、变量赋值、行内注释、实时汇总 |
| **聚合翻译** | `fy` / `translate` / `翻译` | 划词翻译、多引擎对比、中英互译 |
| **剪贴板历史** | `clip` / `剪贴板` | 文本与图片历史、收藏置顶、快捷搜索与粘贴 |
| **本地文件搜索** | `f` / `find` / `文件搜索` | 毫秒级文件名检索、按类型过滤、直接在访达/资源管理器定位 |
| **网页快开** | `web` / `快开` / `wykk` | 常用站点一键打开、带参快捷直达搜索 |
| **批量重命名** | `rename` / `重命名` | 文本替换、序号自增、扩展名转换、前后缀添加与实时预览 |
| **PDF 工具箱** | `pdf` / `pdf-tools` | PDF 合并、拆分、旋转、重排与提取 |
| **时间工具箱** | `time` / `时间戳` | Unix 时间戳互转、世界时钟、Cron 表达式解析与倒计时 |
| **待办与番茄钟** | `todo` / `pomodoro` / `番茄` | 任务清单、优先级管理、番茄工作法时钟与浮窗提醒 |
| **变量命名神器** | `var` / `命名` / `codelf` | 中文转小驼峰、大驼峰、下划线、常量命名与缩写引擎 |
| **开发者工具集** | `dev` / `开发者` / `kfz` | Base64、URL 编解码、UUID、正则测试、颜色转换、JWT 解码 |
| **开发者手册** | `manual` / `手册` | Git、Linux、HTTP 状态码、VS Code 快捷键等速查表 |
| **文本对比** | `diff` / `对比` | 双栏文本差异对比、逐行与逐字差异高亮 |
| **极简便签** | `memo` / `便签` | 极简临时记事板、多标签保存、自动持久化 |
| **Markdown 笔记** | `md` / `笔记` | 实时预览双栏 Markdown 编辑、代码高亮、大纲导航 |
| **密码保险箱** | `pwd` / `密码` | 本地高强度加密密码库、随机强密码生成、闲置自动锁定 |
| **图片悬浮置顶** | `float` / `贴图` | 屏幕贴图、图片置顶悬浮、透明度与缩放调节 |
| **图床上传** | `img` / `图床` | SM.MS / GitHub / 阿里云等常见图床快捷上传与 Markdown 链接生成 |
| **局域网快传** | `lan` / `快传` | 免装客户端局域网扫码互传、网页端大文件快速传输 |
| **全网热搜榜** | `hot` / `热搜` | 百度、微博、知乎、B 站、掘金等实时全网热搜聚合 |
| **伪数据生成** | `mock` / `fake` | 中文姓名、手机号、身份证、地址、银行卡等测试数据生成 |
| **数据备份恢复** | `backup` / `备份` | 全插件配置与数据一键导出/导入，支持跨机迁移 |
| **应用启动器** | `app` / `启动` | 本机应用快速检索与启动（支持 macOS 与 Windows） |
| **Hello 示例** | `hello` / `你好` | 开发者最小示例插件 |

## 插件开发（速览）

新增插件：新建 `src/plugins/<id>/`，放入 `manifest.ts`（协议 v1 清单）与 `index.vue`（渲染入口，props: `ctx` / `query` / `initialCommand`），可选 `backend/index.ts`（常驻任务）。重启 dev 或重新 build 即被 glob 自动发现，宿主代码零改动。详见 `docs/DESIGN.md` 与 `AGENTS.md`。

外部插件目录：`<userData>/plugins/<id>/manifest.json`——预留外部扩展生态。

## 目录结构

```
sdk/                 插件协议 SDK（宿主与插件的唯一共享面）
src/main/            主进程（窗口管理/独立窗口/托盘/快捷键/设置存储/插件加载/IPC services）
src/preload/         contextBridge 安全桥（单通道 invoke + 受限事件订阅）
src/renderer/        渲染层（一体化搜索框/9列网格结果/路由状态机/插件宿主/设置页）
src/plugins/         内置 25 个生产级插件
tests/               vitest 单测套件（142 个测试文件，1434+ 测试）
docs/                架构设计与视觉规范文档
```

设置与插件数据存储于系统 userData 目录（`settings.json` 原子写 + 防抖；插件各自 `storage/<pluginId>/` 物理隔离）。

## 已知限制

- 多音字取默认读音；`gsrh` 类误拼首字母不保证命中（正确形式 `gsh`）
- Windows 亚克力效果、开始菜单扫描、快捷键占用需真机验证（开发机为 macOS）
- GUI 交互（唤起速度、失焦隐藏、玻璃主题观感等）属人工验证项
