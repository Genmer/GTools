<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import type { AppSettings } from '@sdk/settings'
import type { HostInitResult } from '../env'
import { buildAppEntries, buildEntries } from '../core/entries'
import { calc } from '../core/calc'
import { matchEntryBest } from '../core/pinyin-index'
import type { SearchEntry } from '../core/matcher'
import { buildUtoolsEntries, UTOOLS_PLUGIN_ID, type UtoolsEntryScan } from '../core/utools-entries'
import { buildRecommendations, fileMatcherHits, type MatchFile, type RecItem } from '../core/recommend'
import { isSensitiveText } from '../core/sensitive'
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
import { parseQueryHistory, pushQueryHistory } from './query-history'
import SearchBox from './SearchBox.vue'
import ResultList from './ResultList.vue'
import EmptyState from './EmptyState.vue'
import PluginViewHost from './PluginViewHost.vue'
import DetachedHost from './DetachedHost.vue'
import SettingsPage from './SettingsPage.vue'

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
// 搜索历史同理走 localStorage（外壳 UI 状态不新开 IPC）
const HISTORY_KEY = 'gtools:query-history'
const APP_GRID_COLS = 9
// 全局态兜底窗口高度（内容口径，与主进程 CONTENT_H 对齐）；空态高度由 EmptyState 实测内容上报（§1.5）
const WINDOW_NORMAL_H = 560
// 透明窗（data-wintx=1）下 #app 有 32+48 透明边距：报高按内容口径扣掉，主进程 window.ts 负责加回
const WIN_TX_MARGIN = 80

const plugins = ref<PluginState[]>([])
const settings = ref<AppSettings | null>(null)
const activeIndex = ref(0)
const emptyIndex = ref(0)
const searchBox = ref<InstanceType<typeof SearchBox> | null>(null)
const pluginHost = ref<InstanceType<typeof PluginViewHost> | null>(null)
const recentRecords = ref<RecentRecord[]>([])
const queryHistory = ref<string[]>([])
// 独立窗口分流：#detached=true 深链时只渲染轻量宿主，不渲染主窗外壳
const isDetachedWindow = ref(false)

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

// 剪贴板推荐（C2）：每次唤起单次 peek，无轮询不订阅剪贴板变化；仅存内存，主进程不落盘不缓存。
// clipboardSuggest 由设置链路（sdk/settings.ts）提供，这里宽松读取保持两侧改动解耦，缺省视为开
const clipboardText = ref('')
const clipboardSuggestOn = computed(
  () => (settings.value as (AppSettings & { clipboardSuggest?: boolean }) | null)?.clipboardSuggest !== false
)

// 拖入集（文件/图片推荐源）与常驻插件推送行；两者都只存内存，激活/清空输入/窗口隐藏时释放
const dropFiles = ref<MatchFile[]>([])
const hasDropImage = ref(false)
const pushedItems = ref<PushedItem[]>([])

function releaseDrop(): void {
  dropFiles.value = []
  hasDropImage.value = false
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
    const p = (w.payload ?? {}) as Partial<PushedItem>
    // pluginId 以通道归属为准（channel 已限定插件），不信任 payload 自带值
    pushedItems.value = mergePushedItems(
      pushedItems.value,
      [
        {
          pluginId: m.id,
          commandId: p.commandId,
          title: p.title ?? m.name,
          subtitle: p.subtitle ?? '',
          icon: p.icon ?? m.icon,
          payloadText: p.payloadText
        }
      ],
      enabledManifests.value
    )
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

function dedupeRecs(items: RecItem[]): RecItem[] {
  const seen = new Set<string>()
  const out: RecItem[] = []
  for (const it of items) {
    if (seen.has(it.key)) continue
    seen.add(it.key)
    out.push(it)
  }
  return out
}

const clipboardRecs = computed(() =>
  dedupeRecs([
    ...pushedRecs.value,
    ...buildRecommendations({ query: '', clipboardText: clipboardText.value, manifests: enabledManifests.value, enabled: clipboardSuggestOn.value }),
    // 空 query 下 buildRecommendations 不产出 files/img（只认剪贴板 json），空态拖入行直调 fileMatcherHits 补上
    ...fileMatcherHits(dropFiles.value, enabledManifests.value, hasDropImage.value)
  ])
)
const resultKeys = computed(() => new Set(visibleResults.value.map((i) => i.entry.key)))
// query 态推荐区（ResultList 推荐段）；空 query 恒空（空态推荐落 EmptyState 顶部行）
const recommendations = computed(() =>
  router.query.trim() === ''
    ? []
    : dedupeRecs([
        ...pushedRecs.value,
        ...buildRecommendations({
          query: router.query,
          entries: entries.value,
          resultKeys: resultKeys.value,
          manifests: enabledManifests.value,
          clipboardText: clipboardText.value,
          files: dropFiles.value,
          hasImage: hasDropImage.value
        })
      ])
)

// 剪贴板推荐前置（C2-5a）：两分支均占扁平序最前 K 位；搜索历史 chips 为第二段；
// 拖入行（files/img 源）激活时把拖入集经 initialPayload 通道带给插件
const emptyInput = computed<EmptyTargetsInput>(() =>
  appsMode.value
    ? {
        appsMode: true,
        clipRecs: clipboardRecs.value,
        dropFiles: dropFiles.value,
        history: queryHistory.value,
        recentTiles: recentTiles.value,
        appIds: visibleApps.value.map((a) => a.id),
        hasAppsToggle: hasAppsToggle.value
      }
    : {
        appsMode: false,
        clipRecs: clipboardRecs.value,
        dropFiles: dropFiles.value,
        history: queryHistory.value,
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
watch(
  () => emptyTargets.value.length,
  (n) => {
    if (emptyIndex.value >= n) emptyIndex.value = 0
  }
)

// 窗口高度自适应（§1.5）：空态与搜索结果均由内容实测自然高度决定，超限由主进程夹紧
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
    if (router.mode !== 'global') return WINDOW_NORMAL_H // 已是内容口径，主进程负责加边距
    if (measuredH.value <= 0) return WINDOW_NORMAL_H
    // 实测值含透明窗边距（视口坐标），按内容口径扣掉
    return document.documentElement.dataset.wintx === '1' ? measuredH.value - WIN_TX_MARGIN : measuredH.value
  },
  (h) => {
    if (h === lastSentHeight) return
    lastSentHeight = h
    void window.gtools.host('window:set-height', { height: h })
  },
  // immediate：热重载/挂载即对齐一次窗口高度，否则停留在旧高度（如 560）显得下方留白过大
  { immediate: true }
)

async function loadApps(force = false): Promise<void> {
  if (isDemo.value) return
  const id = ++appsRequestId
  appsLoading.value = true
  appError.value = null
  const r = await window.gtools.host('apps:list', force ? { refresh: true } : undefined)
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

// 剪贴板单次读取（C2-1）：仅设置开启时进行，读完仅存内存 ref；隐藏窗口不读、无轮询、不订阅变化
async function peekClipboard(): Promise<void> {
  if (!clipboardSuggestOn.value) return
  const r = await window.gtools.host('clipboard:peek')
  if (r.ok && typeof r.data === 'string') {
    clipboardText.value = isSensitiveText(r.data) ? '' : r.data
  }
}

// uTools 插件扫描→词条：失败/空静默置 []（utools-port 未装插件属常态，不弹错）
async function loadUtoolsEntries(): Promise<void> {
  const r = await window.gtools.host('utools:list')
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
  void window.gtools.host('window:hide')
  const r = await window.gtools.host('apps:open', { path: a.path })
  if (!r.ok) {
    // 打开失败把窗口带回来当面报错，否则用户只觉得没反应
    void window.gtools.host('window:show')
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
  const r = await window.gtools.host(pinnedNow ? 'apps:unpin' : 'apps:pin', { id: appId })
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

function activateEntry(pluginId: string, commandId?: string, rest?: string, payload?: MatchFile[]): void {
  // 拖入集生命周期到激活为止；先进入（enterPlugin 已持有数组引用）再释放 ref
  if (isSettingsEntry(pluginId)) {
    releaseDrop()
    enterSettings()
    void nextTick(() => searchBox.value?.focus())
    return
  }
  // rest 为推荐命中文本（超限已被 recommend 层剥离），经既有 "kw rest" 通路进插件 query；
  // payload 为拖入文件列表，走 initialPayload 通道
  enterPlugin(pluginId, enabledManifests.value, commandId, rest ?? '', payload)
  // trigger 型带 backend 的插件（如 app-launcher）在首次进入时启动
  void window.gtools.host('plugin:enter', { id: pluginId })
  pushRecentPlugin(pluginId, commandId)
  releaseDrop()
}

function activateEmptyTarget(t: EmptyTarget): void {
  if (t.kind === 'app') void openAppById(t.appId)
  else if (t.kind === 'apps-toggle') toggleAppsExpanded()
  else if (t.kind === 'history') onHistorySelect(t.query)
  else activateEntry(t.pluginId, t.commandId, t.payload, t.files)
}

// appsMode 键盘导航：扁平序 = 剪贴板推荐行 + 搜索历史 chips + 最近行（三段合并为一个 1×N 前缀）→ 可见应用网格（9 列）→ 抽屉开关格；
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
    // 兜底网格区上下按列距 4 跨行，其余步长 1；整体循环导航（插件中段 [histEnd, middleEnd) y 步长 4）
    const off = emptySegmentOffsets(emptyInput.value)
    const step = axis === 'y' && emptyIndex.value >= off.histEnd && emptyIndex.value < off.middleEnd ? 4 : 1
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

function onSelect(index: number): void {
  if (index >= visibleResults.value.length) {
    const rec = recommendations.value[index - visibleResults.value.length]
    if (rec) activateRec(rec)
    return
  }
  const item = visibleResults.value[index]
  if (!item) return
  // 计算器词条：展示与激活同源（按当前 query 现算），复制结果文本后隐藏窗口
  if (item.entry.key === 'host:calc') {
    const result = calc(router.query.trim())
    if (result !== null) void navigator.clipboard.writeText(result)
    void window.gtools.host('window:hide')
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
  // matcher 命中型带命中文本进插件既有 query 通路；keyword 沾边型无 payload 只进入；
  // 拖入行（files/img 源）把拖入集经 initialPayload 通道带给插件
  activateEntry(
    rec.pluginId,
    rec.commandId,
    rec.payload,
    rec.source === 'files' || rec.source === 'img' ? dropFiles.value : undefined
  )
}

function onEnter(): void {
  if (router.query.trim() === '') {
    const t = emptyTargets.value[emptyIndex.value]
    if (t) activateEmptyTarget(t)
    return
  }
  recordHistory(router.query.trim())
  onSelect(activeIndex.value)
}

// ---- 搜索历史（localStorage，外壳 UI 状态）----

function loadHistory(): void {
  queryHistory.value = parseQueryHistory(localStorage.getItem(HISTORY_KEY))
}

function persistHistory(): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(queryHistory.value))
  } catch {
    // 存不进去只影响下次启动的历史 chips，静默降级
  }
}

function recordHistory(q: string): void {
  queryHistory.value = pushQueryHistory(queryHistory.value, q)
  persistHistory()
}

// chip 点击回填：keyword 后必须跟空格才进插件态（router-core），裸词恒留 global 出结果
function onHistorySelect(q: string): void {
  router.query = q
  void nextTick(() => searchBox.value?.focus())
}

function onHistoryRemove(q: string): void {
  queryHistory.value = queryHistory.value.filter((x) => x !== q)
  persistHistory()
}

function onHistoryClear(): void {
  queryHistory.value = []
  persistHistory()
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
  void window.gtools.host('window:detach-plugin', { id: router.activePluginId, query: q })
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
  if (isDetachedWindow.value) return
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
    if (isDetachedWindow.value) return
    if (mode === 'plugin' && prev !== 'plugin') {
      void window.gtools.host('window:set-resizable', { resizable: true, minWidth: 520, minHeight: 360 })
    } else if (mode !== 'plugin' && prev === 'plugin') {
      void window.gtools.host('window:set-resizable', { resizable: false })
    }
  }
)

function applyVisualSettings(s: AppSettings): void {
  document.documentElement.dataset.theme = s.theme
  // 玻璃主题自身即玻璃面板，透明属性强制开启（透明度滑杆仍调节玻璃密度）
  document.documentElement.dataset.transparency = s.transparency.enabled || s.theme === 'glass' ? 'on' : 'off'
  document.documentElement.dataset.blur = s.transparency.blur ? 'on' : 'off'
  document.documentElement.style.setProperty('--tx', (s.transparency.opacity / 100).toFixed(2))
  // (1-tx)³ 感知曲线：玻璃主题专用——滑杆低段陡增保证 0 档够白可读，高段维持清玻璃
  document.documentElement.style.setProperty('--txp', Math.pow(1 - s.transparency.opacity / 100, 3).toFixed(4))
  // 霜曲线：(1-t)^0.9 幂次 CSS calc 表达不了，JS 算好注入（themes.css 玻璃块 blur 消费）
  document.documentElement.style.setProperty('--txf', Math.pow(1 - s.transparency.opacity / 100, 0.9).toFixed(4))
}



onMounted(async () => {
  loadRecent()
  loadHistory()
  const r = await window.gtools.host('app:init')
  if (r.ok) {
    const init = r.data as HostInitResult
    plugins.value = init.plugins
    settings.value = init.settings
    applyVisualSettings(init.settings)
    // 深度链接初始化（#plugin=<id>&q=… / #demo=1 / 独立窗口 #detached=true&plugin=…&query=…），仅启动时生效
    const link = parseDeepLink(location.hash)
    if (link?.isDetached) isDetachedWindow.value = true
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
      if (ok) void window.gtools.host('plugin:enter', { id: link.pluginId })
    }
    if (!isDemo.value && !isDetachedWindow.value) void loadApps()
    void loadUtoolsEntries()
  }
  window.gtools.on('settings-changed', (p) => {
    settings.value = p as AppSettings
    applyVisualSettings(p as AppSettings)
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      // 隐私默认：推送与拖入集只在窗口可见会话内保留，隐藏即清（对齐 dropFiles 声明处注释）
      pushedItems.value = []
      clipboardText.value = ''
      releaseDrop()
      return
    }
    if (router.mode === 'global') {
      // resetForShow 的推送清理点（router-core 不持有推送态，外壳侧同步清）
      pushedItems.value = []
      resetForShow()
      emptyIndex.value = 0
      searchBox.value?.focus()
      // 重新唤起时低成本刷新（宿主内存缓存命中即回），顺带收敛 TTL 过期与新装应用
      void loadApps()
      void peekClipboard()
      // 覆盖「拷入新 uTools 插件目录后重唤启动器」的词条刷新
      void loadUtoolsEntries()
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
  window.removeEventListener('keydown', onWindowKeydown)
  for (const off of pushOffs.values()) off()
  for (const off of offFns) off()
})
</script>

<template>
  <!-- 独立窗口：轻量宿主全屏承接插件视图，主窗外壳（空态/结果/设置）不渲染 -->
  <DetachedHost v-if="isDetachedWindow" :manifests="enabledManifests" />
  <div v-else class="app" @dragover.prevent @drop.prevent="onDrop">
    <header class="topbar">
      <SearchBox
        ref="searchBox"
        :manifests="enabledManifests"
        @nav="onNav"
        @select="onEnter"
        @exit="onExitFromSearchBox"
        @settings="toggleSettings"
        @detach="detachActivePlugin"
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
          :query-history="queryHistory"
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
          @history-select="onHistorySelect"
          @history-remove="onHistoryRemove"
          @history-clear="onHistoryClear"
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
  </div>
</template>

<style scoped>
.app {
  position: relative;
  height: 100vh;
  display: flex;
  flex-direction: column;
  border: 1px solid transparent;
  overflow: hidden;
  /* 全工程唯一投影，只挂窗口根（系统 DWM 影为主，此值为兜底轮廓） */
  box-shadow: var(--window-ring, none), var(--shadow-window);
  /* 只铺 padding-box：受光边绝不能走 border-box 层——透明窗 shell 是半透明白，
     border-box 渐变会透过它漏满整窗，即终审实测的 75-80% 白纱；窗缘受光全部由
     --window-ring 的 inset shadow 承担（分主题定义）。上层 115deg sheen 高光随磨砂度渐显 */
  background:
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
/* 圆角按窗口透明性分治（真实标志由 window.ts 经 html[data-wintx] 同步）：
   不透明窗（亚克力/实色）内容满幅、圆角交 OS 裁剪（Win11 DWM/macOS 系统弧）——
   CSS 再画弧会与 OS 弧夹出露底色的环带，即「圆角主体+直角边」穿帮根因；
   透明窗靠 CSS 圆角透空四角。默认不画：同步未达时退化为 OS 弧，绝不露直角边 */
.app {
  border-radius: 0;
}
html[data-wintx='1'] .app {
  border-radius: var(--r-window);
  /* 透明窗：#app 有 32/32/48 透明边距（base.css），.app 只满 padding-box，外圈投影落进边距 */
  height: 100%;
}
/* win32 不透明窗（DWM 亚克力霜面 CSS 采不到）：feTurbulence 噪点自绘玻璃颗粒，叠 sheen 之上 */
html[data-wintx='0'][data-theme='glass'] .app {
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E")
      padding-box,
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
  backdrop-filter: var(--strip-filter);
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
  backdrop-filter: var(--strip-filter);
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
</style>
