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

- 默认全局快捷键：macOS `Alt+Space`，Windows `Ctrl+Alt+Space`（设置页可改，冲突时保留旧绑定）
- 输入即搜：支持中文、英文、全拼（`geshi` →「JSON 格式化」）、首字母（`kfz` →「开发者工具」）
- 输入插件关键字 + 空格进入插件上下文（如 `dev ` 进开发者工具集、`hello ` 进示例插件）
- `↑↓` 选择、`Enter` 进入、`Esc` 逐级退出（插件 → 搜索 → 隐藏窗口）；失焦自动隐藏
- 托盘菜单：显示 / 设置 / 退出（无 Dock 常驻，托盘是唯一退出入口）
- 主题：白色 / 黑色 / 玻璃（macOS vibrancy、Windows 亚克力）

## 内置插件

| 插件 | 关键字 | 说明 |
|---|---|---|
| 开发者工具集 | `dev` / `开发者` / `kfz` | JSON 格式化校验、时间戳互转、UUID、Base64、正则测试、颜色转换、JWT 解码（不验签） |
| Hello 示例 | `hello` / `你好` | 最小示例，证明「新增插件 = 新建目录，宿主零改动」 |

翻译、剪贴板历史、应用启动器为后续版本计划（协议已就绪）。

## 插件开发（速览）

新增插件：新建 `src/plugins/<id>/`，放入 `manifest.ts`（协议 v1 清单）与 `index.vue`（渲染入口，props: `ctx` / `query` / `initialCommand`），可选 `backend/index.ts`（常驻任务）。重启 dev 或重新 build 即被 glob 自动发现，宿主代码零改动。详见 `docs/DESIGN.md` 与 `AGENTS.md`。

外部插件目录：`<userData>/plugins/<id>/manifest.json`——当前仅做协议解析与校验（检测提示），动态加载为后续版本能力。

## 目录结构

```
sdk/                 插件协议 SDK（宿主与插件的唯一共享面）
src/main/            主进程（窗口/托盘/快捷键/设置存储/插件加载/IPC services）
src/preload/         contextBridge 安全桥（单通道 invoke + 受限事件订阅）
src/renderer/        渲染层（搜索框/结果列表/路由/插件视图容器/设置页）
src/plugins/         内置插件（devtools、hello）
tests/               vitest 单测
docs/                设计文档
```

设置与插件数据存储于系统 userData 目录（`settings.json` 原子写 + 防抖；插件各自 `storage/<pluginId>/` 物理隔离）。

## 已知限制

- 多音字取默认读音；`gsrh` 类误拼首字母不保证命中（正确形式 `gsh`）
- Windows 亚克力效果、开始菜单扫描、快捷键占用需真机验证（开发机为 macOS）
- GUI 交互（唤起速度、失焦隐藏、玻璃主题观感等）属人工验证项
