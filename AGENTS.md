# GTools 项目规范（供 AI 会话自动读取）

自制类 uTools 桌面效率启动器。完整技术方案见 `docs/DESIGN.md`（冲突处以该文档为准，除非其与现实不符——例如 Electron 44 clipboard 已异步化）。

## 技术栈与硬约束

- Electron 44 + Vue 3 组合式 API + TypeScript（strict）
- 构建 electron-vite 5：**主进程 ESM（out/main/index.mjs）、preload CJS（out/preload/index.cjs，sandbox:true 下 preload 不能用 ESM）**、渲染层 Vite + @vitejs/plugin-vue
- 运行时依赖只许 `vue`、`pinyin-pro`、`qrcode`、`marked`、`pdf-lib`（新增纯 JS 库须先确认无原生编译）；**禁止引入需要原生编译（node-gyp）的依赖**（本机 CLT 有已知坑）
- .npmrc 必须保留 npmmirror registry 与 electron 镜像，勿删
- 测试 vitest（node 环境纯逻辑）；被测主进程模块的 electron/fs 依赖一律构造注入，不在顶层 import electron

## 目录结构（物理分层，勿混）

```
sdk/                    协议 SDK：宿主与插件唯一共享面（manifest 类型+校验、HostApi/BackendContext、快捷键规则、AppSettings）
src/main/               主进程：index 入口 / window / tray / shortcut / settings-store / plugin-registry / plugin-loader / services/（ipc、dispatch、electron-services、storage）
src/preload/            安全桥：单通道 invoke + host 通道 + 白名单事件订阅，不许加宽暴露面
src/renderer/src/       shell/（App、SearchBox、ResultList、PluginViewHost、SettingsPage、router 状态机）+ core/（matcher、pinyin-index、entries、registry、host-client）
src/plugins/<id>/       内置插件：manifest.ts + index.vue (+ views/ + views/logic/ + 可选 backend/index.ts)
tests/                  vitest 单测，文件名与被测模块对应
```

## 插件规约

- 插件渲染层只许 import：`@sdk/*`、`vue`、白名单纯 JS 依赖（`pinyin-pro` / `qrcode` / `marked` / `pdf-lib`）、自己目录内相对路径；**插件两两之间禁止 import**（零共享状态）
- backend 额外允许 `node:` 前缀内建模块（http/os/crypto 等），仍禁止 import electron；文件读写/对话框/浮窗等能力只经 ctx（权限与用户授权路径边界）
- 新增公共能力用法（浮窗、文件对话框、受限文件读写、net 增强、备份格式）见 `docs/DESIGN.md` 附录 A
- manifest 必须 `protocolVersion: 1`；id 为 kebab-case；keywords 非空且不得与启用插件冲突；`activation: 'resident'` 必须带 backend
- 渲染入口固定 props：`ctx: PluginContext`、`query: string`（keyword 后剩余输入）、`initialCommand?: string`
- backend 生命周期：`init(ctx) → start() → stop()`（禁用即停）+ 可选 `dispose()`；能力只经 ctx（与渲染层 HostApi 同构），不得 import electron
- 通用 API 与插件专属 API 的判定：能脱离插件描述成服务品类、消费方 ≥2（或路线图明确多消费方）、配置属 endpoint/key/模板等技术凭证 → 进全局 API 配置中心（设置页统一管理，插件经 `host.apis` + `apis:<service>` 权限调用，密钥不下发渲染层）；仅单插件消费难品类化、或业务偏好类配置（语言方向/容量/皮肤）留在插件自己的设置页（细则见 docs/DESIGN.md 附录 B.3）
- 拖拽取文件路径：渲染层 `window.gtools.pathForFile(file)`（Electron 44 无 File.path），随后必须 `ctx.host.fs.grant(paths)` 才能读写
- 新增内置插件 = 新建目录重启构建即可（两侧 import.meta.glob 自动发现），**不许为此改宿主装配代码**
- 外部插件（userData/plugins/）当前只做清单校验与检测提示，不实例化

## 命名与代码约定

- 文件 kebab-case；Vue 组件 PascalCase；类型/接口 PascalCase；单测 `*.test.ts`
- UI 颜色一律取 `src/renderer/src/assets/themes.css` 的 CSS 变量，禁止硬编码色值
- 主题三态 `light | dark | glass`（html data-theme + 主进程窗口 vibrancy/亚克力联动）
- IPC 通道：插件走 `gtools:api`（单通道，主进程按 manifest.permissions 白名单校验），宿主 UI 走 `gtools:host`；渲染事件通道白名单在 preload 维护

## 注释纪律（用户强规则）

注释必须精简：禁止 HTML 标签与 `{@link}` 长篇 Javadoc，禁止多行编号「设计要点」注释块。只写代码本身看不出来的信息（为什么、坑、约束），一两句话。

## Git 纪律（用户强规则）

- 绝不提交会话产物（分析/方案 md、dashboard html、临时脚本）；测试文件与本地环境配置不提交
- 新增源码文件必须当场 `git add`；本仓库当前只 add 不 commit，由用户自行提交
