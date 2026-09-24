import type { RawEntry } from './types'

// meta.mac / meta.win 为两平台组合键，视图按平台高亮其一
const entries: RawEntry[] = [
  {
    slug: 'command-palette',
    name: '命令面板',
    summary: '所有命令的统一入口',
    keywords: ['Command Palette', '命令面板', '所有命令'],
    meta: { mac: '⇧⌘P', win: 'Ctrl+Shift+P' },
    md: `VSCode 一切功能的模糊搜索入口，记不住快捷键时万能兜底。

- 输 \`>\` 前缀执行命令；去掉 \`>\` 是文件跳转
- 输 \`@\` 跳当前文件符号；\`@:\` 分类列符号
- 输 \`:\` 跳行号（\`:80\`）；\`?\` 帮助`
  },
  {
    slug: 'quick-open',
    name: '快速打开文件',
    summary: '按名模糊跳文件（Go to File）',
    keywords: ['Quick Open', '打开文件', '跳文件'],
    meta: { mac: '⌘P', win: 'Ctrl+P' },
    md: `- 直接输文件名片段模糊匹配
- 后接 \`:\` 再输行号直达（如 \`app.ts:42\`）
- 输 \`?\` 看全部模式帮助`
  },
  {
    slug: 'global-search',
    name: '全局搜索',
    summary: '跨文件搜内容',
    keywords: ['Search', '全局搜索', '查找文件内容'],
    meta: { mac: '⇧⌘F', win: 'Ctrl+Shift+F' },
    md: `- \`files to include/exclude\` 精确范围（支持 glob：\`src/**/*.ts\`）
- 替换模式切图标；正则开关在搜索框右侧 ... 里
- ⌘⇧G（Ctrl+Shift+G）跳转下一个搜索结果`
  },
  {
    slug: 'replace-in-file',
    name: '文件内替换',
    summary: '当前文件查找替换',
    keywords: ['Replace', '替换'],
    meta: { mac: '⌥⌘F', win: 'Ctrl+H' },
    md: `\`⌥⏎\`（Alt+Enter）选中全部匹配项后可多光标同时编辑。`
  },
  {
    slug: 'find-in-file',
    name: '文件内查找',
    summary: '当前文件查找',
    keywords: ['Find', '查找'],
    meta: { mac: '⌘F', win: 'Ctrl+F' },
    md: `\`⌘G\` / \`⇧⌘G\`（F3 / Shift+F3）跳下/上一个匹配。`
  },
  {
    slug: 'toggle-sidebar',
    name: '切换侧边栏',
    summary: '显示/隐藏侧边资源管理器',
    keywords: ['Sidebar', '侧边栏'],
    meta: { mac: '⌘B', win: 'Ctrl+B' },
    md: `\`⌘⇧E\`（Ctrl+Shift+E）直接聚焦资源管理器；\`⌘⇧X\` 扩展面板；\`⌘⇧D\` 调试面板。`
  },
  {
    slug: 'toggle-terminal',
    name: '切换集成终端',
    summary: '显示/隐藏终端',
    keywords: ['Terminal', '终端'],
    meta: { mac: '⌃`', win: 'Ctrl+`' },
    md: `- 新建终端：⌘⇧&#96;（Ctrl+Shift+&#96;）
- 终端分屏：⌘\\（Ctrl+\\）
- 聚焦问题面板：⌘⇧M（Ctrl+Shift+M）`
  },
  {
    slug: 'toggle-panel',
    name: '切换底部面板',
    summary: '显示/隐藏下方面板（输出/问题/终端）',
    keywords: ['Panel', '面板'],
    meta: { mac: '⌘J', win: 'Ctrl+J' },
    md: `面板内含终端/输出/问题等标签；\`⌘K Z\`（Ctrl+K Z）禅模式则把侧边栏+面板+状态栏全部隐藏。`
  },
  {
    slug: 'split-editor',
    name: '拆分编辑器',
    summary: '左右分栏对比代码',
    keywords: ['Split', '分屏', '分栏'],
    meta: { mac: '⌘\\', win: 'Ctrl+\\' },
    md: `\`⌘1\` / \`⌘2\`（Ctrl+1/2）在编辑组间切换焦点；\`⌘K ⌘←/→\` 把当前文件移到左/右组。`
  },
  {
    slug: 'close-editor',
    name: '关闭编辑器',
    summary: '关闭当前文件标签',
    keywords: ['Close', '关闭'],
    meta: { mac: '⌘W', win: 'Ctrl+W' },
    md: `\`⌘K W\`（Ctrl+K W）关闭当前组全部标签；\`⌘⇧T\`（Ctrl+Shift+T）重新打开刚关的。`
  },
  {
    slug: 'switch-editor',
    name: '切换编辑器标签',
    summary: '上一个/下一个文件',
    keywords: ['Switch', '切换标签'],
    meta: { mac: '⌥⌘←/→', win: 'Ctrl+PageUp/PageDown' },
    md: `\`⌘P\` 模糊跳转通常更快；\`⌃-\`（Ctrl+-）按光标历史回退也常用。`
  },
  {
    slug: 'move-line',
    name: '上下移动行',
    summary: '整行搬移',
    keywords: ['Move Line', '移动行'],
    meta: { mac: '⌥↑/↓', win: 'Alt+↑/↓' },
    md: `无需选中，光标在行内即可搬；选中多行则整块搬。`
  },
  {
    slug: 'copy-line-down',
    name: '向下复制行',
    summary: '复制当前行到下方',
    keywords: ['Copy Line', '复制行'],
    meta: { mac: '⇧⌥↓', win: 'Shift+Alt+↓' },
    md: `\`⇧⌥↑\`（Shift+Alt+↑）向上复制；改配置 \`editor.action.copyLinesDownAction\` 可换键。`
  },
  {
    slug: 'delete-line',
    name: '删除行',
    summary: '整行剪切',
    keywords: ['Delete Line', '删除行'],
    meta: { mac: '⇧⌘K', win: 'Ctrl+Shift+K' },
    md: `无系统剪贴板占用担忧：它就是剪切整行，没粘贴即等于删除。`
  },
  {
    slug: 'insert-line',
    name: '上方/下方插入空行',
    summary: '光标不动插入新行',
    keywords: ['Insert Line', '插入行'],
    meta: { mac: '⌘⏎ / ⇧⌘⏎', win: 'Ctrl+Enter / Ctrl+Shift+Enter' },
    md: `\`⌘⏎\` 下方插行；\`⇧⌘⏎\` 上方插行，光标留在原行，写长参数列表时好用。`
  },
  {
    slug: 'select-word',
    name: '扩展/收缩选区',
    summary: '逐层选中单词→表达式→块',
    keywords: ['Expand Selection', '扩大选区', '智能选择'],
    meta: { mac: '⌃⇧⌘→/←', win: 'Shift+Alt+→/←' },
    md: `重构前选精确范围的利器：连按向右逐步扩大，向左收缩。`
  },
  {
    slug: 'multi-cursor-below',
    name: '下方添加光标',
    summary: '列状多光标',
    keywords: ['Multi Cursor', '多光标', '列编辑'],
    meta: { mac: '⌥⌘↓ / ⌥⌘↑', win: 'Ctrl+Alt+↓ / Ctrl+Alt+↑' },
    md: `- 选中一段文本后 \`⌘D\`（Ctrl+D）逐个加下一个相同词
- \`⌘⇧L\`（Ctrl+Shift+L）一次选中全部相同词
- \`⌥Click\`（Alt+Click）任意位置点出光标`
  },
  {
    slug: 'undo-redo',
    name: '撤销/重做',
    summary: '撤销与重做',
    keywords: ['Undo', 'Redo', '撤销', '重做'],
    meta: { mac: '⌘Z / ⇧⌘Z', win: 'Ctrl+Z / Ctrl+Y' },
    md: `VSCode 有独立的时间线（Timeline）视图可回看文件本地历史。`
  },
  {
    slug: 'go-to-line',
    name: '跳到行',
    summary: '行号直达',
    keywords: ['Go to Line', '跳行'],
    meta: { mac: '⌃G', win: 'Ctrl+G' },
    md: `或 \`⌘P\` 后输 \`:行号\`，还能 \`:行号:列\`。`
  },
  {
    slug: 'go-to-definition',
    name: '跳到定义',
    summary: '符号定义处',
    keywords: ['Go to Definition', '跳定义'],
    meta: { mac: 'F12', win: 'F12' },
    md: `- \`⌥F12\`（Alt+F12）peek 浮窗预览不跳走
- \`⇧F12\`（Shift+F12）查所有引用
- ⌥单击（Alt+Click）同样跳定义`
  },
  {
    slug: 'go-back-forward',
    name: '后退/前进',
    summary: '光标位置历史导航',
    keywords: ['Back', 'Forward', '返回'],
    meta: { mac: '⌃- / ⌃⇧-', win: 'Alt+← / Alt+→' },
    md: `跳定义看完后原路返回，比鼠标手势稳。`
  },
  {
    slug: 'format-document',
    name: '格式化文档',
    summary: '整文件格式化',
    keywords: ['Format', '格式化'],
    meta: { mac: '⇧⌥F', win: 'Shift+Alt+F' },
    md: `\`⌘K ⌘F\`（Ctrl+K Ctrl+F）只格式化选中片段；保存自动格式化开 \`editor.formatOnSave\`。`
  },
  {
    slug: 'rename-symbol',
    name: '重命名符号',
    summary: '全项目安全改名',
    keywords: ['Rename', '重命名', '改名'],
    meta: { mac: 'F2', win: 'F2' },
    md: `语言服务驱动的语义级重命名，比查找替换安全（不会误伤注释外同名）。`
  },
  {
    slug: 'comment-line',
    name: '切换行注释',
    summary: '注释/取消注释',
    keywords: ['Comment', '注释'],
    meta: { mac: '⌘/', win: 'Ctrl+/' },
    md: `\`⇧⌥A\`（Shift+Alt+A）块注释；对 markdown 是切换标题等级。`
  },
  {
    slug: 'indent-outdent',
    name: '缩进/反缩进',
    summary: '选中块左右移',
    keywords: ['Indent', '缩进'],
    meta: { mac: '⌘] / ⌘[', win: 'Ctrl+] / Ctrl+[' },
    md: `Tab / Shift+Tab 在选中状态下等效。`
  },
  {
    slug: 'fold',
    name: '折叠/展开代码块',
    summary: '区块折叠',
    keywords: ['Fold', '折叠'],
    meta: { mac: '⌥⌘[ / ⌥⌘]', win: 'Ctrl+Shift+[ / ]' },
    md: `\`⌘K ⌘0\`（Ctrl+K Ctrl+0）全折叠；\`⌘K ⌘J\` 全展开；\`⌘K ⌘数字\` 折到指定层级。`
  },
  {
    slug: 'zen-mode',
    name: '禅模式',
    summary: '全屏无干扰编辑',
    keywords: ['Zen', '禅模式', '专注'],
    meta: { mac: '⌘K Z', win: 'Ctrl+K Z' },
    md: `双击 Esc 退出。配合 \`zenMode.hideStatusBar\` 可全隐状态栏。`
  },
  {
    slug: 'new-window',
    name: '新建窗口',
    summary: '开新 VSCode 窗口',
    keywords: ['New Window', '新窗口'],
    meta: { mac: '⇧⌘N', win: 'Shift+Ctrl+N' },
    md: `\`⌘W\` 关标签、\`⇧⌘W\`（Ctrl+Shift+W）关整个窗口。`
  },
  {
    slug: 'settings-ui',
    name: '打开设置',
    summary: '设置界面',
    keywords: ['Settings', '设置', 'Preferences'],
    meta: { mac: '⌘,', win: 'Ctrl+,' },
    md: `设置里搜 \`workbench.commandPalette\` 等键名可直达；\`⌘K ⌘S\`（Ctrl+K Ctrl+S）打开键盘快捷键表。`
  },
  {
    slug: 'problems',
    name: '问题面板',
    summary: '错误与警告列表',
    keywords: ['Problems', '问题', '错误'],
    meta: { mac: '⇧⌘M', win: 'Ctrl+Shift+M' },
    md: `\`F8\` / \`⇧F8\` 在问题间循环跳转。`
  },
  {
    slug: 'breadcrumbs',
    name: '面包屑导航',
    summary: '路径与符号层级',
    keywords: ['Breadcrumbs', '面包屑'],
    meta: { mac: '⌘⇧.', win: 'Ctrl+Shift+.' },
    md: `\`⌘⇧;\`（Ctrl+Shift+;）聚焦面包屑；编辑器顶部路径条可快速跳父级符号。`
  },
  {
    slug: 'cursor-top',
    name: '跳到文件头/尾',
    summary: '⌘↑/⌘↓',
    keywords: ['Top', 'Bottom', '文件头', '文件尾'],
    meta: { mac: '⌘↑ / ⌘↓', win: 'Ctrl+Home / Ctrl+End' },
    md: `\`⌘←/→\`（Home/End）跳行首/行尾；\`⌥←/→\`（Ctrl+←/→）按单词跳。`
  },
  {
    slug: 'join-lines',
    name: '合并行',
    summary: '把下一行接到当前行尾',
    keywords: ['Join Lines', '合并行'],
    meta: { mac: '⌃J', win: 'Ctrl+J（编辑器内需配键）' },
    md: `Windows 默认 ⌃J 与面板切换冲突，编辑器内合并行建议在键盘快捷键里给 \`editor.action.joinLines\` 绑 Ctrl+J when 文本聚焦。`
  },
  {
    slug: 'transform-case',
    name: '大小写转换',
    summary: '选中文本转大写/小写',
    keywords: ['Transform', '大写', '小写'],
    meta: { mac: '⌘K ⌘U / ⌘K ⌘L', win: 'Ctrl+K Ctrl+U / Ctrl+K Ctrl+L' },
    md: `U = Uppercase，L = Lowercase， chord（先后按）键序。`
  },
  {
    slug: 'duplicate-cursor-word',
    name: '选中下一个相同词',
    summary: '⌘D 逐个加选区',
    keywords: ['Add Selection', '相同词', 'D'],
    meta: { mac: '⌘D', win: 'Ctrl+D' },
    md: `连按 D 依次选中下一个相同词并加光标；\`⌘K ⌘D\`（Ctrl+K Ctrl+D）跳过当前选下一个。批量重命名局部变量首选。`
  },
  {
    slug: 'column-select',
    name: '列选择（块选择）',
    summary: '按列拖选',
    keywords: ['Column Select', '块选择', '列模式'],
    meta: { mac: '⇧⌥拖动 / ⌥⇧↑↓', win: 'Shift+Alt拖动 / Ctrl+Alt+↑↓' },
    md: `或中键拖动；配合多光标可以做表格/对齐文本的纵向编辑。`
  },
  {
    slug: 'reveal-in-finder',
    name: '在系统中显示文件',
    summary: 'Finder/资源管理器定位',
    keywords: ['Reveal', 'Finder', '打开所在目录'],
    meta: { mac: '⌘K R', win: 'Ctrl+K R' },
    md: `或右键编辑器标签 → Reveal in Finder / Explorer。`
  },
  {
    slug: 'open-settings-json',
    name: '打开 settings.json',
    summary: '直接编辑用户设置文件',
    keywords: ['settings.json', '配置文件'],
    meta: { mac: '⌘⇧P → "Preferences: Open User Settings (JSON)"', win: 'Ctrl+Shift+P → 同左' },
    md: `命令面板搜 "Open User Settings (JSON)"；工作区设置是另一个条目（带 Workspace 字样）。`
  }
]

export default entries
