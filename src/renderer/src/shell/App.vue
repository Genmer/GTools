<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import { rimFlowPeriodSeconds, type AppSettings } from '@sdk/settings'
import type { HostInitResult } from '../env'
import { buildAppEntries, buildEntries } from '../core/entries'
import { calc } from '../core/calc'
import { host } from '../core/host-bridge'
import { matchEntryBest, warmupPinyinIndex } from '../core/pinyin-index'
import type { SearchEntry } from '../core/matcher'
import { buildUtoolsEntries, UTOOLS_PLUGIN_ID, type UtoolsEntryScan } from '../core/utools-entries'
import { buildRecommendations, dedupeRecs, fileMatcherHits, mergeQueryRecommendations, type MatchFile, type RecItem } from '../core/recommend'
import {
  mergePushedItems,
  normalizePushedItem,
  pushedItemsToRecItems,
  replacePushedItems,
  type PushedItem
} from '../core/main-push'
import { navStep, type NavSection } from '../core/result-nav'
// 空态扁平目标与段界组装在 core/empty-targets.ts（纯逻辑，单测锁定段序）
import {
  buildEmptyTargets,
  emptySegmentOffsets,
  type EmptyTarget,
  type EmptyTargetsInput
} from '../core/empty-targets'
import { applyDeepLink, parseDeepLink } from './deep-link'
import { fillAppInfo } from '../core/app-info'
import { RIM_SEGMENTS_GRADIENT, RIM_SEGMENTS_RAINBOW } from './rim-ring-segments'
import { enterPlugin, enterSettings, exitLevel, isSettingsEntry, resetForShow, restOf, router, syncMode } from './router'
import {
  APPS_FOLD_COUNT,
  DEMO_APPS,
  DEMO_PINNED_IDS,
  parseAppsSnapshot,
  parsePinnedIds,
  reorderApps,
  type NativeAppItem
} from './app-grid'
import { buildRecentTiles, parseRecentRecords, pushRecent, type RecentRecord } from './recent-records'
import SearchBox from './SearchBox.vue'
import ResultList from './ResultList.vue'
import EmptyState from './EmptyState.vue'
import PluginViewHost from './PluginViewHost.vue'
import DetachedHost from './DetachedHost.vue'
import SettingsPage from './SettingsPage.vue'
import ClipboardFlyoutHost from './ClipboardFlyoutHost.vue'

interface PluginState {
  manifest: PluginManifest
  enabled: boolean
}

// 最近记录是插件与应用的按时间混合流，纯逻辑在 shell/recent-records.ts（可单测）
// 与 EmptyState 兜底分支的 recents prop 结构对齐
interface RecentRow {
  key: string
  title: string
  subtitle: string
  icon: string
  pluginId: string
  commandId?: string
}

// 最近使用属外壳 UI 状态（非插件数据），走 localStorage 不动设置与插件存储协议
const RECENT_KEY = 'gtools:recent-entries'
const APP_GRID_COLS = 9
// 全局态兜底窗口高度（内容口径，与主进程 CONTENT_H 对齐）；空态高度由 EmptyState 实测内容上报（§1.5）
const WINDOW_NORMAL_H = 560
// 透明窗（data-wintx=1）下 #app 有 32+48 透明边距：报高按内容口径扣掉，主进程 window.ts 负责加回
const WIN_TX_MARGIN = 80

const plugins = ref<PluginState[]>([])
const settings = ref<AppSettings | null>(null)
const activeIndex = ref(0)
const emptyIndex = ref(0)
// 计算器复制失败 toast：失败不藏窗，结果留在结果区，回车即重试；1.8s 自动消失
const calcCopyError = ref(false)
let calcCopyTimer: ReturnType<typeof setTimeout> | undefined
const searchBox = ref<InstanceType<typeof SearchBox> | null>(null)
const pluginHost = ref<InstanceType<typeof PluginViewHost> | null>(null)
const recentRecords = ref<RecentRecord[]>([])
// 独立窗口分流：#detached=true 深链时只渲染轻量宿主，不渲染主窗外壳
const isDetachedWindow = ref(false)
// 剪贴板飞窗分流：#clipboard-flyout=1 深链时只渲染剪贴板卡片（主窗外壳副作用整体跳过，F23）
const isFlyoutWindow = ref(false)

// 本机应用栏（apps:* 宿主通道）
const apps = ref<NativeAppItem[]>([])
const pinnedIds = ref<string[]>([])
const appsLoaded = ref(false)
const appsLoading = ref(false)
const appError = ref<string | null>(null)
const opError = ref<{ id: string; name: string; error: string } | null>(null)
const isDemo = ref(false)
let appsRequestId = 0
// window.gtools.on 返回的退订函数统一在此收集，卸载时逐个调用
const offFns: (() => void)[] = []

const enabledManifests = computed(() => plugins.value.filter((p) => p.enabled).map((p) => p.manifest))
const pluginEntries = computed(() => buildEntries(plugins.value))
const appEntries = computed(() => buildAppEntries(apps.value))
// uTools 插件功能词条：随 utools-port 启用态门控（禁用后词条消失，enterPlugin 对未知 id 也会兜底拒绝）
const utoolsEntries = ref<SearchEntry[]>([])
const entries = computed(() => [
  ...pluginEntries.value,
  ...appEntries.value,
  ...(plugins.value.some((p) => p.enabled && p.manifest.id === UTOOLS_PLUGIN_ID) ? utoolsEntries.value : [])
])
const results = computed(() => {
  const q = router.query.trim()
  if (q === '') return entries.value.map((e) => ({ entry: e, score: 0 }))
  const scored: { entry: (typeof entries.value)[number]; score: number }[] = []
  for (const e of entries.value) {
    const s = matchEntryBest(q, e)
    if (s !== null) scored.push({ entry: e, score: s })
  }
  scored.sort((a, b) => a.score - b.score)
  // 内联计算器合成词条置顶；无 pluginId，推荐区 keyword 路与词条池天然不沾
  const c = calc(q)
  if (c !== null) {
    scored.unshift({ entry: { key: 'host:calc', kind: 'plugin', title: `= ${c}`, subtitle: 'Enter 复制', icon: '🧮' }, score: -1 })
  }
  return scored
})
const visibleResults = computed(() => results.value.slice(0, 50))

const recentRows = computed<RecentRow[]>(() => {
  const rows: RecentRow[] = []
  for (const r of recentRecords.value) {
    if (r.kind === 'app') continue
    const m = enabledManifests.value.find((x) => x.id === r.pluginId)
    if (!m) continue // 插件已禁用/卸载则不展示
    const cmd = (m.commands ?? []).find((c) => c.id === r.commandId)
    let title = cmd ? cmd.title : m.name
    let subtitle = cmd ? m.name : (m.description ?? '')
    // uTools 功能词条（commandId=dir/code，不属宿主命令）回查词条标题；目录已删查不到则跳过
    if (!cmd && r.pluginId === UTOOLS_PLUGIN_ID) {
      const u = utoolsEntries.value.find((e) => e.commandId === r.commandId)
      if (!u) continue
      title = u.title
      subtitle = u.subtitle ?? ''
    }
    rows.push({
      key: `${r.pluginId}:${r.commandId ?? '_main'}`,
      title,
      subtitle,
      icon: m.icon,
      pluginId: r.pluginId,
      commandId: r.commandId
    })
    if (rows.length >= 5) break
  }
  return rows
})

// appsMode 空态的最近行：插件与应用按时间混合去重（记录已按新→旧存）；应用须仍在本机列表里
const recentTiles = computed(() =>
  buildRecentTiles(recentRecords.value, { manifests: enabledManifests.value, apps: apps.value, demo: isDemo.value })
)

// 扫描期间也用新布局（面板 + 加载占位），仅枚举为空/失败回退旧网格
const appsMode = computed(() => isDemo.value || appsLoading.value || (appsLoaded.value && apps.value.length > 0))

// 应用栏抽屉：默认折叠 2 行（17 应用 + 开关格），点击开关展开全部；离开空态自动收回
const appsExpanded = ref(false)
const visibleApps = computed(() => (appsExpanded.value ? apps.value : apps.value.slice(0, APPS_FOLD_COUNT)))
const hasAppsToggle = computed(() => apps.value.length > APPS_FOLD_COUNT)

function toggleAppsExpanded(): void {
  appsExpanded.value = !appsExpanded.value
}

// 拖入集（文件/图片推荐源）与常驻插件推送行；两者都只存内存，激活/清空输入/窗口隐藏时释放
const dropFiles = ref<MatchFile[]>([])
const hasDropImage = ref(false)
// 主面板粘贴图片（uTools 式：粘贴→空态出「贴图」推荐→回车直贴）；贴图无文件路径，
// 激活走 float-image 的 pin-clipboard 命令由插件自读剪贴板；缩略图只做输入框芯片展示
const pasteImage = ref(false)
const pasteThumb = ref<string | null>(null)
const pushedItems = ref<PushedItem[]>([])

function releaseDrop(): void {
  dropFiles.value = []
  hasDropImage.value = false
  pasteImage.value = false
  pasteThumb.value = null
}

function onDocPaste(e: ClipboardEvent): void {
  const items = e.clipboardData?.items
  if (!items) return
  // 判定不依赖 DOM flavor 转换（mac 各 App 形状差异大：QQ 动图只有 uri 引用无 image 项），
  // 一律主进程读板定夺；纯文本粘贴时 peek 返 null 自动无芯片
  void refreshPasteThumb()
}

async function refreshPasteThumb(): Promise<void> {
  const r = await host('clipboard:peek-image')
  const data = r.ok ? ((r.data as { thumb: string } | null) ?? null) : null
  pasteImage.value = data !== null
  pasteThumb.value = data?.thumb ?? null
}

function clearPaste(): void {
  pasteImage.value = false
  pasteThumb.value = null
}

// 常驻插件推送订阅（main-push）：plugin-event: 前缀已在 preload 白名单，on 返回退订函数。
// 订阅随启用集合变化精确增减（只在挂载建一次会让后启用的 resident 插件永远收不到推送）；
// 禁用生效到退订之间到达的推送由 merge/replace 的 mainPush 权限闸丢弃（enabledManifests 同步更新）
const pushOffs = new Map<string, () => void>()

function subscribeResidentPush(m: PluginManifest): void {
  if (pushOffs.has(m.id)) return
  const off = window.gtools.on(`plugin-event:${m.id}`, (raw) => {
    const w = raw as { event?: string; payload?: unknown } | null
    if (!w || w.event !== 'main-push') return
    // 数组 = backend 全量重推的整组替换语义（空组即清除该插件全部行）；单对象 = 单条并入（旧协议）
    if (Array.isArray(w.payload)) {
      const items = w.payload
        .map((x) => normalizePushedItem(x, m.id, { name: m.name, icon: m.icon }))
        .filter((x): x is PushedItem => x !== null)
      pushedItems.value = replacePushedItems(pushedItems.value, items, m.id, enabledManifests.value)
      return
    }
    // 单对象也走 normalizePushedItem 统一规整（含 payloadText 敏感兜底），不在此手拼字段
    const item = normalizePushedItem(w.payload, m.id, { name: m.name, icon: m.icon })
    if (item === null) return
    pushedItems.value = mergePushedItems(pushedItems.value, [item], enabledManifests.value)
  })
  if (off) pushOffs.set(m.id, off)
}

function syncPushSubscriptions(manifests: PluginManifest[]): void {
  const residents = new Set<string>()
  for (const m of manifests) {
    if (m.activation !== 'resident') continue
    residents.add(m.id)
    subscribeResidentPush(m)
  }
  for (const [id, off] of pushOffs) {
    if (residents.has(id)) continue
    off()
    pushOffs.delete(id)
    // 退订同时清该插件残留推送行，不等下一次 merge 才被权限闸过滤
    pushedItems.value = pushedItems.value.filter((x) => x.pluginId !== id)
  }
}

watch(enabledManifests, (v) => syncPushSubscriptions(v))

// 常驻推送行并入两处推荐 computed 最前；拼接按 key 去重先到先得，防推送行与 matcher/拖入行同 key 重复渲染
const pushedRecs = computed(() => pushedItemsToRecItems(pushedItems.value))

// 剪贴板探测结果（唤起/图片粘贴时刷新）：图片驱动「悬浮/保存成文件」动作行，JSON 驱动「JSON 编辑器」行
const clipboardImage = ref<{ width: number; height: number } | null>(null)
const clipboardJson = ref<string | null>(null)
// 剪贴板推荐读取总开关（隐私语义：显式关闭后渲染层不发 peek，主进程 peek 接口另有同闸双保险）
const clipboardSuggestOn = computed(() => settings.value?.clipboardSuggest !== false)

// 事件路径去抖间隔：合并面板 copy/remove/clear 连击与 ~1s 轮询风暴；直调点（粘贴/首帧/唤起）不走此包装保持即时
const CLIPBOARD_REC_EVENT_DEBOUNCE_MS = 200
let clipboardRecTimer: ReturnType<typeof setTimeout> | undefined

function refreshClipboardRecs(): void {
  if (!clipboardSuggestOn.value) return
  void host('clipboard:peek-image')
    .then((r) => {
      const d = r.ok ? (r.data as { width?: unknown; height?: unknown } | null | undefined) : null
      clipboardImage.value =
        d && typeof d.width === 'number' && typeof d.height === 'number'
          ? { width: d.width, height: d.height }
          : null
    })
    .catch(() => {
      clipboardImage.value = null
    })
  void host('clipboard:peek-json')
    .then((r) => {
      clipboardJson.value = r.ok && typeof r.data === 'string' ? r.data : null
    })
    .catch(() => {
      clipboardJson.value = null
    })
}

// trailing 去抖：广播事件路径专用（主窗可见期间外部拷贝即时刷新），高频风暴只落最后一次
function scheduleClipboardRecsRefresh(): void {
  if (clipboardRecTimer !== undefined) clearTimeout(clipboardRecTimer)
  clipboardRecTimer = setTimeout(() => {
    clipboardRecTimer = undefined
    refreshClipboardRecs()
  }, CLIPBOARD_REC_EVENT_DEBOUNCE_MS)
}

// 剪贴板有图时的动作行（图标+名称纪律）：悬浮=pin-clipboard（插件自读剪贴板），保存=save-clipboard
const clipboardImageRecs = computed<RecItem[]>(() => {
  const img = clipboardImage.value
  if (img === null) return []
  if (!enabledManifests.value.some((m) => m.id === 'float-image')) return []
  return [
    {
      key: 'float-image:pin-clipboard',
      pluginId: 'float-image',
      commandId: 'pin-clipboard',
      title: '悬浮图片',
      subtitle: `贴图 ${img.width}×${img.height}`,
      icon: '📌',
      source: 'img'
    },
    {
      key: 'float-image:save-clipboard',
      pluginId: 'float-image',
      commandId: 'save-clipboard',
      title: '保存成文件',
      subtitle: '剪贴板图片存为 PNG',
      icon: '💾',
      source: 'img'
    }
  ]
})

// 剪贴板有 JSON 时的动作行（空态专属）：payload 全文带进 json-editor，进插件即格式化；
// query 非空不产出（输入/粘贴的 JSON 走 query 态 json matcher，同链路）
const clipboardJsonRecs = computed<RecItem[]>(() => {
  const text = clipboardJson.value
  if (text === null) return []
  const m = enabledManifests.value.find((x) => x.id === 'json-editor')
  if (!m) return []
  return [
    {
      key: 'json-editor:_clipboard',
      pluginId: 'json-editor',
      title: m.name,
      subtitle: `剪贴板 JSON · ${text.trim().length} 字符`,
      icon: m.icon,
      source: 'json',
      payload: text
    }
  ]
})

const clipboardRecs = computed(() =>
  dedupeRecs([
    ...clipboardImageRecs.value,
    ...clipboardJsonRecs.value,
    ...pushedRecs.value,

    ...buildRecommendations({ query: '', manifests: enabledManifests.value }),
    // 空 query 下 buildRecommendations 恒空（matcher 只认 query 自身检测，剪贴板源已拆除），拖入行直调 fileMatcherHits 补上
    ...fileMatcherHits(dropFiles.value, enabledManifests.value, hasDropImage.value)
  ])
)
const resultKeys = computed(() => new Set(visibleResults.value.map((i) => i.entry.key)))
// query 态推荐区（ResultList 推荐段）；空 query 恒空（空态推荐落 EmptyState 顶部行）。
// 顺序：query 自身 JSON 检测第一（mergeQueryRecommendations 契约）→ 剪贴板图片动作行（图片进不了
// 输入框，粘贴后靠这两行承接）→ 推送行 → 其余推荐
const recommendations = computed(() => {
  if (router.query.trim() === '') return []
  const merged = mergeQueryRecommendations(
    pushedRecs.value,
    buildRecommendations({
      query: router.query,
      entries: entries.value,
      resultKeys: resultKeys.value,
      manifests: enabledManifests.value,
      files: dropFiles.value,
      hasImage: hasDropImage.value
    })
  )
  return dedupeRecs([
    ...merged.filter((r) => r.source === 'json'),
    ...clipboardImageRecs.value,
    ...merged.filter((r) => r.source !== 'json')
  ])
})

// 空态推荐行前置（推送/拖入源）：两分支均占扁平序最前 K 位；
// 拖入行（files/img 源）激活时把拖入集经 initialPayload 通道带给插件
const emptyInput = computed<EmptyTargetsInput>(() =>
  appsMode.value
    ? {
        appsMode: true,
        clipRecs: clipboardRecs.value,
        dropFiles: dropFiles.value,
        recentTiles: recentTiles.value,
        appIds: visibleApps.value.map((a) => a.id),
        hasAppsToggle: hasAppsToggle.value
      }
    : {
        appsMode: false,
        clipRecs: clipboardRecs.value,
        dropFiles: dropFiles.value,
        pluginIds: enabledManifests.value.map((m) => m.id),
        recentRows: recentRows.value
      }
)
const emptyTargets = computed<EmptyTarget[]>(() => buildEmptyTargets(emptyInput.value))

const emptyVisible = computed(() => router.mode === 'global' && router.query.trim() === '')

watch(
  () => router.query,
  (q, prev) => {
    syncMode(enabledManifests.value)
    activeIndex.value = 0
    emptyIndex.value = 0
    // 拖入集在 query 清空时释放（激活时的释放见 activateEntry）
    if (prev !== undefined && q.trim() === '' && prev.trim() !== '') releaseDrop()
  }
)
watch(enabledManifests, () => {
  syncMode(enabledManifests.value)
})
// 拼音索引空闲预建：首键不再停顿；词条池随插件/应用/utools 词条异步就绪逐步补齐（已建自动跳过）
watch(
  entries,
  (list) => {
    const titles: string[] = []
    for (const e of list) {
      titles.push(e.title)
      for (const k of e.keywords ?? []) titles.push(k)
    }
    warmupPinyinIndex(titles)
  },
  { immediate: true }
)
watch(
  () => emptyTargets.value.length,
  (n) => {
    if (emptyIndex.value >= n) emptyIndex.value = 0
  }
)

// 窗口高度自适应（§1.5）：空态与搜索结果均由内容实测自然高度决定，超限由主进程夹紧。
// 上报节流：rAF 合帧 + 最小变化阈值（ResultList 已按行数分档，同档不重复报高，输入不逐键 resize）
let lastSentHeight = WINDOW_NORMAL_H
const measuredH = ref(0)
function onContentResize(height: number): void {
  measuredH.value = height
}
watch(emptyVisible, (visible) => {
  if (!visible && appsExpanded.value) appsExpanded.value = false
})

watch(
  () => {
    // 飞窗/独立窗不参与主窗高度上报链（红线 7）
    if (isDetachedWindow.value || isFlyoutWindow.value) return WINDOW_NORMAL_H
    if (router.mode !== 'global') return WINDOW_NORMAL_H // 已是内容口径，主进程负责加边距
    if (measuredH.value <= 0) return WINDOW_NORMAL_H
    // 实测值含透明窗边距（视口坐标），按内容口径扣掉
    return document.documentElement.dataset.wintx === '1' ? measuredH.value - WIN_TX_MARGIN : measuredH.value
  },
  (h) => {
    if (h === lastSentHeight) return
    lastSentHeight = h
    void host('window:set-height', { height: h })
  },
  // immediate：热重载/挂载即对齐一次窗口高度，否则停留在旧高度（如 560）显得下方留白过大
  { immediate: true }
)

async function loadApps(force = false): Promise<void> {
  if (isDemo.value) return
  const id = ++appsRequestId
  appsLoading.value = true
  appError.value = null
  const r = await host('apps:list', force ? { refresh: true } : undefined)
  if (id !== appsRequestId) return // 过期响应（期间已手动刷新）丢弃
  appsLoading.value = false
  if (!r.ok) {
    appError.value = r.error ?? '未知错误'
    return
  }
  const snap = parseAppsSnapshot(r.data)
  if (!snap) {
    appError.value = '应用数据格式异常'
    return
  }
  apps.value = snap.apps
  pinnedIds.value = snap.pinned
  appsLoaded.value = true
}

// uTools 插件扫描→词条：失败/空静默置 []（utools-port 未装插件属常态，不弹错）
async function loadUtoolsEntries(): Promise<void> {
  const r = await host('utools:list')
  if (!r.ok) {
    utoolsEntries.value = []
    return
  }
  utoolsEntries.value = buildUtoolsEntries((r.data ?? []) as UtoolsEntryScan[])
}

// ---- 拖入文件/图片（推荐源 files/img）----

const DROP_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'])

function extOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase()
}

function onDrop(e: DragEvent): void {
  const dt = e.dataTransfer
  if (!dt || dt.files.length === 0) return
  // pathForFile 与 webkitGetAsEntry 都必须在 drop 的同步上下文里调用（webUtils/条目句柄限制）
  const paths = Array.from(dt.files).map((f) => window.gtools.pathForFile(f))
  const dtEntries = Array.from(dt.items).map((it) => {
    try {
      return it.webkitGetAsEntry()
    } catch {
      return null
    }
  })
  const dropped: MatchFile[] = paths.map((p, i) => {
    // 条目与文件列表按下标配对；取不到条目句柄时按文件处理
    const isDirectory = dtEntries[i]?.isDirectory === true
    const name = p.split(/[\\/]+/).pop() ?? p
    return { path: p, name, isDirectory, isFile: !isDirectory }
  })
  dropFiles.value = dropped
  hasDropImage.value = dropped.some((f) => f.isFile && DROP_IMAGE_EXTS.has(extOf(f.name)))
}

// 位图粘贴：伪文件名（Windows 给位图的 dt.files 名，如 image.png）写进输入框作可见反应，
// 同时刷新「悬浮/保存成文件」动作行（query 非空时这两行在推荐区仍前置）；插件态只刷新不动参数框
function onImagePaste(name?: string): void {
  refreshClipboardRecs()
  if (router.mode === 'global' && name && name !== '') router.query = name
}

// 粘贴文件（资源管理器 Ctrl+C）：与拖拽同构入 dropFiles（matchers 推荐 + 激活时 initialPayload 全通路）；
// 文件名写进输入框作可见反应（仅全局态，插件态参数框不动与拖拽一致）
function onFilePaste(paths: string[], names: string[]): void {
  const pasted: MatchFile[] = paths.map((p, i) => ({
    path: p,
    name: names[i] !== '' ? names[i] : (p.split(/[\\/]+/).pop() ?? p),
    isDirectory: false,
    isFile: true
  }))
  dropFiles.value = pasted
  hasDropImage.value = pasted.some((f) => DROP_IMAGE_EXTS.has(extOf(f.name)))
  const joined = pasted.map((f) => f.name).join(' ')
  if (router.mode === 'global' && joined !== '') router.query = joined
}

async function openAppById(appId: string): Promise<void> {
  const a = apps.value.find((x) => x.id === appId)
  if (!a) return
  if (isDemo.value) {
    opError.value = { id: '', name: a.name, error: `「${a.name}」为示例应用，不可打开` }
    return
  }
  pushRecentApp(a.id)
  router.query = ''
  // 先藏窗再异步打开：shell.openPath 可达数百 ms，串行等待会显得「点了没反应」
  void host('window:hide')
  const r = await host('apps:open', { path: a.path })
  if (!r.ok) {
    // 打开失败把窗口带回来当面报错，否则用户只觉得没反应
    void host('window:show')
    opError.value = { id: a.id, name: a.name, error: `打开「${a.name}」失败：${r.error ?? '未知错误'}` }
    return
  }
  opError.value = null
}

async function toggleAppPin(appId: string): Promise<void> {
  const a = apps.value.find((x) => x.id === appId)
  if (!a) return
  const pinnedNow = pinnedIds.value.includes(appId)
  if (isDemo.value) {
    const next = pinnedNow ? pinnedIds.value.filter((x) => x !== appId) : [...pinnedIds.value, appId]
    pinnedIds.value = next
    apps.value = reorderApps(apps.value, next)
    return
  }
  const r = await host(pinnedNow ? 'apps:unpin' : 'apps:pin', { id: appId })
  if (!r.ok) {
    opError.value = { id: '', name: a.name, error: `${pinnedNow ? '取消置顶' : '置顶'}失败：${r.error ?? '未知错误'}` }
    return
  }
  // 宿主 data 即置顶全量数组（ipc.ts apps:pin/unpin 直传 string[]），非数组视为格式异常
  const pinned = parsePinnedIds(r.data)
  if (!pinned) {
    opError.value = { id: '', name: a.name, error: '置顶结果数据格式异常' }
    return
  }
  pinnedIds.value = pinned
  apps.value = reorderApps(apps.value, pinned)
}

function loadRecent(): void {
  recentRecords.value = parseRecentRecords(localStorage.getItem(RECENT_KEY))
}

function persistRecent(): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentRecords.value))
  } catch {
    // 存不进去只影响下次启动的最近列表，静默降级
  }
}

function pushRecentPlugin(pluginId: string, commandId?: string): void {
  recentRecords.value = pushRecent(recentRecords.value, { kind: 'plugin', pluginId, commandId, at: Date.now() })
  persistRecent()
}

function pushRecentApp(appId: string): void {
  recentRecords.value = pushRecent(recentRecords.value, { kind: 'app', appId, at: Date.now() })
  persistRecent()
}

function activateEntry(pluginId: string, commandId?: string, rest?: string, payload?: MatchFile[], text?: string): void {
  // 拖入集生命周期到激活为止；先进入（enterPlugin 已持有数组引用）再释放 ref
  if (isSettingsEntry(pluginId)) {
    releaseDrop()
    enterSettings()
    void nextTick(() => searchBox.value?.focus())
    return
  }
  // rest 为推荐命中文本（超限已被 recommend 层剥离），经既有 "kw rest" 通路进插件 query；
  // payload 为拖入文件列表走 initialPayload 通道；text 为激活注入文本（如剪贴板 JSON 全文）走 initialText 通道
  enterPlugin(pluginId, enabledManifests.value, commandId, rest ?? '', payload, text)
  // trigger 型带 backend 的插件（如 app-launcher）在首次进入时启动
  void host('plugin:enter', { id: pluginId })
  pushRecentPlugin(pluginId, commandId)
  releaseDrop()
}

function activateEmptyTarget(t: EmptyTarget): void {
  if (t.kind === 'app') void openAppById(t.appId)
  else if (t.kind === 'apps-toggle') toggleAppsExpanded()
  else activateEntry(t.pluginId, t.commandId, t.payload, t.files)
}

// appsMode 键盘导航：扁平序 = 剪贴板推荐行 + 最近行（两段合并为一个 1×N 前缀）→ 可见应用网格（9 列）→ 抽屉开关格；
// 横向循环，纵向按列对齐跨行/进前缀行，边界停住
function navEmptyGrid(dir: 1 | -1, axis: 'x' | 'y'): void {
  // R/A 从与 emptyTargets 同一输入的段界偏移取，不再手写累加
  const off = emptySegmentOffsets(emptyInput.value)
  const R = off.middleEnd
  const A = off.total - R
  const n = off.total
  if (n === 0) return
  const i = emptyIndex.value
  if (axis === 'x') {
    emptyIndex.value = (i + dir + n) % n
    return
  }
  if (i < R) {
    if (dir === 1 && A > 0) emptyIndex.value = Math.min(R + i, n - 1)
    return
  }
  const gi = i - R
  const t = gi + dir * APP_GRID_COLS
  if (t >= 0 && t < A) emptyIndex.value = R + t
  else if (t < 0 && R > 0) emptyIndex.value = Math.min(gi % APP_GRID_COLS, R - 1)
}

function onNav(dir: 1 | -1, axis: 'x' | 'y'): void {
  if (router.query.trim() === '') {
    if (appsMode.value) {
      navEmptyGrid(dir, axis)
      return
    }
    const n = emptyTargets.value.length
    if (n === 0) return
    // 兜底网格区上下按列距 4 跨行，其余步长 1；整体循环导航（插件中段 [clipEnd, middleEnd) y 步长 4）
    const off = emptySegmentOffsets(emptyInput.value)
    const step = axis === 'y' && emptyIndex.value >= off.clipEnd && emptyIndex.value < off.middleEnd ? 4 : 1
    emptyIndex.value = (emptyIndex.value + dir * step + n) % n
    return
  }
  // 结果态分区扁平导航（B/C）：主结果区 + 推荐区；两区合计为 0 时方向键 no-op，不回退输入框光标
  const sections: NavSection[] = [
    { start: 0, count: visibleResults.value.length, cols: APP_GRID_COLS },
    { start: visibleResults.value.length, count: recommendations.value.length, cols: APP_GRID_COLS }
  ]
  const total = sections.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return
  // 推荐区/结果区收缩后 activeIndex 可能越界（navStep 找不到所属区会原地踏步），先夹回
  if (activeIndex.value >= total) activeIndex.value = total - 1
  activeIndex.value = navStep(activeIndex.value, sections, dir, axis)
}

// 计算器复制失败不藏窗（win32 剪贴板被占用时 writeText 会 reject，藏窗即复制了个寂寞）：
// 窗口留在结果态亮红色 toast，回车即重试
async function copyCalcResult(result: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(result)
  } catch {
    calcCopyError.value = true
    if (calcCopyTimer !== undefined) clearTimeout(calcCopyTimer)
    calcCopyTimer = setTimeout(() => (calcCopyError.value = false), 1800)
    return
  }
  // 失败后 1.8s 内重试成功：复位错误态，防下次唤起闪现陈旧失败提示
  if (calcCopyTimer !== undefined) clearTimeout(calcCopyTimer)
  calcCopyError.value = false
  void host('window:hide')
}

function onSelect(index: number): void {
  if (index >= visibleResults.value.length) {
    const rec = recommendations.value[index - visibleResults.value.length]
    if (rec) activateRec(rec)
    return
  }
  const item = visibleResults.value[index]
  if (!item) return
  // 计算器词条：展示与激活同源（按当前 query 现算），复制成功才隐藏窗口
  if (item.entry.key === 'host:calc') {
    const result = calc(router.query.trim())
    if (result !== null) void copyCalcResult(result)
    else void host('window:hide')
    return
  }
  if (item.entry.kind === 'app' && item.entry.appId) {
    void openAppById(item.entry.appId)
  } else if (item.entry.pluginId) {
    // uTools 语义「关键词命中后带余文进入」：按最长命中关键词剥离前缀，余文经既有 query 通路进插件
    const q = router.query.trim()
    const kws = [item.entry.title, ...(item.entry.keywords ?? [])].filter(
      (k): k is string => typeof k === 'string' && k !== ''
    )
    const kw = [...kws].sort((a, b) => b.length - a.length).find((k) => q.startsWith(k))
    activateEntry(item.entry.pluginId, item.entry.commandId, kw !== undefined ? q.slice(kw.length).trim() : '')
  }
}

function activateRec(rec: RecItem): void {
  // json 源命中文本（可能超 query 通道长度上限）全文走 initialText 通道，rest 不带；
  // 其余 matcher 命中型带命中文本进既有 query 通路；keyword 沾边型无 payload 只进入；
  // 拖入行（files/img 源）把拖入集经 initialPayload 通道带给插件
  const asText = rec.source === 'json'
  activateEntry(
    rec.pluginId,
    rec.commandId,
    asText ? undefined : rec.payload,
    rec.source === 'files' || rec.source === 'img' ? dropFiles.value : undefined,
    asText ? rec.payload : undefined
  )
}

function onEnter(): void {
  if (router.query.trim() === '') {
    const t = emptyTargets.value[emptyIndex.value]
    if (t) activateEmptyTarget(t)
    return
  }
  onSelect(activeIndex.value)
}

function onEmptySelect(index: number): void {
  const t = emptyTargets.value[index]
  if (t) activateEmptyTarget(t)
}

function onAppOpen(id: string): void {
  void openAppById(id)
}

function onAppPin(id: string): void {
  void toggleAppPin(id)
}

function onRefreshApps(): void {
  void loadApps(true)
}

function onRetryOpen(): void {
  if (opError.value?.id) void openAppById(opError.value.id)
  else opError.value = null
}

function exitToGlobal(): void {
  exitLevel(enabledManifests.value)
  void nextTick(() => searchBox.value?.focus())
}

// SearchBox 的 exit（Esc/Backspace/胶囊×）退插件后模板切回全局，焦点必须显式还给输入框，否则断键盘心流
function onExitFromSearchBox(): void {
  const wasInPlugin = router.mode === 'plugin'
  exitLevel(enabledManifests.value)
  if (wasInPlugin || router.mode === 'global') {
    void nextTick(() => searchBox.value?.focus())
  }
}

// 把当前插件连参数带进独立窗口（主窗保持原态，失焦后自然隐藏）
function detachActivePlugin(): void {
  if (router.mode !== 'plugin' || router.activePluginId === null) return
  const q = restOf(router.query, enabledManifests.value)
  void host('window:detach-plugin', { id: router.activePluginId, query: q })
}

function toggleSettings(): void {
  if (router.mode === 'settings') exitToGlobal()
  else {
    enterSettings()
    void nextTick(() => searchBox.value?.focus())
  }
}

// 插件态窗口级按键：Cmd/Ctrl+D 独立窗口打开；Esc 逐级退出兜底（插件已消费的 Esc 不劫持）；独立窗口不归主窗外壳管
function onWindowKeydown(e: KeyboardEvent): void {

  if (isDetachedWindow.value || isFlyoutWindow.value) return
  // 设置页 Esc：焦点常落在页面控件上（搜索框之外），SearchBox 收不到，须窗口级兜底（已消费的 Esc 不劫持）
  if (e.key === 'Escape' && router.mode === 'settings' && !e.isComposing && !e.defaultPrevented) {
    e.preventDefault()
    exitToGlobal()
    return
  }
  if (router.mode === 'plugin' && !e.isComposing && (e.key === 'd' || e.key === 'D') && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    detachActivePlugin()
    return
  }
  if (router.mode !== 'plugin' || e.key !== 'Escape' || e.isComposing || e.defaultPrevented) return
  e.preventDefault()
  exitToGlobal()
}

// 插件态临时放开主窗拉伸（Detach 场景需要更大画布），退出时复原固定尺寸
watch(
  () => router.mode,
  (mode, prev) => {
    if (isDetachedWindow.value || isFlyoutWindow.value) return
    if (mode === 'plugin' && prev !== 'plugin') {
      void host('window:set-resizable', { resizable: true, minWidth: 520, minHeight: 360 })
    } else if (mode !== 'plugin' && prev === 'plugin') {
      void host('window:set-resizable', { resizable: false })
    }
  }
)

// 自绘拉伸手柄：pointer 增量上报主进程改窗（同浮窗 drag-move 套路），不依赖 OS 隐形外缘拖拽
function onRzDown(e: PointerEvent, axis: 'x' | 'y' | 'xy'): void {
  if (e.button !== 0) return
  e.preventDefault()
  const el = e.currentTarget as HTMLElement
  let lx = e.screenX
  let ly = e.screenY
  const move = (ev: PointerEvent): void => {
    const dw = axis === 'y' ? 0 : Math.round(ev.screenX - lx)
    const dh = axis === 'x' ? 0 : Math.round(ev.screenY - ly)
    if (dw === 0 && dh === 0) return
    lx = ev.screenX
    ly = ev.screenY
    void host('window:resize-by', { dw, dh })
  }
  const up = (): void => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
    el.removeEventListener('pointercancel', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
  el.addEventListener('pointercancel', up)
  try {
    el.setPointerCapture(e.pointerId)
  } catch {
    // 捕获失败仍靠元素自身事件工作，只是指针移出条带会断
  }
}

function applyVisualSettings(s: AppSettings): void {
  document.documentElement.dataset.theme = s.theme
  // 玻璃主题自身即玻璃面板，透明属性强制开启（透明度滑杆仍调节玻璃密度）
  document.documentElement.dataset.transparency = s.transparency.enabled || s.theme === 'glass' ? 'on' : 'off'
  document.documentElement.dataset.blur = s.transparency.blur ? 'on' : 'off'
  // 轮廓环总开关：关=伪元素环宽归零（黑/白线与七彩环共用 --rim-width）
  document.documentElement.dataset.ring = s.outlineEnabled ? 'on' : 'off'
  document.documentElement.style.setProperty('--tx', (s.transparency.opacity / 100).toFixed(2))
  // (1-tx)³ 感知曲线：玻璃主题专用——滑杆低段陡增保证 0 档够白可读，高段维持清玻璃
  document.documentElement.style.setProperty('--txp', Math.pow(1 - s.transparency.opacity / 100, 3).toFixed(4))

  // 霜曲线 (glassFrost/100)^0.9 CSS calc 表达不了，JS 算好注入；旧载荷缺字段宽松回 45（与 DetachedHost/飞窗四点同公式）
  const frostPct = s.transparency.glassFrost
  const frost = typeof frostPct === 'number' && Number.isFinite(frostPct) ? Math.min(Math.max(frostPct, 0), 100) : 45
  document.documentElement.style.setProperty('--frost', Math.pow(frost / 100, 0.9).toFixed(4))
  // 自定义背景恒注入两 token（禁用/glass = none + 0，不清 token 防 IACVT）；独立窗/飞窗不做（F5）；
  // 契约外补 dataUrl 非空守卫：未拉到时暂按关注入防 url(null)，refreshBackground 拉到后重应用
  if (!isDetachedWindow.value && !isFlyoutWindow.value) {
    const bg = s.background
    const bgOn = bg?.enabled === true && s.theme !== 'glass' && bgDataUrl.value !== null
    document.documentElement.style.setProperty(
      '--wp-image',
      bgOn && bgDataUrl.value ? `url("${bgDataUrl.value}")` : 'none'
    )
    document.documentElement.style.setProperty('--wp-dim', bgOn ? ((bg.dim / 100) * 0.85).toFixed(2) : '0')
  }
  // 霜曲线：(1-t)^0.9 幂次 CSS calc 表达不了，JS 算好注入（themes.css 玻璃块 blur 消费）
  document.documentElement.style.setProperty('--txf', Math.pow(1 - s.transparency.opacity / 100, 0.9).toFixed(4))
  // off 注入 0px 而非清内联——清后回落 CSS 竞争会被透明组特异性压过致环复活
  document.documentElement.style.setProperty('--rim-width', s.outlineEnabled ? `${s.outlineWidth}px` : '0px')
  if (s.outlineColor === 'auto') delete document.documentElement.dataset.rimColor
  else document.documentElement.dataset.rimColor = s.outlineColor
  // 自定义环色无条件注入（store sanitize 已保证合法 hex，未选中时仅闲置）
  document.documentElement.style.setProperty('--rim-custom', s.outlineCustomColor)
  // 流动周期由速度档位算出（36/s 秒）；settings-store 已夹 1..10，坏值公式内回退 12s
  document.documentElement.style.setProperty('--rim-flow-period', `${rimFlowPeriodSeconds(s.outlineFlowSpeed)}s`)
  // 流动开关与 rimColor 同步原子写入；关环置 off 消除 0 宽 border 的空帧动画开销
  const rimFlow = (s.outlineColor === 'rainbow' || s.outlineColor === 'rainbow-gradient') && s.outlineEnabled
  document.documentElement.dataset.rimFlow = rimFlow ? 'on' : 'off'
}

// 背景图 dataUrl（主窗专属拉取，F5）：选图/清除由主进程广播 settings-changed 回流后经 watch 重拉
const bgDataUrl = ref<string | null>(null)

async function refreshBackground(): Promise<void> {
  if (isDetachedWindow.value || isFlyoutWindow.value) return
  const r = await host('background:get')
  const d = (r.ok ? r.data : null) as { dataUrl?: unknown } | null
  bgDataUrl.value = d !== null && typeof d.dataUrl === 'string' ? d.dataUrl : null
  if (settings.value) applyVisualSettings(settings.value)
}

watch(
  () => [settings.value?.background.file, settings.value?.background.enabled],
  () => {
    void refreshBackground()
  }
)

onMounted(async () => {

  // 深度链接初始化（#plugin=<id>&q=… / #demo=1 / #detached=true… / #clipboard-flyout=1），仅启动时生效
  const link = parseDeepLink(location.hash)
  isDetachedWindow.value = link?.isDetached === true
  isFlyoutWindow.value = link?.isFlyout === true
  if (!isFlyoutWindow.value) loadRecent()
  // 渲染层兜底错误上报主进程日志缓冲（尽力而为：独立窗被主进程拒绝/窗口濒死均忽略不抛）
  window.addEventListener('error', (ev) => {
    const d = ev.error ?? ev.message
    const text = d instanceof Error ? `渲染层 error ${d.name}: ${d.message}` : `渲染层 error ${String(d)}`
    void host('app-log:push', { level: 'error', text }).catch(() => {})
  })
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason
    const text = r instanceof Error ? `渲染层 unhandledRejection ${r.name}: ${r.message}` : `渲染层 unhandledRejection ${String(r)}`
    void host('app-log:push', { level: 'error', text }).catch(() => {})
  })

  const r = await host('app:init')
  if (r.ok) {
    const init = r.data as HostInitResult
    // app:init 真值回填进单例（早于下方 plugins 赋值，任何插件挂载时已是真值；飞窗/独立窗同样路过这里）
    fillAppInfo({ platform: init.platform, version: init.version })
    if (isFlyoutWindow.value) {
      // 飞窗只要视觉态：主窗外壳副作用整体跳过，面板数据与主题订阅在 ClipboardFlyoutHost（F23）
      applyVisualSettings(init.settings)
      return
    }
    plugins.value = init.plugins
    settings.value = init.settings
    applyVisualSettings(init.settings)
    if (link?.demo) {
      // demo 态注入示例应用（截图场景），不走宿主 apps 通道；预置置顶示例使角标可核验
      isDemo.value = true
      pinnedIds.value = [...DEMO_PINNED_IDS]
      apps.value = reorderApps(DEMO_APPS, DEMO_PINNED_IDS)
      appsLoaded.value = true
    }
    if (link?.pluginId) {
      const ok = applyDeepLink(link, enabledManifests.value)
      console.info(ok ? `[deep-link] 已进入插件 ${link.pluginId}` : `[deep-link] 插件 ${link.pluginId} 不存在或未启用`)
      if (ok) void host('plugin:enter', { id: link.pluginId })
    }
    if (!isDemo.value && !isDetachedWindow.value) void loadApps()
    void loadUtoolsEntries()
    // 首帧即探一次剪贴板图片/JSON（覆盖「已可见但未再经历 visibilitychange」的唤出）
    if (!isDetachedWindow.value) refreshClipboardRecs()
  }
  window.gtools.on('settings-changed', (p) => {
    const wasSuggestOn = clipboardSuggestOn.value
    settings.value = p as AppSettings
    applyVisualSettings(p as AppSettings)
    // 推荐开关切换即时生效：关=清两行缓存（行随之消失），开=立即探一次（不等下次唤起/广播）
    if (clipboardSuggestOn.value !== wasSuggestOn) {
      if (clipboardSuggestOn.value) refreshClipboardRecs()
      else {
        clipboardImage.value = null
        clipboardJson.value = null
      }
    }
  })
  window.gtools.on('plugin-state-changed', (p) => {
    const d = p as { id: string; enabled: boolean; plugins: PluginState[] }
    plugins.value = d.plugins
  })
  window.gtools.on('host:open-settings', () => {
    enterSettings()
    void nextTick(() => searchBox.value?.focus())
  })
  // 常驻插件推送订阅初始建立（此后由 enabledManifests watch 随启用集合增减，Map 去重防重订阅）
  syncPushSubscriptions(enabledManifests.value)
  // 指令热键直达：主进程侧已先 showSearchWindow（P7 车道），渲染层只负责进入插件命令态；
  // 通道白名单条目由 P7 在 preload 增补，缺省时 on 返回 undefined（订阅静默不生效）
  const offHotkey = window.gtools.on('command-hotkey', (p) => {
    const d = (p ?? {}) as { pluginId?: string; commandId?: string }
    if (typeof d.pluginId === 'string' && d.pluginId !== '') activateEntry(d.pluginId, d.commandId)
  })
  if (offHotkey) offFns.push(offHotkey)
  // 剪贴板即时链路：主窗直订宿主广播（通道刻意不进 sdk HOST_BROADCAST_EVENTS，插件面 host-client 订不到，
  // 此处只能走 shell 层 window.gtools.on）；detached 窗收不到该广播，判空与首帧探查对称；勿加 hidden 闸（插件态唤回会永久错过刷新）
  if (!isDetachedWindow.value) {
    const offClip = window.gtools.on('clipboard-history-changed', scheduleClipboardRecsRefresh)
    if (offClip) offFns.push(offClip)
  }
  // 浮窗/后台经 window.showMain 唤起主窗后的直达指令（与指令热键同址同语义，多带 query 预填）
  const offOpenPlugin = window.gtools.on('host:open-plugin', (p) => {
    const d = (p ?? {}) as { pluginId?: string; commandId?: string; query?: string }
    if (typeof d.pluginId === 'string' && d.pluginId !== '') activateEntry(d.pluginId, d.commandId, d.query)
  })
  if (offOpenPlugin) offFns.push(offOpenPlugin)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      // 隐私默认：推送与拖入集只在窗口可见会话内保留，隐藏即清（对齐 dropFiles 声明处注释）
      pushedItems.value = []
      releaseDrop()
      // 主搜索态隐藏即清场：再唤起首帧即空态、高度同步就位，不再「旧内容闪换+二次 resize」；
      // 插件/设置态不清（resetForShow 无 force 分支原样保留现场）
      resetForShow()
      return
    }
    // 唤起即 peek 不分模式：插件/设置态唤醒不读板的话，Esc 退回 global 空态后剪贴板推荐无源；
    // peek 内部已有 clipboardSuggest 开关与敏感过滤，隐私语义不变（单次读取、隐藏即清、仅存内存）。
    // detached 浮窗不渲染推荐 UI，读了白读，不扩大读取面
    if (!isDetachedWindow.value) void refreshClipboardRecs()
    if (router.mode === 'global') {
      // resetForShow 的推送清理点（router-core 不持有推送态，外壳侧同步清）
      pushedItems.value = []
      resetForShow()
      emptyIndex.value = 0
      searchBox.value?.focus()
      // 重新唤起时低成本刷新（宿主内存缓存命中即回），顺带收敛 TTL 过期与新装应用
      void loadApps()
      // 覆盖「拷入新 uTools 插件目录后重唤启动器」的词条刷新
      void loadUtoolsEntries()
      // 剪贴板探测：呼出即刷新「悬浮/保存成文件」「JSON 编辑器」动作行（仅全局态；插件态不打扰）
      refreshClipboardRecs()
    } else if (router.mode === 'plugin') {
      // 插件/设置态唤醒保留现场：焦点交回插件内容区首个输入控件
      pluginHost.value?.focusContent()
    } else {
      searchBox.value?.focus()
    }
  })
  window.addEventListener('keydown', onWindowKeydown)
  if (isDetachedWindow.value) return
  searchBox.value?.focus()
})

onBeforeUnmount(() => {
  if (calcCopyTimer !== undefined) clearTimeout(calcCopyTimer)
  if (clipboardRecTimer !== undefined) clearTimeout(clipboardRecTimer)
  window.removeEventListener('keydown', onWindowKeydown)
  document.removeEventListener('paste', onDocPaste)
  for (const off of pushOffs.values()) off()
  for (const off of offFns) off()
})
</script>

<template>
  <!-- 独立窗口：轻量宿主全屏承接插件视图，主窗外壳（空态/结果/设置）不渲染 -->
  <DetachedHost v-if="isDetachedWindow" :manifests="enabledManifests" />
  <!-- 剪贴板飞窗：主进程锚定窗口尺寸，卡片根满 #app padding-box，主窗外壳不渲染 -->
  <ClipboardFlyoutHost v-else-if="isFlyoutWindow" />
  <div v-else class="app" @dragover.prevent @drop.prevent="onDrop">
    <!-- 七彩环承载层：常驻挂载不加 v-if，显隐/几何/动画全交 themes.css 门控（防多模式双环）；
         段列与浮窗共享 rim-ring-segments，流动=段列沿环带路径空间位移（dashoffset 推进） -->
    <svg class="rim-ring" aria-hidden="true">
      <g class="g-rainbow">
        <rect
          v-for="(s, i) in RIM_SEGMENTS_RAINBOW"
          :key="`rb${i}`"
          pathLength="100"
          :style="{ stroke: s.color, strokeDashoffset: s.offset, animationDelay: s.delay }"
        />
      </g>
      <g class="g-gradient">
        <rect
          v-for="(s, i) in RIM_SEGMENTS_GRADIENT"
          :key="`gd${i}`"
          pathLength="100"
          :style="{ stroke: s.color, strokeDashoffset: s.offset, animationDelay: s.delay }"
        />
      </g>
    </svg>
    <header class="topbar">
      <SearchBox
        ref="searchBox"
        :manifests="enabledManifests"
        :paste-thumb="pasteThumb"
        @nav="onNav"
        @select="onEnter"
        @exit="onExitFromSearchBox"
        @settings="toggleSettings"
        @detach="detachActivePlugin"

        @image-paste="onImagePaste"
        @file-paste="onFilePaste"
        @clear-paste="clearPaste"
      />
    </header>
    <main class="content">
      <!-- 插件视图贴在顶栏正下方，退出/进入由顶栏胶囊与 Esc 承担 -->
      <PluginViewHost v-if="router.mode === 'plugin'" ref="pluginHost" :manifests="enabledManifests" @exit="onExitFromSearchBox" />
      <EmptyState
        v-else-if="router.mode === 'global' && router.query.trim() === ''"
          :plugins="enabledManifests"
          :recents="recentRows"
          :recent-tiles="recentTiles"
          :clipboard-recs="clipboardRecs"
          :apps="visibleApps"
          :apps-total="apps.length"
          :apps-expanded="appsExpanded"
          :pinned-ids="pinnedIds"
          :active-index="emptyIndex"
          :apps-mode="appsMode"
          :apps-loading="appsLoading"
          :app-error="appError"
          :op-error="opError"
          :demo="isDemo"
          @select="onEmptySelect"
          @hover="(i: number) => (emptyIndex = i)"
          @app-open="onAppOpen"
          @app-pin="onAppPin"
          @toggle-apps="toggleAppsExpanded"
          @resize="onContentResize"
          @refresh-apps="onRefreshApps"
          @retry-open="onRetryOpen"
        />
        <ResultList
          v-else-if="router.mode === 'global'"
          :items="visibleResults"
          :recommendations="recommendations"
          :active-index="activeIndex"
          :query="router.query"
          @select="onSelect"
          @hover="(i: number) => (activeIndex = i)"
          @resize="onContentResize"
        />
        <SettingsPage v-else :settings="settings" :plugins="plugins" />
      </main>
      <!-- 设置页保留底部快捷键提示与返回入口；全局搜索与空态均贴底收尾（对齐 uTools） -->
      <footer v-if="router.mode === 'settings'" class="footbar">
        <span class="hints">↑↓ 选择 · Enter 打开 · Esc 返回</span>
        <button
          class="settings-btn"
          :title="router.mode === 'settings' ? '返回主页' : '设置'"
          @click="toggleSettings"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              fill="currentColor"
              d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94 7.07 7.07 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.59.22L2.73 8.87a.5.5 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
            />
          </svg>
        </button>
      </footer>
      <!-- 插件态自绘拉伸手柄：透明窗 OS 拖缘在隐形外缘上抓不到，手柄贴可见面板右/下缘（pointer 增量→主进程改窗） -->
      <template v-if="router.mode === 'plugin'">
        <div class="rz rz-e" title="拖动调整宽度" @pointerdown="(e) => onRzDown(e, 'x')" />
        <div class="rz rz-s" title="拖动调整高度" @pointerdown="(e) => onRzDown(e, 'y')" />
        <div class="rz rz-se" title="拖动调整大小" @pointerdown="(e) => onRzDown(e, 'xy')" />
      </template>
      <!-- 计算器复制失败提示：失败不藏窗，结果留在结果区，回车即重试 -->
      <div v-if="calcCopyError" class="calc-copy-toast">复制失败：剪贴板可能被占用，按 Enter 重试</div>
  </div>
</template>

<style scoped>
.app {
  position: relative;
  height: 100vh;
  display: flex;
  flex-direction: column;

  /* 1px 边框本就存在（原 transparent）：glass 下上色成深勾边（--panel-edge），其余主题不变 */
  border: 1px solid var(--panel-edge, transparent);
  overflow: hidden;
  /* 全工程唯一投影，只挂窗口根（系统 DWM 影为主，此值为兜底轮廓）；
     --panel-halo = glass 白环外侧深勾边（其余主题 none），须挂面板自身——环伪元素的
     spread 影会被 overflow:hidden 裁剪 */
  box-shadow: var(--panel-halo, none), var(--window-ring, none), var(--shadow-window);
  /* 只铺 padding-box：受光边绝不能走 border-box 层——透明窗 shell 是半透明白，
     border-box 渐变会透过它漏满整窗，即终审实测的 75-80% 白纱；窗缘受光全部由
     --window-ring 的 inset shadow 承担（分主题定义）。上层 115deg sheen 高光随磨砂度渐显；
     纱罩+图片层插栈最前（自定义背景），同样全 padding-box */
  background:
    linear-gradient(rgb(var(--wp-veil) / var(--wp-dim)), rgb(var(--wp-veil) / var(--wp-dim))) padding-box,
    var(--wp-image) center / cover no-repeat padding-box,
    linear-gradient(115deg, rgba(255, 255, 255, var(--glass-sheen)), rgba(255, 255, 255, 0) 46%) padding-box,
    linear-gradient(var(--bg-shell), var(--bg-shell)) padding-box;
  /* 磨霜面（macOS 主霜源）：backdrop-filter 实时采样窗口背后桌面，与 --glass-filter 同变量——
     blur 开关/主题档位经 data-blur 联动（light/dark/glass 清透档均为 none）；win32 磨霜由窗口级
     亚克力担纲，此处在不透明窗上无页面底色可采、自然无效 */
  backdrop-filter: var(--glass-filter);
}
/* 厚玻璃壁：168deg 上亮→中透→下暗微亮的环带渐变，模拟厚玻璃切面；叶子伪元素自持 mask，
   不在玻璃面的祖先链上（同 .app::before 先例）；--glass-depth 惰性 0px 时 mask xor 无环带不可见 */
.app::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: var(--glass-depth);
  background: linear-gradient(
    168deg,
    rgba(255, 255, 255, 0.9),
    rgba(255, 255, 255, 0.14) 30%,
    rgba(148, 163, 184, 0.04) 55%,
    rgba(100, 116, 139, 0.16) 84%,
    rgba(255, 255, 255, 0.55)
  );
  -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0) border-box;
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0) border-box;
  mask-composite: exclude;
  pointer-events: none;
}
/* 插件态自绘拉伸手柄：贴可见面板右/下/右下缘（OS 拖缘在透明窗隐形外缘上抓不到）；
   z 取环层之上，其余模式不渲染 */
.rz {
  position: absolute;
  z-index: 210;
  pointer-events: auto;
  user-select: none;
}
.rz-e {
  top: 14px;
  bottom: 20px;
  right: 0;
  width: 7px;
  cursor: ew-resize;
}
.rz-s {
  left: 14px;
  right: 20px;
  bottom: 0;
  height: 7px;
  cursor: ns-resize;
}
.rz-se {
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
}
/* 圆角按窗口透明性分治（真实标志由 window.ts 经 html[data-wintx] 同步）：
   不透明窗内容满幅——darwin 圆角交系统弧裁剪；win32 建窗时已关 DWM 圆角（roundedCorners:false），轮廓环直角满边；
   透明窗仍靠 CSS 圆角透空四角。默认不画：同步未达时退化为 OS 弧，绝不露直角边 */
.app {
  border-radius: 0;
}
html[data-wintx='1'] .app {
  border-radius: var(--r-window);
  /* 透明窗：#app 有 32/32/48 透明边距（base.css），.app 只满 padding-box，外圈投影落进边距 */
  height: 100%;
}
/* win32 不透明窗（DWM 亚克力霜面 CSS 采不到）：feTurbulence 噪点自绘玻璃颗粒，叠 sheen 之上。
   blur-on 增补：切模糊触发 recreateSearchWindow 后 DWM 单活霜面槽烧毁不可复活，平灰态靠噪点兜底；
   须叠 data-transparency='on' 门——纯色档（enabled=false）可能残留 blur=true，实色观感零改动。
   栈序有意偏离常态栈「纱罩+图片插最前」的字面：噪点居首压在背景图上——颗粒属窗口玻璃材质，
   须浮于照片之上才不被整层盖死；启用自定义背景时纱罩/图片退居噪点之后 */
html[data-wintx='0'][data-theme='glass'] .app,
html[data-wintx='0'][data-transparency='on'][data-blur='on'] .app {
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E")
      padding-box,
    linear-gradient(rgb(var(--wp-veil) / var(--wp-dim)), rgb(var(--wp-veil) / var(--wp-dim))) padding-box,
    var(--wp-image) center / cover no-repeat padding-box,
    linear-gradient(115deg, rgba(255, 255, 255, var(--glass-sheen)), rgba(255, 255, 255, 0) 46%) padding-box,
    linear-gradient(var(--bg-shell), var(--bg-shell)) padding-box;
}
/* 导航层：搜索胶囊绝对定位浮于内容之上，内容滚入其下；z 两层只有 --z-nav / --z-content */
.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-nav);
  height: 64px;
  padding: 10px 10px 0;
  -webkit-app-region: drag; /* 顶栏拖动移动窗口，搜索框自身 no-drag */
}
/* 滚动边缘溶解（Clear 档窄条）：内容滚入胶囊下方时渐显的实时模糊带，静止即隐 */
.topbar::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 10px;
  right: 10px;
  z-index: -1;
  height: 26px;
  border-radius: 0 0 var(--r-pill) var(--r-pill);
  background: var(--strip-tint);
  /* mask 里 #000 只是 alpha 蒙版形状色，非 UI 颜色 */
  -webkit-mask-image: linear-gradient(to bottom, #000 30%, transparent);
  mask-image: linear-gradient(to bottom, #000 30%, transparent);
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}
.content {
  position: relative;
  z-index: var(--z-content);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
/* 内容滚动中（app.ts 已挂 is-scrolling）溶解条渐显，纯 CSS 跟随 */
.app:has(.empty-state.is-scrolling, .result-view.is-scrolling, .settings.is-scrolling, .plugin-body.is-scrolling) .topbar::after {
  opacity: 1;
}
/* 设置态底栏：--bg-content 厚背板压在内容上 + 顶部 hairline 分界，无投影 */
.footbar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: var(--z-nav);
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  padding: 0 var(--sp-2) 0 var(--sp-4);
  border-top: 1px solid var(--border);
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  background: var(--bg-content);
  backdrop-filter: var(--glass-filter);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
/* 底栏上缘溶解条：内容行滚入底栏下方时渐隐，不再被硬切（常显：裁切在静止态就存在） */
.footbar::before {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 100%;
  z-index: -1;
  height: 26px;
  border-radius: var(--r-xl) var(--r-xl) 0 0;
  background: var(--strip-tint);
  /* mask 里 #000 只是 alpha 蒙版形状色，非 UI 颜色 */
  -webkit-mask-image: linear-gradient(to top, #000 30%, transparent);
  mask-image: linear-gradient(to top, #000 30%, transparent);
  opacity: 1;
  pointer-events: none;
}
.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}
.settings-btn:hover {
  color: var(--fg);
  background: var(--hover);
}
/* 计算器复制失败 toast：极简样式对齐 image-bed .toast，配色走 --danger 两态 */
.calc-copy-toast {
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%);
  background: var(--danger-dim);
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 6px;
  padding: 5px 14px;
  font-size: 12px;
  pointer-events: none;
  z-index: 5;
}
</style>
