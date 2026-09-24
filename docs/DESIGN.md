# GTools 技术方案（DESIGN.md）

> 依据：docs/TASKS.md（2026-09-23 需求基线）+ 本机环境约束（macOS 14 Intel x64、node v22.23.2、禁原生编译依赖、npmmirror 镜像）。
> 本文是 coder 可直接落地的技术方案：模块划分、接口契约（TypeScript 签名）、数据流、目录结构、脚本与测试策略。
> 选型版本均已用 `npm view --registry=https://registry.npmmirror.com` 验证可得（2026-09-23）：electron 44.4.5、electron-vite 5.0.0（engines `^20.19.0 || >=22.12.0`，本机满足）、electron-builder 26.15.3（无 postinstall）、vue 3.5.43、vitest 5.0.1、pinyin-pro 3.29.4（零依赖、无 install 脚本）、plist 5.0.0（依赖仅 @xmldom/xmldom + xmlbuilder，纯 JS）。

---

## 0. 选型结论速览

| 决策点 | 结论 | 关键理由 |
|---|---|---|
| 前端框架 | **Vue 3（组合式 API）+ TypeScript** | 插件 UI = 「一个目录 + 一个入口组件」天然映射到 Vue 动态组件懒加载；运行时体积与挂载开销小于 React，利于唤起 ≤300ms；单文件组件便于四插件并行开发互不干扰（B6）；纯 JS 无原生编译 |
| 构建 | **electron-vite 5**（内置 Vite 7） | 主/预加载/渲染三 target 一份配置；dev 模式渲染层 HMR + 主进程改动自动重启；支持主进程 ESM 输出（插件 backend 懒加载的前提） |
| 打包 | **electron-builder** | 一份 electron-builder.yml 同时出 macOS .app/.dmg 与 Windows NSIS 配置（T0.3 要求 win 配置就绪、实测后置） |
| 拼音库 | **pinyin-pro**（仅用其拼音数据，不用其 match） | 纯 JS 零依赖；匹配与评分算法自研以便单测（T1.3 用固定词条驱动验收） |
| 测试 | **vitest**（node 环境，纯逻辑） | 与 Vite 同链，无 GUI 依赖，满足无人值守验证 |
| 存储 | **自研 JSON 文件存储**（原子写） | 避免任何额外依赖；需求规模（设置 + 插件 KV + 剪贴板索引）足够 |
| 依赖总量 | 运行时仅 `vue`、`pinyin-pro`、`plist`；其余全为 devDependencies | 遵守"无原生编译"环境约束（已逐一核验） |

**固定脚本名（package.json）**：

```jsonc
{
  "scripts": {
    "dev": "electron-vite dev",                       // 本地调试（本会话无人值守，不运行）
    "build": "electron-vite build",                   // 编译主/预加载/渲染产物到 out/（门禁项）
    "typecheck": "tsc --noEmit -p tsconfig.node.json && vue-tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",                             // 门禁项
    "dist": "electron-vite build && electron-builder --mac",   // 打安装包，不进门禁
    "dist:win": "electron-vite build && electron-builder --win" // Windows 出包（T4.1 实测）
  }
}
```

**`.npmrc`（必须，项目根，T0.1 交付）**：

```ini
registry=https://registry.npmmirror.com
electron_mirror=https://npmmirror.com/mirrors/electron/
```

electron-builder 运行期另需环境变量 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`（写入 dist 的说明文档，不进门禁故不阻塞）。

---

## 1. 工程与目录结构

物理分层原则（T0.2 的核心，A3/B6 的物理前提）：**宿主（src/main + src/preload + src/renderer）、插件（src/plugins/<id>/）、协议 SDK（sdk/）三者顶层分离**。插件只允许 import 三类东西：`sdk`、`vue`、自己目录内的相对路径（含自己引入的纯 JS 三方库）。静态依赖检查规则就按白名单执行。

```
GTools/
├── .npmrc                          # 镜像配置（见上）
├── package.json
├── electron.vite.config.ts         # main/preload/renderer 三段配置
├── electron-builder.yml            # mac dmg + win nsis 配置
├── tsconfig.json / tsconfig.node.json / tsconfig.web.json
├── AGENTS.md                       # T0.2 交付：目录约定 + 插件开发规约 + 注释/提交纪律引用
├── docs/                           # TASKS.md / DESIGN.md（本文件）
├── resources/                      # 应用图标、托盘图标（打包资源）
├── sdk/                            # ★ 插件协议 SDK：宿主与插件的唯一共享面
│   ├── manifest.ts                 # PluginManifest 类型、PROTOCOL_VERSION、校验规则
│   ├── api.ts                      # HostApi / Permission / PluginContext / BackendContext 接口
│   └── index.ts
├── src/
│   ├── main/                       # 宿主主进程（ESM 输出）
│   │   ├── index.ts                # 入口：单实例锁、Dock 隐藏、托盘、app 生命周期
│   │   ├── tray.ts                 # 托盘菜单（显示/设置/退出——无 Dock 时的唯一退出入口）
│   │   ├── window.ts               # 搜索窗：无边框/居中/失焦隐藏/主题窗口效果
│   │   ├── shortcut.ts             # 全局快捷键注册、冲突处理
│   │   ├── settings-store.ts       # settings.json 读写（原子写 + 防抖）
│   │   ├── plugin-loader.ts        # 清单扫描/协议版本校验/ID 查重/backend 懒加载
│   │   ├── plugin-registry.ts      # 运行时注册表 + 启用/禁用状态
│   │   └── services/               # HostApi 的主进程实现
│   │       ├── ipc.ts              # IPC 路由：按 pluginId 校验 permission 后分发
│   │       ├── storage.ts          # userData/storage/<pluginId>/ 命名空间隔离
│   │       ├── clipboard.ts net.ts shell.ts notify.ts
│   ├── preload/
│   │   └── index.ts                # contextBridge 单通道桥（见 §2.3）
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── app.ts              # createApp 挂载
│   │       ├── shell/              # 外壳 UI：搜索框/结果列表/路由容器/设置页
│   │       │   ├── App.vue         # 顶层布局：SearchBox + (ResultList | PluginViewHost | SettingsPage)
│   │       │   ├── SearchBox.vue
│   │       │   ├── ResultList.vue
│   │       │   ├── PluginViewHost.vue   # B5 视图容器 + B2 错误降级
│   │       │   ├── SettingsPage.vue     # 快捷键录入 + 主题切换 + 插件启用列表
│   │       │   └── router.ts            # 关键字路由状态机（见 §2.5）
│   │       ├── core/
│   │       │   ├── matcher.ts           # 四路模糊匹配 + 评分（纯函数）
│   │       │   ├── pinyin-index.ts      # 词条拼音预索引（pinyin-pro 数据源）
│   │       │   ├── entries.ts           # 全局词条装配（宿主词条 + 各插件词条）
│   │       │   ├── registry.ts          # 渲染侧插件装配：glob 懒加载 entry 组件
│   │       │   └── host-client.ts       # HostApi 渲染侧实现（自动绑定 pluginId）
│   │       └── assets/{base.css, themes.css}
│   └── plugins/                    # ★ 内置插件，每插件一目录，两两之间禁止 import
│       ├── devtools/
│       │   ├── manifest.ts
│       │   ├── index.vue           # 渲染入口（被 PluginViewHost 动态挂载）
│       │   └── views/{JsonTool,TimeTool,UuidTool,Base64Tool,RegexTool,ColorTool,JwtTool}.vue
│       ├── translate/
│       │   ├── manifest.ts
│       │   ├── index.vue
│       │   ├── providers/{types.ts,mymemory.ts,manual.ts}
│       │   └── settings.vue        # 插件自己的设置面板（provider/密钥，存自己 storage）
│       ├── clipboard-history/
│       │   ├── manifest.ts         # activation: 'resident'
│       │   ├── index.vue
│       │   ├── backend/index.ts    # 主进程轮询（常驻任务本体）
│       │   └── history.ts          # 记录/去重/容量淘汰（纯逻辑，可单测）
│       └── app-launcher/
│           ├── manifest.ts
│           ├── index.vue
│           ├── backend/index.ts    # 扫描 + 缓存 + 启动
│           └── scan/{darwin.ts,win32.ts,types.ts}
└── tests/                          # vitest 单测（见 §6）
    ├── matcher.test.ts  manifest.test.ts  plugin-loader.test.ts
    ├── storage.test.ts  clipboard-history.test.ts  translate-providers.test.ts
    ├── app-scan.test.ts  devtools-tools.test.ts  settings-store.test.ts
```

**electron.vite.config.ts 要点**：main 段 `build.rollupOptions.output.format = 'es'`（Electron 44 主进程 ESM 成熟；这是插件 backend 懒加载的前提）；renderer 段 `build.rollupOptions.input = 'src/renderer/index.html'`，`resolve.alias` 配 `@sdk → sdk/`、`@shell → src/renderer/src`。

---

## 2. 壳层设计

### 2.1 主进程窗口（T1.2）

`src/main/window.ts` 创建**唯一主窗口**，应用生命周期内只创建一次，隐藏 = `win.hide()`（渲染进程不销毁，保证再次唤起瞬时）：

```ts
function createSearchWindow(): BrowserWindow {
  return new BrowserWindow({
    width: 720, height: 560,
    frame: false, resizable: false, fullscreenable: false,
    show: false,                    // 首次由快捷键触发 show
    skipTaskbar: true,              // Windows 不进任务栏
    backgroundColor: '#00000000',   // 主题联动时按需覆盖，见 §5.1
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      spellcheck: false
    }
  })
}
```

- **居中**：`x = workArea.x + (workArea.width - 720) / 2`，`y = workArea.y + workArea.height * 0.28`（水平居中、垂直偏上，误差 ≤8px 判据按此式成立）。位置只在创建时计算一次，之后 hide/show 不重算 → 「再次唤起位置不变」天然满足；用户经 `-webkit-app-region: drag`（搜索窗顶栏）拖动后位置同样保留。
- **失焦隐藏**：`win.on('blur', () => hideSearchWindow())`。已知坑（写进实现）：macOS 上窗口刚 `show()` 的瞬间可能收到一次假 blur，处理——`show()` 后记录 `lastShownAt`，blur 回调若距 `lastShownAt` < 200ms 则忽略。窗口内点击/拖动/选中文本不会触发 blur，T1.2 判据 4 天然满足。
- **唤起**：`showSearchWindow()`：`win.show(); win.focus()`；渲染层在 `document.visibilitychange → visible` 时清空或全选搜索框并聚焦光标（≤300ms 判据由"不销毁窗口"保证）。
- **单实例**（入口 `src/main/index.ts`）：`app.requestSingleInstanceLock()`；失败则 `app.quit()`；`second-instance` 事件 → 唤起窗口。
- **后台常驻**：macOS `app.dock.hide()`；Windows 依赖 `skipTaskbar`。因此**必须有托盘**（`src/main/tray.ts`）：菜单 = 显示 GTools / 设置 / 退出，托盘图标常驻。退出时 `globalShortcut.unregisterAll()` + `app.quit()`，确保 T0.1 判据 2（无残留进程）。

### 2.2 全局快捷键（T1.1）

`src/main/shortcut.ts`：

- 默认值（写入 `settings.json`，设置页可改）：
  - **macOS：`Alt+Space`**（Option+Space，系统无占用，与 uTools 默认一致）
  - **Windows：`Ctrl+Alt+Space`**（Alt+Space 是 Windows 活动窗口系统菜单键，必须避开）
  - 设置存储结构带平台维度：`{ hotkey: { darwin: 'Alt+Space', win32: 'Ctrl+Alt+Space' } }`，注册时按 `process.platform` 取值。
- 语义：toggle——可见则隐藏，不可见则唤起（T1.1 判据 2）。
- 注册/换绑流程：`globalShortcut.register(accel, cb)` 返回 `false` 即冲突 → 通过 `Notification` 与设置页红字提示，**保留旧绑定可用**，应用不崩（判据 3）。
- 设置页录入校验：必须含至少一个修饰键（Ctrl/Cmd/Alt/Shift）且至少一个非修饰键；`Cmd+C` 等纯系统组合按内置黑名单拒绝（黑名单常量在 `sdk/shortcut-rules.ts`，含 C/V/X/Tab 等单修饰组合；Space 单修饰组合按平台区分——win32 全拒（Alt+Space 窗口菜单/Ctrl+Space 输入法），darwin 仅拒 Cmd/Ctrl（Spotlight/输入源），Alt+Space 是 mac 默认键放行）。
- 持久化：换绑成功即写 `settings.json`，重启在 `app.ready` 后重新注册（判据 4）。

### 2.3 preload 安全桥（contextIsolation）

**单通道、最小面**。preload 不暴露任何枚举出来的具体能力，只暴露一个泛化调用入口 + 事件订阅：

```ts
// src/preload/index.ts 对渲染层暴露的全部内容
contextBridge.exposeInMainWorld('gtools', {
  invoke: (pluginId: string, api: string, payload: unknown) =>
    ipcRenderer.invoke('gtools:api', { pluginId, api, payload }),
  // 宿主→渲染的通用事件（主题变更、插件禁用、backend 推送等）
  on: (channel: string, listener: (payload: unknown) => void) =>
    ipcRenderer.on(channel, (e, payload) => listener(payload)),
})
```

渲染层 `core/host-client.ts` 把它包装成强类型 `HostApi` 客户端：`createHostClient(pluginId)` 返回的每个方法内部自动携带 `pluginId` 调 `window.gtools.invoke`。**主进程 `services/ipc.ts` 是安全边界**：`ipcMain.handle('gtools:api')` 校验 `pluginId` 已启用、`api` 在其 manifest `permissions` 允许的集合内，否则拒绝并返回结构化错误。插件伪造他人 pluginId 的防御本期不做（无外部插件，非目标），在 sdk/api.ts 注释中声明该前提。

### 2.4 拼音/英文模糊匹配（T1.3）

数据结构（`core/pinyin-index.ts` + `core/matcher.ts`，**全部纯函数，可单测**）：

```ts
interface SearchEntry {          // 全局词条：宿主词条 + 各插件词条的统一形态
  key: string                    // `${pluginId}:${commandId | '_main'}`
  title: string                  // 例「JSON 格式化」
  subtitle?: string
  icon: string                   // emoji 或插件资源
  pluginId: string
  commandId?: string             // 存在则选中后直接进该子命令视图
}

interface PinyinIndexed {        // 对 title 预计算，Map<title, PinyinIndexed> 缓存
  lower: string                              // 小写原文
  syllables: string[]                        // pinyin-pro: pinyin(title,{toneType:'none',type:'array'})
  initials: string                           // pinyin-pro: pattern:'first' 拼接
}

// matcher.ts 入口：query 小写化后四路判定，返回 null 或评分（越小越靠前）
matchEntry(query: string, e: SearchEntry, idx: PinyinIndexed): number | null
```

匹配规则（按优先级）：
1. **原文子串**：`idx.lower.includes(query)`；命中位置越靠前分越低。
2. **全拼音节串**：query 在 `syllables.join('')` 中命中，且起点对齐音节边界（贪心按音节切 query），如 `geshi` → `geshihua` 前缀 ✅。
3. **首字母串**：query 是 `initials` 的（连续或非连续）子序列，如 `gsrh`→见 §7 开放点；`kfz` ⊆ `kfzgj`（开发者工具）✅ 非连续子序列。
4. 中文子串被规则 1 覆盖（query 原样 includes）。

排序：规则 1 < 2 < 3 基础分递增；同规则内 前缀命中 < 中部命中 < 非连续分散。无命中 → 外壳渲染「无结果」占位（T1.3 判据 3，不做空列表）。多音字取 pinyin-pro 默认读音（已知限制，记 §7）。100 词条规模直接全量算（微秒级），不加 debounce，满足 ≤100ms。

### 2.5 关键字路由 + 插件视图容器（T1.5）

`shell/router.ts` 状态机（渲染层，不涉主进程）：

```
状态 mode: 'global' | 'plugin' | 'settings'
query 形如 "<keyword> <rest>"（keyword 与 rest 以首个空格分隔）

global 模式：
  - 输入变化 → matcher 对全部词条计算 → ResultList 展示
  - 词条回车 → commandId ? 进入插件并携带 initialCommand : 仅携带 rest
  - 输入恰为某激活插件的 keyword 且按下空格 → 切 plugin 模式（keyword 精确/唯一前缀匹配，来自 manifest.keywords）
plugin 模式：
  - SearchBox 显示 "<keyword> rest"，keyword 段高亮为插件上下文（判据 1）
  - rest 与 initialCommand 通过 props 传给插件组件，插件自治其列表/视图
  - Esc → 回 global（清 keyword 留 cursor）；global 下 Esc → IPC 调 window.hide
settings 模式：
  - 宿主词条「设置 / settings / sz」进入；Esc 同级退出
```

**PluginViewHost.vue**（B2 + B5 的落点）：
- 结构上搜索框永远在插件容器**之外**的固定顶栏；插件渲染于下方 `overflow: hidden` 的固定高度容器，DOM 层级与 CSS（容器无 fixed/窗口级 API）决定插件无法遮挡搜索框、无法改窗口行为（判据 3）。
- 插件组件经 `core/registry.ts` 的 Vite glob 懒加载获取：`const entries = import.meta.glob('../../plugins/*/index.vue')`，key 由 plugin-loader 下发的清单提供 → **移除插件目录后 dev 重启即从路由消失，宿主代码零改动**（A2 判据的 dev 期验证路径）。
- B2 错误隔离：容器组件包 `onErrorCaptured`，捕获后卸载插件组件、渲染「该插件出错，可反馈/禁用」降级面板，外壳与其他插件不受影响。

---

## 3. 插件协议 v1（本方案重中之重）

对应 TASKS A1–A4 / B1–B6 / C 组全部条款。协议三要素：**清单（manifest）+ 渲染入口（entry）+ 可选主进程模块（backend）**，类型与常量全部定义在 `sdk/`，宿主与插件只经 `sdk` 交互。

### 3.1 manifest 字段定义

```ts
// sdk/manifest.ts
export const PROTOCOL_VERSION = 1 as const

export type Permission =
  | 'clipboard:read' | 'clipboard:write'
  | 'storage'          // 仅自己命名空间
  | 'net'              // 经宿主 net.fetch（无 CORS、走系统代理）
  | 'notification'
  | 'shell:open'       // openApp / openPath
  | 'window:hide'      // 仅隐藏搜索窗，无其他窗口能力

export interface PluginCommand {     // 功能项声明：进全局搜索 + 插件内直达
  id: string                         // 插件内唯一，如 'json-format'
  title: string                      // 全局词条标题，如「JSON 格式化」
  keywords?: string[]                // 额外匹配词
}

export interface PluginManifest {
  id: string                // 全局唯一，kebab-case，^[a-z][a-z0-9-]*$
  name: string              // 显示名，可中文
  version: string           // semver
  protocolVersion: number   // 加载前校验 === PROTOCOL_VERSION，否则拒绝（A4）
  description?: string
  icon: string              // emoji（MVP 统一用 emoji，避免图标资源管理）
  keywords: string[]        // 路由触发关键字（进入插件用），如 ['dev','开发者','kfz']
  activation: 'trigger' | 'resident'   // B4：触发式 / 常驻式
  permissions: Permission[]
  source: 'builtin' | 'external'       // C 组预留，本期恒为 builtin，external 走 userData/plugins
  entry: string             // 渲染入口相对路径，约定 './index.vue'
  backend?: string          // 主进程模块相对路径，约定 './backend/index.ts'；常驻插件必填
  commands?: PluginCommand[]
}
```

四个内置插件的清单要点：

| 插件 | id | keywords | activation | permissions | commands |
|---|---|---|---|---|---|
| 开发者工具集 | `devtools` | `dev` `开发者` `kfz` | trigger | storage | 7 条（json-format / timestamp / uuid / base64 / regex / color / jwt） |
| 翻译 | `translate` | `fy` `翻译` `fanyi` | trigger | net, clipboard:read, clipboard:write, storage, notification | — |
| 剪贴板历史 | `clipboard-history` | `cb` `剪贴板` `jtb` | **resident** | clipboard:read, clipboard:write, storage | — |
| 应用启动器 | `app-launcher` | `app` `启动` `qd` | trigger | shell:open, storage, notification | — |

> 第二期新增权限（`window:float` / `dialog` / `fs`）与浮窗、文件读写、备份等公共能力见**附录 A**；第三期新增 `apis:translate`（全局 API 配置中心）与 var-name 插件见**附录 B / C**。

### 3.2 加载流程与生命周期（A1 / A2 / B3 / B4）

`src/main/plugin-loader.ts` 启动序列（`app.ready` 后）：

1. **扫描发现**（来源两处，同一处理管线，A1 无特权旁路）：
   - 内置：`import.meta.glob('../plugins/*/manifest.ts')`（Vite 宏，构建期展开为存在的目录 → 移除目录即从产物消失，宿主代码零改动）；
   - 外部（本期仅到"协议预留验证"）：扫描 `app.getPath('userData')/plugins/*/manifest.json`。本期对 external 只做**清单解析 + 校验**，校验通过则记为「检测到外部插件：动态加载需等待后续版本」提示，不实例化（T4.4 后置，C 组判据是"路径未被堵死"）。
2. **校验**（不通过 → 跳过该插件、收集错误原因，绝不抛崩宿主）：
   `protocolVersion === 1`（A4）；`id` 格式合法且与已加载者不重复（B1，后到者拒绝）；`keywords` 非空且不与其他**启用中**插件冲突（冲突 → 后到者拒绝并提示）；`activation: 'resident'` 必须有 `backend`。
   错误清单通过托盘通知 + 设置页「插件」分区展示（用户可读，A4 判据）。
3. **注册**：写入 `plugin-registry.ts`（Map<id, {manifest, enabled, backendInstance?}>），清单经 IPC 下发渲染层。
4. **backend 装配**（懒加载，B4）：
   - `trigger` 型：**不加载 backend**（devtools 无 backend；app-launcher 的 backend 属「按需能力」——见 3.4 说明，其启动时机为首次进入插件时 `init`，与常驻无关）；
   - `resident` 型：立即 `await import(backend 路径)` → `init(ctx)` → `start()`。backend 经懒加载 glob 获取：`import.meta.glob('../plugins/*/backend/index.ts')`。

**生命周期钩子**（主进程侧，`BackendContext` 与渲染层 HostApi **同构**——同一套能力面，主进程内直接函数调用不走 IPC，A3「内部插件同样只许用这套 API」由此成立）：

```ts
// sdk/api.ts
export interface PluginBackend {
  init(ctx: BackendContext): Promise<void>
  start(): Promise<void>    // resident 启用时 / trigger 首次进入时
  stop(): Promise<void>     // 禁用时（B3：常驻任务立即停）
  dispose?(): Promise<void> // 应用退出前
}
```

**启用/禁用（T1.6，B3）**：设置页切换 → 主进程 registry 更新 + 持久化到 `settings.json` 的 `disabledPlugins: string[]` → resident 型调 `backend.stop()`（禁用）/ `start()`（启用），即时生效；渲染层收到 `plugin-state-changed` 事件重算全局词条与路由表（关键字消失/恢复）。禁用状态跨重启保持（判据 3）。

### 3.3 宿主 API 面（A3，版本化）

```ts
// sdk/api.ts —— apiVersion 随 PROTOCOL_VERSION 走，v1 全集
export interface HostApi {
  readonly apiVersion: 1
  clipboard: {
    readText(): Promise<string>
    writeText(t: string): Promise<void>
    readImage(): Promise<{ width: number; height: number; dataUrl: string } | null>  // 只给 dataUrl，不给 nativeImage
    writeImage(dataUrl: string): Promise<void>
  }
  storage: {                       // B1：物理隔离 userData/storage/<pluginId>/
    get<T>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
    remove(key: string): Promise<void>
    keys(): Promise<string[]>
  }
  net: { fetch(url: string, init?: { method?: string; headers?: Record<string,string>; body?: string; timeoutMs?: number }): Promise<{ ok: boolean; status: number; body: string }> }
  notification: { show(title: string, body: string): Promise<void> }
  shell: { openApp(target: string): Promise<void>; openPath(p: string): Promise<void> }
  window: { hide(): Promise<void> }            // B5：仅此一个窗口能力
  app: { platform: string; version: string }
  events: { on(event: string, cb: (p: unknown) => void): () => void }   // backend 推送 / 宿主事件
}
```

主进程 `services/ipc.ts`：`ipcMain.handle('gtools:api', {pluginId, api, payload})` → 查 registry（存在且 enabled）→ 按 manifest.permissions 白名单校验 api 前缀 → 分发到 services 实现。越权/未启用返回 `{ ok: false, error: 'PERMISSION_DENIED' | 'PLUGIN_DISABLED' }` 结构化错误。

### 3.4 渲染入口契约与 UI 边界（B5 / B6）

```ts
// 插件渲染入口：一个接收固定 props 的 Vue 组件
// src/plugins/<id>/index.vue
defineProps<{
  ctx: PluginContext       // 见下
  query: string            // keyword 之后的剩余输入，响应式
  initialCommand?: string  // 从全局 commands 直达时携带
}>()

export interface PluginContext {
  manifest: PluginManifest
  host: HostApi             // host-client.createHostClient(manifest.id)，已绑定身份
}
```

- 插件 UI 全部经 PluginViewHost 容器挂载（§2.5），边界即 B5；插件自身路由（如 devtools 七工具导航）在组件内部自治。
- **B6 零共享状态**：插件目录间无 import（静态检查项）；宿主事件是唯一广播渠道。
- app-launcher 的 `backend` 说明：它是 trigger 型但带 backend（扫描/缓存/启动属主进程职责）——协议允许 trigger 型带 backend，其 `start()` 在**首次进入插件**时由宿主调用、`stop()` 在禁用时调用。清单校验只强制「resident 必有 backend」，不禁止 trigger 带。

### 3.5 新增插件 = 零改动公共代码（A2 判据的操作路径）

1. 新建 `src/plugins/<新id>/`，放入 `manifest.ts` + `index.vue`（+ 可选 backend）；
2. 重启 dev（或重新 build）——glob 自动发现，路由、词条、设置页列表全部出现。
宿主任何文件（含注册表）不需要改。T1.4 交付的**空壳示例插件**即按此路径创建（建议 id `hello`，仅 manifest + 最简 index.vue），它同时是外部路径未堵死的证明。

---

## 4. 四个 MVP 插件接口契约与数据流

### 4.1 开发者工具集 devtools（T3.1，触发式，纯渲染层）

无 backend、无网络、无剪贴板写权限之外的状态。`index.vue` 内部左侧 7 项导航 + 右侧当前工具视图；`initialCommand` 直接定位。7 个子工具全部纯函数实现（放各 views 同目录 `logic.ts`，可单测）：

| 子工具 | 契约要点 |
|---|---|
| JSON | `format(json, indent: 2\|4)` / `minify(json)` / `validate(json) → { ok: true, value } \| { ok: false, line, column, message }`（基于 `JSON.parse` 的 `position` 换算行列）；结果区「复制」按钮用 `navigator.clipboard.writeText`（页面内权限，不走宿主 API） |
| 时间戳 | `tsToDate(ts, unit:'s'\|'ms')` / `dateToTs(Date)`（返回 {s, ms} 双值）；当前时间戳每秒刷新用 `setInterval`（窗口隐藏时被节流无碍，重新可见即校准） |
| UUID | `uuidV4()` 基于 `crypto.getRandomValues` 手写 v4（不依赖 `crypto.randomUUID` 的 secure-context 行为）；批量条数输入 1–1000 |
| Base64 | `encode/decode(s)`：TextEncoder/TextDecoder + btoa/atob 组合（UTF-8 中文双向正确）；decode 非法输入 try/catch 返回错误不崩溃 |
| 正则 | `new RegExp(pattern, flags)` try/catch 报语法错误；合法则 `matchAll` 列出全部匹配与分组 |
| 颜色 | `parseColor(input) → {hex, rgb, hsl} \| Error`；HEX↔RGB↔HSL 三向纯数学互转 |
| JWT | `decodeJwt(token)`：split('.') 取前两段 base64url 解码 + JSON.parse；`exp`/`iat` 换算可读时间，`exp < now` 标注「已过期」；**仅解码不验签**（开放点 6 维持） |

### 4.2 翻译 translate（T3.2，触发式，provider 抽象）

**provider 层在渲染进程**（经 `host.net.fetch` 走主进程 `net` 模块，无 CORS、走系统代理）：

```ts
// translate/providers/types.ts
export interface TranslateProvider {
  id: string                                   // 'mymemory' | 'manual-http' | 自定义
  name: string
  needsKey: boolean
  translate(input: {
    text: string; from: 'auto' | 'zh-CN' | 'en' | string; to: string
  }): Promise<{ resultText: string; detectedFrom?: string; providerId: string }>
}
```

- **默认 provider：MyMemory**（`https://api.mymemory.translated.net/get?q=<text>&langpair=<from>|<to>`，免 key、CORS 开放——但我们统一走宿主 net）。`from:'auto'` 由渲染层启发式实现：中文字符占比 > 0.3 → zh-CN→en，否则 en→zh-CN；同时提供手动方向切换（满足「至少其一」，两者都给）。
- 其他 provider（DeepL / 百度 / 彩云等需 key 的）按同一接口注册进 `providers/`，设置面板（插件内 settings 视图）选择 provider + 填 key，存 `host.storage`（`{ providerId, apiKeys: {[id]: string} }`）——**密钥只在本地 userData，不进代码**（判据 5）。
- 数据流：SearchBox query → index.vue（输入区 + 方向切换 + 「读剪贴板」按钮 + 结果区）→ `读剪贴板` = `host.clipboard.readText()` 填入输入框 → 翻译按钮/回车 → provider.translate → 结果展示 + 「复制」（`navigator.clipboard`）。
- 失败处理（B2 交叉判据）：provider 抛错/超时（timeoutMs 默认 10s）→ 结果区显示用户可读错误（断网/密钥无效分类文案），不影响外壳。

### 4.3 剪贴板历史 clipboard-history（T3.3，**常驻式**，B4 首个真实实例）

为什么轮询必须在主进程 backend（设计约束，写给 coder）：窗口 hide 后渲染进程 timer 会被 Chromium 节流（hidden page 连续计时超 5 分钟可降至 1 次/分钟），**渲染层轮询不可靠**。

```
backend/index.ts（主进程，start() 时启动）：
  每 1000ms：
    t = clipboard.readText()
    if t 非空且 t !== lastText → 记录文本条目（lastText=t）
    else if t 为空 → img = clipboard.readImage()（仅文本为空时才读图，省解码开销）
                    if img 非空且 hash(img) !== lastImgHash → 记录图片条目
  记录条目 → history.ts（纯逻辑模块）:
    dedupe：与最新一条内容相同则只更新其时间戳（去重判据）
    cap：超过 maxRecords（settings 默认 500，设置可改）→ 淘汰最旧并删除其图片文件
    持久化：userData/storage/clipboard-history/records.json（索引）+ imgs/<ts>.png（图片本体，
            img 条目只存路径与 w/h，避免内存膨胀）
    推送：webContents.send('plugin-event:clipboard-history', 全量/增量) → 渲染层列表刷新
  stop()：clearInterval，不再产生记录（B3 判据）
```

- 图片去重 hash：`size + width + height + PNG 前 4KB 的 FNV-1a`（nativeImage.toPNG() 取 Buffer，纯 JS 哈希）。
- 渲染层 `index.vue`：倒序列表（类型图标 + 预览文本/缩略图 + 复制时间）→ 顶部搜索框过滤（复用 matcher）→ 点击条目 `host.clipboard.writeText/writeImage`（回贴判据）→「清空」按钮（删索引与 imgs 目录）。
- 隐私开放点（TASKS 开放点 3）落地：设置面板提供「退出时清空历史」开关（默认关）与容量数字（默认 500），存插件 storage。

### 4.4 应用启动器 app-launcher（T3.4，触发式 + backend）

```
backend/index.ts（主进程）：
  init(ctx)：loadCache()（userData/storage/app-launcher/apps.json）
  start()（首次进入插件时宿主调用）：
    if 缓存缺失或超 24h → 后台 rescan（async，不阻塞 UI，先渲染缓存/占位）
  rescan（scan/darwin.ts | win32.ts，平台分派）：
    darwin：扫描 /Applications、~/Applications、/System/Applications（深度限 2 层）下 *.app
      名称：plist 包解析 Contents/Info.plist 的 CFBundleName（用 plist 包，纯 JS；失败回退目录名）
      图标：读 CFBundleIconFile → 'Contents/Resources/<icon>.icns' → spawn 系统自带 sips
            转 64px PNG 到 userData/storage/app-launcher/icons/<bundleId>.png（缓存）；
            sips 失败/无图标 → 无图标占位（首字母色块）。图标增强若耗时异常可整体降级为首字母，不阻塞列表
    win32：扫描 %APPDATA%/Microsoft/Windows/Start Menu/Programs 与
           %PROGRAMDATA%/Microsoft/Windows/Start Menu/Programs 下 *.lnk（递归）
      名称：文件名去扩展名；图标：MVP 用占位（.lnk 图标提取后置到 T4.1）
  启动：host 侧调 shell.openPath(<.app 或 .lnk 绝对路径>)（Electron ShellExecute 等价，
        无需手写 child_process）→ 隐藏搜索窗（判据 3）
  刷新入口：插件视图内「刷新」按钮 → rescan（判据 4 的"可触发"）
```

- 词条：`AppEntry { name, path, iconPath? }` → 渲染层组装 SearchEntry（title=应用名，中文应用名如「微信」经 pinyin-index 后 `wx`/`weixin` 命中——复用 T1.3，判据 2）。
- backend 经 `plugin-event:app-launcher` 推送扫描进度/完成；扫描在 Promise 中异步进行（判据 1「不阻塞界面」）。

---

## 5. 主题系统与设置持久化

### 5.1 主题（T2.1）

- **机制**：`themes.css` 定义 CSS 变量全集（--bg / --bg-glass / --fg / --fg-dim / --accent / --border / --danger 等），`<html data-theme="light|dark|glass">` 切换；全部 UI（含 4 插件视图）只允许取变量，禁止硬编码色值（判据 4 的静态检查项）。glass 复用 dark 的前景变量 + 透明背景变量（--bg: transparent）。
- **原生窗口效果联动**（主题切换时渲染层 IPC → 主进程 window.ts）：
  - mac glass：`win.setVibrancy('under-window')` + `setBackgroundColor('#00000000')`；
  - win glass：`win.setBackgroundMaterial('acrylic')`（Electron 26+，Win11）；Win10 自动降级为不透明深色（窗口层 try/catch，不报错）；
  - light/dark：`setVibrancy(null)` + `setBackgroundMaterial('none')` + `setBackgroundColor('#ffffff' | '#1e1e1e')`。
- 对比度判据 3：变量表按 WCAG AA（正文 ≥4.5:1）取值，写死在 themes.css 一处。

### 5.2 设置持久化（自研）

`src/main/settings-store.ts`，单文件 `userData/settings.json`：

```ts
interface AppSettings {
  hotkey: { darwin: string; win32: string }
  theme: 'light' | 'dark' | 'glass'
  disabledPlugins: string[]
}
```

- 读写：主进程内存持有 + 读时深合并默认值（新增字段向前兼容）；写时 `writeFile(tmp) → rename` 原子替换，300ms 防抖合并连续写。
- 暴露：宿主 IPC（`settings:get/set`，非插件通道）供设置页与快捷键页使用；变更即广播 `settings-changed` 渲染事件（主题即时生效判据）。
- 插件各自设置**不进** settings.json，一律走各自 `host.storage`（B1 隔离）。

---

## 6. 测试策略（vitest，node 环境纯逻辑）

| 测试文件 | 覆盖 | 对应验收 |
|---|---|---|
| tests/matcher.test.ts | 固定词条四路匹配：`json`/`格式化`/`geshi` 命中「JSON 格式化」；`kfz` 命中「开发者工具」；无结果路径；排序优先级 | T1.3 判据 1–3 |
| tests/manifest.test.ts | protocolVersion 错误拒绝；id 非法/冲突拒绝；resident 缺 backend 拒绝；错误信息可读 | A4 / B1 |
| tests/plugin-loader.test.ts | 用临时目录伪造插件集（含空壳插件、互斥 keyword、故意抛错 backend）：装配/拒绝/禁用即时停（backend.stop 被调）/重新启用恢复 | A2 / B2 / B3（逻辑层） |
| tests/storage.test.ts | 两插件互不可见；同插件读写删；目录按 pluginId 物理隔离 | B1 |
| tests/clipboard-history.test.ts | 去重（同内容只更新时间）、容量淘汰 + 图片文件清理、倒序；clipboard 用注入的 fake（backend 依赖注入而非直接 import electron，便于 node 环境测试） | T3.3 判据 2/6 |
| tests/translate-providers.test.ts | MyMemory 响应解析、auto 方向启发式、错误分类（超时/非 200/坏 JSON）；fetch 用注入 fake | T3.2 判据 1/4 |
| tests/app-scan.test.ts | fixture 目录模拟 /Applications 结构（含嵌套 .app、Info.plist 样本）→ 扫描结果；win32 路径分派；缓存淘汰 | T3.4 判据 1/4 |
| tests/devtools-tools.test.ts | JSON 校验行列定位、非法 JSON/非法 Base64/非法正则/非法颜色不抛异常、`你好↔5L2g5aW9`、颜色三向互转、JWT 过期换算、时间戳双向 | T3.1 全表 |
| tests/settings-store.test.ts | 默认值合并、原子写（tmp+rename 被调）、防抖 | T2.x |

依赖注入约定（可测性关键，写给 coder）：所有 backend/主进程 services 的外部依赖（clipboard、net、fs 路径根）经构造参数注入，vitest 传 fake，**不在被测模块顶层 import electron**。

**GUI 人工验证清单**（无人值守环境不可自动验证，交付后人工执行）：快捷键唤起/隐藏/冲突提示（T1.1）、失焦隐藏与位置稳定性（T1.2）、玻璃主题 macOS 目测（T2.1 判据 2）、翻译真实 API 通/断网（T3.2）、剪贴板跨应用回贴与禁用即时停（T3.3）、启动器真机扫描与启动（T3.4）、Esc 逐级退出（T1.5）、`npm run dev` 冒烟与进程无残留（T0.1）、`npm run dist` 出 .app/.dmg 双击运行（T0.3/T4.3）。

---

## 7. 风险与开放点（不替用户拍板，实现期需确认）

1. **`gsrh` 用例疑点（T1.3 判据 1）**：「JSON 格式化」中「格式化」拼音 geshihua / 首字母 gsh，均不含 `r`，按拼音规则 `gsrh` 无法命中该词条。设计按可实现规则落地（`geshi`/`gsrh` 中前者必中），**该用例疑为笔误（应为 `gsh`）**，需与需求方确认后再定测试断言。
2. **主进程 ESM + 插件 backend glob 懒加载**：Electron 44 + electron-vite 5 的 ESM 主进程是成熟路径，但若构建链出问题（CJS 互操作等），退路是「构建期生成式注册表脚本（扫描 plugins/ 生成 registry.ts）」，协议不变，仅装配机制换。已在 §3.2 隔离该风险。
3. **MyMemory 免费额度**：匿名调用有每日限额（约千次级），超限返回 482/429。provider 抽象 + 手动切换已隔离；密钥型 provider 待用户定（TASKS 开放点 1）。
4. **Windows 真机项后置**：亚克力、快捷键占用、开始菜单扫描实测归 T4.1（TASKS 开放点 4）；本方案所有平台分支集中在 window.ts 主题联动、shortcut 默认值、scan/win32.ts 三处，无「仅 macOS 可行」假设。
5. **性能**：唤起 ≤300ms 依赖「窗口 hide 不销毁」+ 托盘常驻，机制上已保证；匹配 ≤100ms 在 100 词条规模为微秒级。真机数字待 T4.2（开放点 5）。
6. 其余沿用 TASKS 第五节开放点 2/3/5/6（默认键值确认、剪贴板隐私选项、性能数值、JWT 验签），本方案给出的默认值均为可配置项，不阻塞开发。

---

## 附录 A：公共能力 API 手册（第二期扩展，插件开发必读）

> 本文是新增公共能力的**唯一权威文档**。所有 API 经 `ctx.host`（渲染层）或 `ctx`（backend）调用，与既有 `storage`/`net` 等同一套权限体系。类型定义在 `sdk/api.ts`。

### A.0 权限项（manifest.permissions 新增）

| 权限 | 解锁的 api | 说明 |
|---|---|---|
| `window:float` | `window.float.create/update/close/closeAll` | 置顶无边框浮窗 |
| `dialog` | `dialog.openFile/saveFile` | 系统文件对话框，选中路径自动授予 fs 权限 |
| `fs` | `fs.grant/read/write/rename/remove/stat/list/mkdir` | **限定在用户主动授权路径内**的文件读写 |

未声明权限调用对应 api 一律返回 `PERMISSION_DENIED`（backend 直调抛错），与既有语义一致。

### A.1 浮窗 window.float（权限 `window:float`）

置顶、无边框、可拖动的小 `BrowserWindow`，图片悬浮/便签提醒类插件的底座。

```ts
const id = await ctx.host.window.float.create({
  html: `<div class="drag" style="padding:12px">
    <img src="data:image/png;base64,..." />
    <button class="no-drag" onclick="gtoolsFloat.emit('close-clicked')">关闭</button>
  </div>`,
  width: 420, height: 320,          // 缺省 360×240，自动夹在 [80,4000]
  x: 100, y: 80,                    // 缺省：光标所在屏工作区居中
  resizable: false,                 // 默认 false
  alwaysOnTop: true,                // 默认 true（mac 用 floating 层级）
  transparent: false,               // true 时背景全透明（win 上透明窗不可原生缩放，改用 update 改尺寸）
  opacity: 1,                       // 0.1–1
  show: true,                       // false 时创建不显示，之后 update 显示/聚焦
  focus: true                       // false 时不抢焦点（showInactive）
})
await ctx.host.window.float.update(id, { html: '<b>new</b>', width: 500, focus: true })
await ctx.host.window.float.close(id)
await ctx.host.window.float.closeAll()   // 关自己插件的全部浮窗
```

**HTML 契约**：
- 宿主把 `html` 注入到带默认样式的文档（`margin:0; overflow:hidden` + 系统字体栈），`html` 须自带背景色/布局；
- 拖动窗口：给元素加 `class="drag"`（`-webkit-app-region: drag`），按钮等交互元素加 `class="no-drag"`，否则点不响；
- 页面内有全局桥 `window.gtoolsFloat`（类型 `FloatPageBridge`，见 sdk/api.ts）：
  - `gtoolsFloat.close()` —— 关掉自己（关闭按钮用）；
  - `gtoolsFloat.emit(event, payload)` —— 向创建方插件回传事件；
  - `gtoolsFloat.info()` —— 拿到 `{ id, pluginId }`；
- 渲染层监听回传：`ctx.host.events.on('float-event', (p) => ...)`，`p: { id, event, payload }`（`FloatWindowEvent` 类型）。

**生命周期与防泄漏（宿主保证）**：单插件上限 8 个（超限报错）；`html` 上限 200 万字符；插件被禁用时宿主自动关掉它的全部浮窗；应用退出统一关闭；窗口被用户关闭后 `update/close` 报「不存在」。插件只能操作自己创建的浮窗。浮窗页面**没有**宿主能力面（不能调 storage/net 等），需要数据时经 `emit` 回插件视图再 `update` 刷新内容。

### A.2 文件对话框与受限文件读写（权限 `dialog` / `fs`）

**授权模型**：fs 只能访问「用户主动选择」的路径，授权来源仅两个——
1. `dialog.openFile/saveFile` 选中后自动授权（文件=精确授权；目录=整棵子树，读写均含）；
2. 渲染层拖拽：`fs.grant(paths)` 注册（同样文件精确、目录子树）。

```ts
// 导出文件（markdown/备份类插件）
const target = await ctx.host.dialog.saveFile({
  title: '导出笔记',
  defaultPath: 'note.md',
  filters: [{ name: 'Markdown', extensions: ['md'] }]
})                       // 取消返回 null
if (target) await ctx.host.fs.write(target, '# hello')

// 选择目录（局域网共享类）
const [dir] = await ctx.host.dialog.openFile({ directory: true })

// 拖拽批量文件（batch-rename 类）
// 模板里 @drop.prevent="onDrop"，然后：
const paths = e.dataTransfer.files.map(f => window.gtools.pathForFile(f))  // Electron 44 无 File.path，必须走这个桥
await ctx.host.fs.grant(paths)
```

fs API 面：`read(path, {encoding:'utf-8'|'base64'})`、`write(path, data, {encoding, append, createDir})`（base64 写二进制）、`rename(from, to)`、`remove(path)`（目录递归）、`stat(path)`（不存在返回 `{exists:false}` 而非抛错）、`list(dir, {recursive})`（按名排序，递归封顶 5000 条）、`mkdir(path)`（父目录须已授权）。

**rename 规则**：`from` 已授权且 `to` 与 `from` 同目录（批量重命名场景）；或 `to`/其父目录已授权（移动进授权目录）。越界报「未授权」。

**边界说明**：授权=读+写+删。内置插件是受信代码、授权动作来自用户手势（对话框/拖拽），这是与 uTools 一致的信任模型；`..` 逃逸路径会先归一化再判定。

### A.3 net 与 shell 增强

- `net.lanAddresses(): Promise<{name, address}[]>`（权限 `net`）——本机局域网 IPv4（已滤除内环回），局域网共享插件显示 `http://<address>:<port>` 用。
- `net.fetch` 的 `body` 支持 `{ base64: string }` 二进制上传（图床类）。**multipart 上传需自行拼装**：按 boundary 拼好完整 body 字符串/字节后 base64 传入，并带 `Content-Type: multipart/form-data; boundary=...` 头。
- `shell.openExternal(url)`（权限 `shell:open`）——系统默认浏览器打开，仅 http/https。网页快开/热搜/图床类跳转用它，不要用 `openPath` 开 URL。

### A.4 备份（宿主功能，插件无需开发）

设置页已有「备份与恢复」区（`gtools:host` 的 `backup:export` / `backup:import`）。备份文件为 JSON：`{ format:'gtools-backup', version:1, createdAt, sourcePlatform, appVersion, settings, pluginStorage }`，即**应用设置 + 插件启用状态 + 全部插件 storage** 一件打包。

**跨 win/mac 迁移的路径归一化在这层做**：导出时深遍历 pluginStorage，凡以本机 `userData`/home 开头的字符串路径替换为 `${userData}`/`${home}` token（分隔符归一为 `/`）；导入时反向展开为当前平台路径与分隔符。**插件约定：storage 里存绝对路径时，只存 userData/home 派生路径或相对路径**，其他绝对路径原样迁移（跨平台会失效）。导入校验：格式/版本/结构逐层把关（高版本备份拒绝导入），未知插件数据跳过并提示；导入后建议重启（常驻 backend 内存态不自动重载，返回 `restartRecommended: true`）。

### A.5 backend 规则更新（重要）

backend（主进程模块）import 白名单在原有基础上**增加 `node:` 前缀内建模块**（`node:http`、`node:os`、`node:crypto` 等，局域网共享起 http 服务直接用）。仍然：**禁止 import electron**；文件读写/对话框/浮窗/网络等宿主能力一律经 ctx（有权限与授权边界），不要绕过 ctx 直接 `node:fs` 读写用户文件。

### A.6 渲染层可用依赖白名单（更新）

插件渲染层 import 白名单：`@sdk/*`、`vue`、`pinyin-pro`、**`qrcode`**（局域网共享二维码，用 `toDataURL`/`toString` 渲染端 API）、**`marked`**（markdown-notes / dev-manual 的 markdown→HTML，零依赖）。均为纯 JS，无原生编译。渲染层 `crypto.subtle`（WebCrypto）在 `file://` 安全区可用——密码管理器插件用 PBKDF2+AES-GCM 直接写，不需要宿主 API。UI 颜色仍只许取 `themes.css` 变量。

### A.7 本期未提供的能力（及原因）

- **屏幕取色（desktopCapturer 截屏 + 像素取色）**：本期调研清单 10 个插件（markdown-notes / lan-file-share / web-quick-open / batch-rename / image-bed / todo-pomodoro / fake-data / dev-manual / password-vault / hot-search）均不需要；devtools 的 ColorTool 是颜色格式转换，不取屏幕色。如后续要加取色类插件再在此层扩展 `screen:pick-color`。
- 外部插件实例化、`fs` 之外的任意路径访问、浮窗内嵌宿主能力面：刻意不做（安全边界）。

---

## 附录 B：全局 API 配置中心（第三期）

> 规则：通用第三方 API（本期=翻译，未来 LLM/OCR 等）**整个项目只配置一次**，统一在设置页管理；插件经 `host.apis` 按服务调用，密钥不下发渲染层。本文与附录 A 同级，是该能力的唯一权威文档。

### B.0 存储位置与结构

- **独立文件 `userData/api-services.json`**，不进 settings.json。原因：宿主 `app:init` 会把完整 AppSettings 下发渲染层（ipc.ts:247-253 的 `settings: settings.settings`），密钥字段一旦进 AppSettings 就必然随初始化过渲染层，与「key 不下发」目标冲突；且 settings.json 是热文件（主题/快捷键频繁写），API 配置是低频冷数据。
- 存储实现 `src/main/services/api-center.ts` 的 `ApiCenterStore`：机制照抄 SettingsStore（内存持有 + sanitize + tmp→rename 原子写 + 300ms 防抖 + flush 兜底，见 settings-store.ts:48-106 的模式），FsLike 构造注入可单测。
- 主进程内部配置结构（**不进 sdk**——插件只需要 B.2 的调用面）：

```ts
interface ApiProviderConfig {
  id: string                  // 'builtin:mymemory' 或 'u-<8位随机>'
  type: 'mymemory' | 'http-template'
  name: string
  enabled: boolean
  endpoint?: string           // http-template 的 URL 模板，占位符 {text} {from} {to} {key}
  apiKey?: string             // 明文只存本机此文件，永不下发渲染层
  method?: 'GET' | 'POST'
  bodyTemplate?: string       // POST 请求体模板，占位符同上
  resultPath?: string         // 点分结果字段路径，如 translations.0.text
}
interface ApiServicesConfig {
  services: {
    translate: { activeProviderId: string; providers: ApiProviderConfig[] }
  }
}
```

- **默认值即 0.1.0 行为**：providers 为空、activeProviderId 为 `''` 时，执行器回退内置 MyMemory 免 key（全新环境开箱即用，迁移验收基线）。
- sanitize：activeProviderId 必须指向存在且 enabled 的 provider 或 `''`；各字段类型校验，坏值丢弃回默认（手改文件场景与 sanitizePatch 同哲学）。

### B.1 设置页「API 服务」区块（交互）

位置：SettingsPage「插件」区（SettingsPage.vue:156-167）之后、「备份与恢复」之前。

- 服务卡片一行（本期仅「翻译」）：服务名 + 当前生效 provider 名 + 状态点（绿=默认或已配置可用 / 黄=当前 provider 被禁用 / 灰=无可用 provider）。
- 展开后：provider 列表（单选=设为当前、启用开关、编辑、删除）+「添加服务商」。表单字段按 type：`mymemory` 无字段（说明免 key 有匿名配额）；`http-template` 沿用 translate 现 manual 设置五项（URL 模板/请求方式/请求体模板/结果字段路径/密钥，见 translate/settings.vue:69-93 的既有语义）。
- **密钥展示规则**：已保存显示「●●●●●（已保存）」+ 输入框留空=不修改；删除 provider 连同密钥；明文永不回传渲染层（读写都走主进程，读返回 `hasKey: boolean`）。
- 「测试」按钮：主进程用该（草稿）配置发一次 `text='hello', from='en', to='zh-CN'`，展示译文或分类错误。
- 变更即广播 `api-services-changed`（preload 的 allowedEventChannels 白名单加该通道，preload/index.ts:5-9）；translate / var-name 订阅后刷新当前 provider 显示与可用状态。

宿主 IPC（`gtools:host` switch 新增分支，ipc.ts:243-301）：

| api | payload | 返回 |
|---|---|---|
| `api-services:get` | — | 脱敏配置（apiKey → hasKey） |
| `api-services:upsert-provider` | provider 脱敏表单（newApiKey 可选） | 保存后脱敏配置 |
| `api-services:remove-provider` | `{ id }` | 脱敏配置 |
| `api-services:set-active` | `{ id: string \| '' }` | 脱敏配置 |
| `api-services:test` | `{ id, draft? }` | `{ ok, resultText?, error? }` |

### B.2 插件侧契约（HostApi.apis，主进程代理——评估后定案）

**评估**。直连方案（key 下发渲染层、插件自己 net.fetch）被否：密钥进渲染层后，任何插件视图缺陷都会泄漏 key，且多个插件各存一份必然漂移（正是用户要消灭的重复配置）。代理方案的代价「模板/解析逻辑进主进程」可控：执行器是纯函数 + 注入 FetchFn，与 translate 现 providers 同构（translate/providers/types.ts 的 FetchFn 模式），主进程已有 net.fetch 实现（electron-services.ts:25-35，含 http(s) 白名单与 10s 超时），零新增依赖。**定案：主进程代理，key 不出主进程**；渲染层（含插件与设置页）只见过翻译结果与脱敏配置。

sdk/api.ts 新增（apiVersion 仍为 1——只加面不改旧面，protocolVersion 不动，旧插件零影响）：

```ts
export type ApiServiceId = 'translate'        // 封闭枚举，扩服务=发版时在此加
export interface TranslateRequest { text: string; from: string; to: string }
export interface TranslateResult { resultText: string; detectedFrom?: string; providerId: string }
export interface ApiServiceStatus {
  service: ApiServiceId
  configured: boolean                          // false = 未配置且回退默认 MyMemory
  activeProviderId: string                     // '' = 内置默认
  activeProviderName: string
}

// HostApi 增加一段（BackendContext 经 createBackendContext 同构获得）：
apis: {
  invoke(service: ApiServiceId, payload: TranslateRequest): Promise<TranslateResult>
  status(service: ApiServiceId): Promise<ApiServiceStatus>
}
```

**权限与 api 名（静态表模型不变，服务集封闭故行数有限）**：

- `API_PERMISSIONS` 增两行：`'apis.translate': 'apis:translate'`、`'apis.translate.status': 'apis:translate'`（host-client 把 `apis.invoke('translate', p)` 包装成 api 名 `apis.translate`；service 是 ApiServiceId 字面量类型，模板拼接安全）。dispatchApi 查表逻辑零改动（dispatch.ts:84-87）。
- `Permission` 联合与 `ALL_PERMISSIONS` 增 `'apis:translate'`（sdk/manifest.ts）。
- `ApiCallError` 联合增 `'SERVICE_UNCONFIGURED'`（无可用 provider）与 `'SERVICE_ERROR'`（执行失败；message 前缀分类 `timeout/network/http/quota/parse/config`，沿用 translate/providers/types.ts 的 TranslateErrorKind 六类）。
- 未声明 `apis:translate` 的插件调用 → 现有 PERMISSION_DENIED 语义；执行器统一走 fetchViaNet（net-guard 的 http(s) 限制与超时对 API 中心同样生效）。

### B.3 通用 API vs 插件专属 API（判定规则，后续插件必须遵守）

**进全局中心（三项全满足）**：
1. 能力可脱离具体插件描述成一个「服务品类」（翻译、LLM 补全、OCR、语音转写…）；
2. 消费方 ≥2，或路线图明确将有多消费方（本期 translate 插件 + var-name 已满足）；
3. 配置内容是技术凭证类（endpoint / key / 模板），不含业务语义。

**留在插件自己的设置页（任一满足）**：
1. 仅一个插件消费且难以品类化（图床的仓库与域名规则、password-vault 主密码、lan-file-share 端口）；
2. 配置是**业务偏好**（默认翻译方向、历史容量、条数上限、皮肤）——偏好类即使与通用能力相关也永不上收（B.5 迁移后 translate 保留语言方向偏好即是此条）。

**上收路径**（某专属 API 出现第二个消费方时）：provider 执行器以纯函数上移 `src/main/services/api-center/executors/`；sdk 增 ApiServiceId 枚举与请求/结果类型 + API_PERMISSIONS 两行；插件 settings.vue 删 API 区块改为「到 设置 → API 服务 配置」入口；旧插件 storage 值一次性幂等迁移。宿主 UI 未来也可直接消费（不经插件）。

### B.4 外部插件协议预留

external manifest 的 permissions 含 `apis:<service>` 视为合法项（通过校验）；当前外部插件只检测不实例化（AGENTS.md 现状），调用路径不存在。未来开放实例化时的规矩（本期只立不做）：外部插件的 `apis:*` 权限必须经用户安装/启用时的显式授权弹窗（内置插件视为随应用分发受信）；api-center 按 pluginId 计数调用（保护匿名配额）；密钥依然永不下发。

### B.5 translate 插件迁移（0.1.1 内完成，行为不回退）

1. **上移**：`src/plugins/translate/providers/{mymemory,manual}.ts` 的请求构造/响应解析重写为主进程 `api-center/executors/{mymemory,http-template}.ts`（纯函数 + 注入 FetchFn），语义逐项对齐：MyMemory 的 HTTP 200 + body responseStatus 业务错误、403/429/482 配额分类、HTML 反转义；manual 的四占位符替换与点分结果路径。断言从 `src/plugins/translate/providers.test.ts`（289 行）移植为 `tests/api-center-executors.test.ts`，并补全局中心路径（activeProviderId 路由、回退默认、禁用 provider）用例。
2. **保留在插件**：`resolveLangPair` / `isMostlyChinese`（方向启发式是业务偏好，按 B.3 不上收）、输入即译防抖、读剪贴板、复制交互。
3. `index.vue` 的 `doTranslate` 改调 `ctx.host.apis.invoke('translate', { text, from, to })`（现走 runTranslate + host.net.fetch，index.vue:87-92）。错误处理：`SERVICE_UNCONFIGURED` 显示「未配置翻译服务，到 设置 → API 服务」引导；其余分类文案沿用。
4. `settings.vue` 收窄为非 API 设置：默认方向（auto / zh2en / en2zh）+「翻译服务在全局 API 中心配置」提示入口；provider/密钥/模板表单整体删除。
5. manifest 权限：`['net','clipboard:read','clipboard:write','storage']` → `['apis:translate','clipboard:read','clipboard:write','storage']`（翻译走代理后不再需要 net，维持最小授权）。
6. **数据迁移（一次性、幂等）**：app 启动加载两 store 后，若 api-services 的 translate.providers 为空且 translate 插件 storage 的 `settings` 键（SETTINGS_STORAGE_KEY，providers/types.ts）含有效 manual 模板或密钥 → 导入为 http-template provider 并设为 active；旧键原样保留不删（回退安全），此后不再读取。
7. 验收基线：全新环境零配置 → MyMemory 免 key 可用（= 0.1.0 默认）；老用户已配 manual+key → 升级后配置出现在全局中心且翻译立即生效。

### B.6 备份集成

`BACKUP_VERSION` 1→2（backup.ts:4）；备份文件增加可选顶层段 `apiServices?: ApiServicesConfig`，导出时经既有 tokenizePathValues 深遍历（backup.ts:127-146，密钥为不透明字符串原样保留，endpoint 内不含本机路径）。导入：版本门槛是 `> BACKUP_VERSION` 才拒（backup.ts:132-134），升到 2 后 v1（无该段）/v2 备份都可导入；apiServices 段 sanitize 后整体替换。导入完成即广播 `api-services-changed`——api-center 是主进程内存态，无需重启即生效（与常驻 backend 的 restartRecommended 不同）。

---

## 附录 C：变量命名插件 var-name 规格

### C.1 定位与依据（调研 2 Part 6 结论直接落地）

做「中→英取词 → 多格式候选 → 键盘复制」标准形态；补齐全行业空白的历史/收藏/缩写展开；本地词典离线兜底。不做：真实代码用例搜索（在线依赖与本地优先冲突）、96 种格式（推广文未证实，五件套+语言预设已覆盖）、编辑器内就地替换（无编辑器上下文）。AI 增强留二期，届时经 API 中心新增 `'llm'` 服务承载（B.3 上收路径已预留）。

必备功能映射：五件套=语言预设行；上下键+回车复制；读剪贴板一键命名；翻译候选多选；离线兜底；历史；收藏（含中文备注）；缩写展开/反查。

### C.2 manifest 与目录

```ts
const manifest: PluginManifest = {
  id: 'var-name', name: '变量命名', version: '0.1.0', protocolVersion: 1,
  description: '输入中英文描述 → 按语言预设生成各上下文命名候选，一键复制',
  icon: '🏷️',
  keywords: ['vn', '命名', 'var'],   // 已核对不冲突：mm 归 password-vault、重命名/plmm 归 batch-rename、bianma 是 devtools 命令词（2026-09-24 grep 全部 manifest）
  activation: 'trigger',
  permissions: ['apis:translate', 'clipboard:read', 'clipboard:write', 'storage'],
  source: 'builtin', entry: './index.vue'
}
```

目录（插件隔离，不 import 其他插件目录）：

```
src/plugins/var-name/
  manifest.ts
  index.vue          # 输入行 + 语言预设栏 + 候选列表 + 历史/收藏页签
  logic/engine.ts    # 分词 + 风格引擎（纯函数）
  logic/lookup.ts    # 中→英取词链：本地词典 → apis.translate → 报错（apis 调用注入，可测）
  data/presets.ts    # 语言×上下文预设（C.3，源调研 1）
  data/abbrev.ts     # 缩写词典（C.5，源调研 3 Part 1+2 裁决）
  data/zh-en.ts      # 中文→英文短语（C.6，源调研 3 Part 3）
tests/var-name-engine.test.ts / tests/var-name-lookup.test.ts
```

### C.3 语言×上下文预设清单（数据源 docs/research/naming-conventions.md；16 套语言预设 / 88 条上下文规则）

| 语言(id) | variable | function/method | class/type | constant | 其他上下文（style[+前后缀/注]） | 规则数 |
|---|---|---|---|---|---|---|
| javascript | camel | camel | pascal | screaming（仅模块级；函数内 const 保持 camel） | 枚举名 pascal；枚举值 screaming；文件 kebab（亦允 snake）；npm 包名禁大写 | 9 |
| typescript | camel | camel | pascal | screaming（模块级/枚举值） | 局部 const camel；文件 snake；明令禁 `_` 前缀 | 6 |
| python | snake | snake | pascal（异常 +`Error` 后缀） | screaming | 模块 snake；包全小写不鼓励 `_`；私有 `_` 前缀 | 8 |
| java | camel | camel | pascal | screaming（static final 深不可变） | 包全小写连续无 `_`；文件=顶层类名；缩写词按单词弯折 | 6 |
| kotlin | camel | camel | pascal | screaming（const val） | 文件 PascalCase.kt；后备属性 `_` 前缀；枚举值 screaming 或 pascal | 7 |
| go | camel（未导出） | pascal=导出（**大小写即导出语义**，注） | pascal | pascal（**禁 SCREAMING**，注） | 包全小写单词无 `_` 无驼峰；getter 无 Get 前缀 | 5 |
| rust | snake | snake | pascal（缩写单词化 `Uuid`） | screaming | 模块 snake | 4 |
| csharp | camel（参数/局部） | pascal | pascal（接口 `I` 前缀） | pascal（const） | 私有字段 `_camel`；namespace pascal；两字母缩写全大写 `IOStream`、`Id` 不写 `ID` | 7 |
| cpp-google | snake（类成员尾 `_`） | pascal（accessor 可 snake） | pascal | **kCamel** | 宏 SCREAMING+项目前缀；namespace snake；文件全小写 `_` | 8 |
| cpp-llvm | **Pascal（首字母大写）** | camel | Pascal | —（裸常量 `MaxSize`） | 枚举器大写带前缀或裸常量 | 4 |
| php | 不规定（默认 camel，注） | camel | pascal | screaming（类常量） | namespace PascalCase；文件=类名.php | 6 |
| ruby | snake | snake（谓词 `?` /危险 `!` 后缀） | pascal（缩写保持全大写 `SomeXML`） | screaming | 文件 snake.rb | 5 |
| swift | camel | camel | pascal | **camel（连全局常量；禁 k/g 前缀）** | 枚举 case camel；布尔断言式 `isEmpty` | 5 |
| css | — | — | — | — | 类名 kebab；自定义属性 `--kebab`；BEM `block__elem--mod`（`--` 流行版） | 3 |
| sql | 列 snake | — | 表 snake | — | 布尔列 `is_`/`has_` 前缀；主键 `id`、外键 `<表单数>_id` | 4 |
| shell | snake | snake（库 `::` 分层） | — | screaming（readonly/导出变量） | 文件全小写 `_`（禁连字符） | 3 |

缩写词大小写策略（initialism，按语言挂到预设上，同词不同果的硬差异）：`word`=按单词弯折（Java/TS/Rust，`XmlHttpRequest`/`Uuid`）、`go`=整体同格（导出 `URL`/未导出 `url`，禁 `Url`）、`csharp`=两字母全大写、≥3 首字母大写（`IOStream`/`XmlTag`/`Id`）、`swift`=按通用度统一（`URL` vs `utf8`）。无语言偏好时的默认视图 = 通用五件套（camel/pascal/snake/kebab/screaming，即调研 2 的 codevar 形态）。

预设数据格式：

```ts
type StyleId = 'camel' | 'pascal' | 'snake' | 'screaming' | 'kebab' | 'kCamel'
type InitialismPolicy = 'word' | 'go' | 'csharp' | 'swift'
interface ContextRule {
  id: string; label: string            // 'variable'/'局部变量'
  style: StyleId
  prefix?: string; suffix?: string     // 'I'/'k'/'_'/'b'、Google C++ 成员尾 '_'
  note?: string                        // 差异提示（Go 常量禁 SCREAMING 等）
}
interface LanguagePreset { id: string; name: string; contexts: ContextRule[]; initialism: InitialismPolicy }
```

### C.4 风格引擎接口（logic/engine.ts，纯函数可单测）

```ts
export function tokenize(input: string): string[]
// 驼峰拆分 + 空格/连字符/下划线切分 + 小写化 + 停用词过滤（the/a/of/for）
export function applyStyle(words: string[], style: StyleId, policy: InitialismPolicy): string
export function generate(words: string[], preset: LanguagePreset): NamingCandidate[]
export interface NamingCandidate { contextId: string; label: string; value: string; note?: string }
```

键盘流（调研 2 #2 必备）：↑↓ 在候选行移动、Enter 复制选中行并写历史、Esc 逐级退出（外壳既有行为）；行尾星标收藏。「读剪贴板」按钮（`host.clipboard.readText`）把剪贴板中文描述直接带入。

### C.5 缩写词典（data/abbrev.ts）

```ts
interface AbbrEntry {
  full: string                    // 'database'
  primary: string                 // 'db'
  variants?: string[]             // 分歧双收：current → ['cur','curr']（调研 3 Part 2 裁决）
  level: 'recommended' | 'contextual' | 'avoid'
  context?: string                // level=contextual 时必填
}
```

规模：调研 3 Part 1（🟢 约 180 条 + 🟡 约 40 条）+ Part 2 双收裁决 7 组，合计约 280 词条（含 variants）。开关 `useAbbreviations` 默认**关**（反缩写派依据：调研 3 A2/A10「能写全称就写全称」）；开启后仅 `recommended` 级 primary 自动替换；`contextual` 级以可点选建议呈现（带上下文标签）；`avoid` 级只用于反查（用户输入缩写时提示写全称），绝不主动生成。反查：输入英文缩写命中词典 → 候选区顶部显示「全称 + 推荐度」提示行。

### C.6 中→英取词链（logic/lookup.ts，降级路径）

```
resolveWords(input):
  1. 无 CJK 字符 → tokenize(input) 直接返回（英文输入零网络零词典）
  2. 本地词典 zh-en 命中（trim + 全半角/空格归一化后精确匹配；词条 en[] 多义项全部作为候选词组）
  3. host.apis.invoke('translate', { text: input, from: 'zh-CN', to: 'en' }) → tokenize(译文)
  4. 失败（SERVICE_UNCONFIGURED / 网络错）→ 抛 LookupError('offline')
```

**词典优先于在线**（本地优先定位：0ms、离线可用；未命中才走网络，无额外成本——在线反而更慢）。`offline` 时列表显示「离线词典未收录：联网后重试，或到 设置 → API 服务 配置翻译」，不阻塞英文输入路径。zh-en 词条格式沿用调研 3 Part 5 的 `ZhEnEntry { zh, en[], avoid?, domain }`，规模约 110 条（Part 3 四域：产品设置/界面操作/开发运行时/代码数据）。

### C.7 历史 / 收藏 / 复制（storage 走 host.storage，命名空间天然隔离）

- `history`: `{ q, words, at }[]`，容量 100，同 q 去重只更新时间（容量淘汰思路同 clipboard-history）；
- `favorites`: `{ id, q, words, note?, at }[]`，支持中文备注（补调研 2 #7「变量名附中文释义」空白）；
- `prefs`: `{ langId, useAbbreviations, tab }`。

复制：Enter / 行点击 → `host.clipboard.writeText(value)`（系统剪贴板，跨应用可贴）+ 行内「已复制」反馈 + 写入历史。**自动粘贴不做**：macOS 模拟 ⌘V 需辅助功能权限，超本期范围（列人工验证清单的可选后续）。

---

## 附录 D：第三期实施顺序与分工（平台工程师 / 插件工程师）

| 阶段 | 负责 | 交付物 | 门禁 |
|---|---|---|---|
| 1 契约+中心 | 平台 | sdk：`apis` 面 / `apis:translate` 权限 / API_PERMISSIONS 两行 / ApiCallError 扩展；主进程：api-center store + executors + dispatch 分支 + createBackendContext + 迁移逻辑 + 备份 v2 | build + test（含移植的 api-center-executors 测试） |
| 2 并行 | 插件 | var-name 纯逻辑层：engine / lookup / 三份数据 + 单测（apis 以注入 fake 开发：status 返回 configured:false、invoke 抛 SERVICE_UNCONFIGURED） | vitest 新增文件全绿 |
| 3 宿主 UI | 平台 | SettingsPage「API 服务」区块 + host 五个 api + preload 通道白名单 + `api-services-changed` 广播；translate 迁移收尾（providers 缩减、settings.vue 收窄、manifest 权限替换） | build + test + typecheck |
| 4 插件 UI | 插件 | var-name index.vue 接入真实 host.apis + 事件订阅刷新 + 历史/收藏/键盘流打磨 | build + test |
| 5 发布 | 联合 | README 功能介绍页更新；package.json 0.1.0→0.1.1；x64 dmg | 见下 |

**接口分界（两位工程师的唯一契约面）**：sdk/api.ts 的 apis 类型 + `host.apis.invoke('translate', ...)` 行为语义（错误码 SERVICE_UNCONFIGURED/SERVICE_ERROR、超时 10s、未配置回退 MyMemory）。阶段 1 完成前插件工程师用注入桩并行开发，互不等待。

**发布项（阶段 5）**：README 内置插件表当前仅列 2 项而实际已有 18 个内置插件（README.md:39-45，`ls src/plugins` 19 目录含 hello 示例）——全量重列 + var-name 卡片 + 插件计数 19 + 「全局 API 配置中心」能力说明；版本升 0.1.1；`ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 环境变量下 `npm run dist` 只出 **x64** dmg（0.1.0 误出的 arm64 产物教训）；人工 GUI 验证清单新增：API 中心配置流、translate 迁移后无回归、var-name 键盘流与离线降级。
