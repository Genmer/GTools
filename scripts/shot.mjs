// 离屏截图基建（视觉验收用）：离屏窗口加载 out/renderer 构建产物，按场景截 PNG。
// 用法：npm run shot -- --all | --only <pluginId> | --shell [--out <dir>]
// 依赖外部先 npm run build（本脚本不代跑构建，只做产物前置检查）。
import { app, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const RENDERER_HTML = join(ROOT, 'out', 'renderer', 'index.html')
const PRELOAD_CJS = join(ROOT, 'out', 'preload', 'index.cjs')
const PLUGINS_DIR = join(ROOT, 'src', 'plugins')
const WIN_W = 800
const WIN_H = 600
// §5 允许 800×N：插件页内容超高（如 time-toolbox 五区块）时按实际内容加高整页截取
const MAX_WIN_H = 1600
// shell 空态 uTools 图标网格（§1.5）用加高窗口：最近行 + 2-3 行应用网格整段入镜；
// 需另留出滚动容器底部 32px 渐隐 mask 区，避免最后一行被淡出
const SHELL_GRID_WIN_H = 640
const LOAD_TIMEOUT_MS = 15_000
// 要求的下限 800ms 渲染稳定等待，另加 rAF 双帧确保至少一次绘制
const SETTLE_MS = 800
const TYPE_SETTLE_MS = 400
const SHELL_QUERY = 'calc'
// 『设置』字面命中设置条目：验证 §1.4 匹配高亮（拼音命中不高亮是有意取舍，不造假高亮）
const SHELL_HL_QUERY = '设置'
// 空态图标网格场景走 #demo=1（渲染层注入示例应用 + 示例最近行，截图宿主不实现 apps:* 通道）
const SHELL_DEMO_HASH = 'demo=1'
// 与 App.vue 的 RECENT_KEY 对齐（注入/清理最近使用，隔离在 shot profile 的 localStorage）
const RECENT_LS_KEY = 'gtools:recent-entries'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function usage(msg) {
  if (msg) process.stderr.write(`[shot] 参数错误：${msg}\n`)
  process.stderr.write('用法：npm run shot -- --all | --only <pluginId> | --shell [--out <dir>]\n')
  app.exit(1)
}

function parseArgs(argv) {
  const mode = { all: false, shell: false, only: null, out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--all') mode.all = true
    else if (a === '--shell') mode.shell = true
    else if (a === '--only') mode.only = argv[++i] ?? usage('--only 缺少插件 id')
    else if (a === '--out') mode.out = argv[++i] ?? usage('--out 缺少目录参数')
    else usage(`未知参数 ${a}`)
  }
  const picked = [mode.all, mode.shell, mode.only !== null].filter(Boolean).length
  if (picked > 1) usage('--all / --shell / --only 互斥')
  if (picked === 0) usage('必须指定 --all、--shell 或 --only <pluginId>')
  return mode
}

/** manifest.ts 整包 esbuild bundle 后求值：TS 语法/值导入（web-quick-open 值导入 match→pinyin-pro）
 *  正则剥壳喂 new Function 必 SyntaxError；alias 与 electron.vite.config 的 @sdk 同指向 */
const bundleOpts = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  alias: { '@sdk': join(ROOT, 'sdk') }
}

/** bundle 产物求值：残留 require（node: 内建/未内联外部包）在求值期显式抛错带 id，优于静默跳过 */
function evalBundled(code, fromDir) {
  const nodeRequire = createRequire(import.meta.url)
  const requireStub = (id) => {
    // 只认仓库内相对路径；其余（external 包/内建）manifest 求值期出现即失败
    if ((id.startsWith('.') || id.startsWith('/')) && resolve(fromDir, id).startsWith(ROOT)) {
      return nodeRequire(resolve(fromDir, id))
    }
    throw new Error(`manifest 求值期 require 未内联依赖 "${id}"`)
  }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)(requireStub, mod, mod.exports)
  return mod.exports
}

async function evalManifest(dir) {
  const entry = join(PLUGINS_DIR, dir, 'manifest.ts')
  const result = await build({ ...bundleOpts, entryPoints: [entry] })
  const exp = evalBundled(result.outputFiles[0].text, dirname(entry))
  const manifest = exp && typeof exp === 'object' && 'default' in exp ? exp.default : exp
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    typeof manifest.id !== 'string' ||
    typeof manifest.name !== 'string' ||
    !Array.isArray(manifest.keywords) ||
    manifest.keywords.length === 0
  ) {
    throw new Error(`${dir}/manifest.ts 解析结果缺少 id/name/keywords`)
  }
  if (manifest.id !== dir) {
    // 目录名=id 是主/渲染两侧 glob 定位视图与 backend 的隐性约定，漂移时插件视图会渲染失败
    process.stderr.write(`[shot][warn] ${dir}/manifest.ts 的 id "${manifest.id}" 与目录名不一致\n`)
  }
  return manifest
}

async function loadBuiltinManifests() {
  const ents = await readdir(PLUGINS_DIR, { withFileTypes: true })
  const dirs = ents.filter((e) => e.isDirectory()).map((e) => e.name).sort()
  const manifests = []
  for (const dir of dirs) {
    manifests.push(await evalManifest(dir))
  }
  return manifests
}

/** DEFAULT_SETTINGS 真源加载（同 esbuild 管道 bundle sdk/settings.ts）：手写字面缺 transparency 时
 *  渲染层 applyVisualSettings 直接 TypeError，截图必白屏 */
async function loadDefaultSettings() {
  const entry = join(ROOT, 'sdk', 'settings.ts')
  const result = await build({ ...bundleOpts, entryPoints: [entry] })
  const exp = evalBundled(result.outputFiles[0].text, ROOT)
  const settings = exp?.DEFAULT_SETTINGS
  if (typeof settings !== 'object' || settings === null) throw new Error('sdk/settings.ts 缺 DEFAULT_SETTINGS 导出')
  return settings
}

// 截图宿主 IPC 容错：渲染层启动必需 app:init / plugin:enter；插件能力面给确定性的空值降级，
// 保证页面渲染不白屏（不做真实网络/剪贴板/文件操作）。storage 用内存实现保持 set→get 语义。
const memoryStorage = new Map()
// 场景级主题覆写（三模式材质验收）：null=真源默认 light
let themeOverride = null

function setupShotIpc(manifests, defaultSettings) {
  ipcMain.handle('gtools:host', (_e, req) => {
    const api = req?.api
    if (api === 'app:init') {
      return {
        ok: true,
        data: {
          settings: themeOverride === null ? defaultSettings : { ...defaultSettings, theme: themeOverride },
          plugins: manifests.map((m) => ({ manifest: m, enabled: true })),
          loadIssues: [],
          externalDetected: []
        }
      }
    }
    if (api === 'plugin:enter' || api === 'window:hide') return { ok: true, data: null }
    return { ok: false, error: 'SHOT_HOST_UNSUPPORTED', message: `截图宿主未实现宿主 api：${String(api)}` }
  })

  ipcMain.handle('gtools:api', (_e, req) => {
    const pluginId = req?.pluginId
    const api = req?.api
    const key = `${pluginId}:${String(req?.payload?.[0])}`
    const noNet = { ok: false, error: 'SERVICE_UNAVAILABLE', message: '截图宿主不提供网络服务' }
    switch (api) {
      case 'app.platform':
        return { ok: true, data: process.platform }
      case 'app.version':
        return { ok: true, data: app.getVersion() }
      case 'storage.get':
        return { ok: true, data: memoryStorage.has(key) ? memoryStorage.get(key) : null }
      case 'storage.set':
        memoryStorage.set(key, req.payload[1])
        return { ok: true, data: null }
      case 'storage.remove':
        memoryStorage.delete(key)
        return { ok: true, data: null }
      case 'storage.keys':
        return {
          ok: true,
          data: [...memoryStorage.keys()].filter((k) => k.startsWith(`${pluginId}:`)).map((k) => k.slice(pluginId.length + 1))
        }
      case 'clipboard.readText':
        return { ok: true, data: '' }
      case 'clipboard.readImage':
        return { ok: true, data: null }
      case 'net.fetch':
      case 'apis.translate':
        return noNet
      case 'apis.translate.status':
        // 形状对齐 sdk/api.ts ApiServiceStatus：translate 插件会直接 st.providers.filter(...)，缺字段即崩
        return {
          ok: true,
          data: {
            service: 'translate',
            configured: false,
            activeProviderId: '',
            activeProviderName: 'MyMemory',
            providers: []
          }
        }
      case 'net.lanAddresses':
        return { ok: true, data: [] }
      case 'fs.list':
        return { ok: true, data: [] }
      case 'fs.stat':
        return { ok: true, data: null }
      case 'dialog.openFile':
        return { ok: true, data: [] }
      case 'dialog.saveFile':
        return { ok: true, data: null }
      case 'window.float.create':
        return { ok: true, data: 'shot-float' }
      default:
        // 写操作与 shell/dialog/notification 等一律 no-op 成功
        return { ok: true, data: null }
    }
  })
}

function createShotWindow(hash, height = WIN_H) {
  const win = new BrowserWindow({
    width: WIN_W,
    height,
    show: false,
    frame: false,
    resizable: false,
    // 纯白底保证像素自检基线确定（真实窗口用透明底，截图不需要）
    backgroundColor: '#FFFFFFFF',
    webPreferences: {
      preload: PRELOAD_CJS,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  const consoleErrors = []
  win.webContents.on('console-message', (e) => {
    const msg = e?.message ?? ''
    if (typeof msg === 'string' && msg !== '' && String(e?.level) === '3') consoleErrors.push(msg)
  })
  const loaded = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`页面加载超时（${LOAD_TIMEOUT_MS}ms）`)), LOAD_TIMEOUT_MS)
    win.webContents.once('did-finish-load', () => {
      clearTimeout(t)
      res()
    })
  })
  const opts = hash ? { hash } : undefined
  void win.loadFile(RENDERER_HTML, opts)
  return { win, loaded, consoleErrors }
}

/** 等两次 rAF 确保至少一帧绘制完成，再补固定延时让异步组件/字体就位 */
async function settle(wc, ms) {
  await wc.executeJavaScript(
    'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'
  ).catch(() => {})
  await sleep(ms)
}

/** 像素自检：非空、尺寸合理、非纯白/纯色（量化色数过少视为空白页） */
function assertImageContent(img) {
  if (img.isEmpty()) throw new Error('capturePage 返回空图像')
  const { width, height } = img.getSize()
  if (width < 400 || height < 300) throw new Error(`截图尺寸异常 ${width}x${height}`)
  const bmp = img.toBitmap()
  if (!bmp || bmp.length < width * height * 4) throw new Error('位图数据缺失')
  const colors = new Set()
  let white = 0
  const total = width * height
  for (let i = 0; i < bmp.length; i += 16) {
    // BGRA，隔行抽样（4 像素取 1）足够判空白
    const b = bmp[i]
    const g = bmp[i + 1]
    const r = bmp[i + 2]
    const a = bmp[i + 3]
    if (b === 255 && g === 255 && r === 255 && a === 255) white++
    colors.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 4}`)
  }
  const sampled = Math.floor(bmp.length / 16)
  if (white / sampled > 0.995) throw new Error(`疑似纯白页（白像素 ${(100 * white / sampled).toFixed(1)}%）`)
  if (colors.size < 10) throw new Error(`疑似空白页（量化色数仅 ${colors.size}）`)
}

/** 页面内改 localStorage 后 reload，并等新一轮 did-finish-load（App 在 mounted 读一次 recents，不 reload 不生效） */
async function reloadWithStorage(wc, mutateJs) {
  await wc.executeJavaScript(mutateJs)
  const reloaded = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('reload 后加载超时')), LOAD_TIMEOUT_MS)
    wc.once('did-finish-load', () => {
      clearTimeout(t)
      res()
    })
  })
  wc.reload()
  await reloaded
  await settle(wc, SETTLE_MS)
}

async function runScenario({ name, hash, type, file, query, recentSeed, theme }) {
  const isRecent = type === 'shell-recent'
  const isShellGrid = type === 'shell-empty' || isRecent
  themeOverride = theme ?? null
  const { win, loaded, consoleErrors } = createShotWindow(hash, isShellGrid ? SHELL_GRID_WIN_H : WIN_H)
  try {
    await loaded
    const wc = win.webContents
    await settle(wc, SETTLE_MS)

    if (type === 'shell-empty') {
      // 清掉上次运行注入的 recents，保证空态首屏标准像不受跨运行污染
      await reloadWithStorage(wc, `localStorage.removeItem(${JSON.stringify(RECENT_LS_KEY)}); true`)
    }
    if (isRecent) {
      const seed = JSON.stringify(recentSeed ?? [])
      // 页面内 JSON.stringify：直接传数组字面量会被 setItem 隐式 toString 成 "[object Object]"
      await reloadWithStorage(
        wc,
        `localStorage.setItem(${JSON.stringify(RECENT_LS_KEY)}, JSON.stringify(${seed})); true`
      )
    }

    const typed = query ?? SHELL_QUERY
    if (type === 'shell-query' || type === 'shell-highlight') {
      // 搜索态无法用 hash 表达（渲染层 deep-link 只认 plugin= 前缀），聚焦输入框后 insertText 模拟输入
      await wc.executeJavaScript(
        '(() => { const el = document.querySelector(".searchbox input"); if (el) el.focus(); return !!el })()'
      )
      await wc.insertText(typed).catch(() => {})
      let v = await wc.executeJavaScript('document.querySelector(".searchbox input")?.value ?? ""')
      if (v !== typed) {
        await wc.executeJavaScript(
          `(() => { const el = document.querySelector(".searchbox input"); if (!el) return false;
             el.value = ${JSON.stringify(typed)}; el.dispatchEvent(new Event("input", { bubbles: true })); return true })()`
        )
        v = await wc.executeJavaScript('document.querySelector(".searchbox input")?.value ?? ""')
      }
      if (v !== typed) throw new Error('搜索框输入注入失败')
      await sleep(TYPE_SETTLE_MS)
    }

    // wintx 注入须后置于一切 reload/输入（reload 清 dataset）：darwin='1' 顺带触发 base.css
    // 透明边距 padding，外圈影/材质入镜可做视觉验收
    await wc.executeJavaScript(
      `document.documentElement.dataset.wintx = ${JSON.stringify(process.platform === 'darwin' ? '1' : '0')}; true`
    )
    await settle(wc, SETTLE_MS)

    // DOM 自检：确认目标态真的渲染出来（deep-link 未命中/插件崩了在这里暴露）
    const dom = await wc.executeJavaScript(`(() => {
      const recent = [...document.querySelectorAll('.empty-state .section')]
        .find((s) => (s.querySelector('.sec-title')?.textContent ?? '').includes('最近打开')) ?? null
      const rr = recent?.getBoundingClientRect()
      return {
        searchbox: !!document.querySelector('.searchbox input'),
        pluginView: !!document.querySelector('.plugin-page'),
        pluginError: document.querySelector('.plugin-error')?.textContent?.trim() ?? '',
        resultItems: document.querySelectorAll('.result-view .result-cell').length,
        hlCount: document.querySelectorAll('.result-view .hl').length,
        appCells: document.querySelectorAll('.empty-state .app-cell').length,
        pinBadges: document.querySelectorAll('.empty-state .app-cell .pin-badge').length,
        demoBadge: !!document.querySelector('.empty-state .demo-badge'),
        recentCells: recent ? recent.querySelectorAll('.app-grid .app-cell').length : 0,
        recentVisible: !!rr && rr.top < innerHeight && rr.bottom > 0
      }
    })()`)
    if (type === 'plugin') {
      if (!dom.pluginView) throw new Error(`deep-link 未进入插件视图（hash=${hash}）`)
      if (dom.pluginError !== '') throw new Error(`插件视图报错：${dom.pluginError}`)
    } else {
      // 插件模式下外壳模板不渲染 .searchbox，该检查只对 shell 场景有意义
      if (!dom.searchbox) throw new Error('外壳未渲染（缺 .searchbox）')
      if (dom.pluginView) throw new Error('空态场景误入插件视图')
      if (type === 'shell-query' && dom.resultItems === 0) throw new Error(`搜索 "${typed}" 无结果项`)
      if (type === 'shell-highlight') {
        if (dom.resultItems === 0) throw new Error(`搜索 "${typed}" 无结果项`)
        if (dom.hlCount === 0) throw new Error('字面命中未见 .hl 高亮段')
      }
      if (type === 'shell-empty') {
        if (dom.appCells === 0) throw new Error('空态应用网格未渲染（demo 注入未生效）')
        if (dom.pinBadges === 0) throw new Error('置顶角标未渲染（demo 预置置顶缺失）')
        if (!dom.demoBadge) throw new Error('示例数据标注缺失')
        if (dom.recentCells === 0) throw new Error('示例最近行未渲染')
      }
      if (isRecent) {
        if (dom.recentCells === 0) throw new Error('最近行未渲染（localStorage 注入未生效）')
        if (!dom.recentVisible) throw new Error('最近行未落入视口')
      }
    }

    // 内容超高插件自适应加高：量标题栏下缘 + 滚动容器 scrollHeight（含上下 padding），重设窗口后再等一帧
    if (type === 'plugin') {
      const need = await wc.executeJavaScript(
        `(() => { const el = document.querySelector('.plugin-body'); if (!el) return 0;
           return Math.ceil(el.getBoundingClientRect().top + el.scrollHeight) + 1 })()`
      )
      const h = Math.min(MAX_WIN_H, Math.max(WIN_H, need))
      if (h > WIN_H) {
        win.setContentSize(WIN_W, h)
        await settle(wc, SETTLE_MS)
      }
    }

    const img = await wc.capturePage()
    assertImageContent(img)
    await writeFile(file, img.toPNG())
    for (const e of consoleErrors) process.stderr.write(`[shot][warn] ${name}: 控制台报错 ${e.slice(0, 300)}\n`)
    process.stdout.write(`[ok] ${name} -> ${file}\n`)
    return true
  } catch (err) {
    for (const e of consoleErrors) process.stderr.write(`[shot][warn] ${name}: 控制台报错 ${e.slice(0, 300)}\n`)
    process.stderr.write(`[shot][fail] 场景 ${name}：${err instanceof Error ? err.message : String(err)}\n`)
    return false
  } finally {
    win.destroy()
  }
}

async function main() {
  const mode = parseArgs(process.argv.slice(2))

  if (!existsSync(RENDERER_HTML) || !existsSync(PRELOAD_CJS)) {
    process.stderr.write(
      `[shot] 缺少构建产物（${RENDERER_HTML} / ${PRELOAD_CJS}）。先执行 npm run build 再截图。\n`
    )
    app.exit(1)
    return
  }

  const manifests = await loadBuiltinManifests()
  if (mode.only !== null && !manifests.some((m) => m.id === mode.only)) {
    process.stderr.write(
      `[shot] 插件不存在：${mode.only}（可选：${manifests.map((m) => m.id).join(', ')}）\n`
    )
    app.exit(1)
    return
  }
  const defaultSettings = await loadDefaultSettings()

  const outDir = resolve(ROOT, mode.out ?? join('.zcode', 'screenshots'))
  await mkdir(outDir, { recursive: true })

  const scenarios = []
  if (mode.all || mode.shell) {
    scenarios.push({
      name: 'shell-empty',
      type: 'shell-empty',
      hash: SHELL_DEMO_HASH,
      file: join(outDir, 'shell-empty.png')
    })
    scenarios.push({ name: 'shell-query', type: 'shell-query', hash: '', query: SHELL_QUERY, file: join(outDir, 'shell-query.png') })
    scenarios.push({
      name: 'shell-highlight',
      type: 'shell-highlight',
      hash: '',
      query: SHELL_HL_QUERY,
      file: join(outDir, 'shell-highlight.png')
    })
    // 注入真实插件 id 作最近使用（越靠前越新），叠加 demo 示例应用网格；最后注入避免污染其他 shell 场景
    scenarios.push({
      name: 'shell-recent',
      type: 'shell-recent',
      hash: SHELL_DEMO_HASH,
      recentSeed: manifests.slice(0, 5).map((m, i) => ({ pluginId: m.id, at: Date.now() - i * 60_000 })),
      file: join(outDir, 'shell-recent.png')
    })
  }
  if (mode.all) {
    // 三模式材质验收（瓷实化改造）：demo 空态 × light/dark/glass，走真源默认透明链路 + wintx 注入
    for (const t of ['light', 'dark', 'glass']) {
      scenarios.push({
        name: `shell-theme-${t}`,
        type: 'shell-empty',
        theme: t,
        hash: SHELL_DEMO_HASH,
        file: join(outDir, `shell-theme-${t}.png`)
      })
    }
    for (const m of manifests) {
      scenarios.push({ name: m.id, type: 'plugin', hash: `plugin=${m.id}&demo=1`, file: join(outDir, `${m.id}.png`) })
    }
  } else if (!mode.shell) {
    scenarios.push({
      name: mode.only,
      type: 'plugin',
      hash: `plugin=${mode.only}&demo=1`,
      file: join(outDir, `${mode.only}.png`)
    })
  }

  setupShotIpc(manifests, defaultSettings)

  let okCount = 0
  for (const s of scenarios) {
    if (await runScenario(s)) okCount++
  }
  process.stdout.write(`[shot] 完成 ${okCount}/${scenarios.length}，输出目录 ${outDir}\n`)
  app.exit(okCount === scenarios.length ? 0 : 1)
}

// userData 指到 .zcode 下，避免截图会话读写真实应用分区（localStorage/缓存会污染真机数据）
app.setPath('userData', join(ROOT, '.zcode', '.shot-profile'))
// 每个场景 destroy 窗口后会触发 window-all-closed，默认行为是退出应用，必须拦下
app.on('window-all-closed', (e) => e.preventDefault())
app.whenReady().then(main).catch((err) => {
  process.stderr.write(`[shot] 未捕获异常：${err instanceof Error ? err.stack : String(err)}\n`)
  app.exit(1)
})
