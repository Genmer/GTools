<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import type { AppSettings } from '@sdk/settings'
import type { HostInitResult } from '../env'
import { buildAppEntries, buildEntries } from '../core/entries'
import { matchEntryBest } from '../core/pinyin-index'
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

// 空态键盘导航的扁平目标：appsMode 时 = 最近行图标 + 可见应用（折叠切片）+ 抽屉开关格
type EmptyTarget =
  | { kind: 'plugin'; pluginId: string; commandId?: string }
  | { kind: 'app'; appId: string }
  | { kind: 'apps-toggle' }

// 最近使用属外壳 UI 状态（非插件数据），走 localStorage 不动设置与插件存储协议
const RECENT_KEY = 'gtools:recent-entries'
const APP_GRID_COLS = 9
// 常规窗口高度与主进程 WINDOW_H 对齐；空态高度由 EmptyState 实测内容上报（§1.5），不再用魔法数字
const WINDOW_NORMAL_H = 560

const plugins = ref<PluginState[]>([])
const settings = ref<AppSettings | null>(null)
const activeIndex = ref(0)
const emptyIndex = ref(0)
const searchBox = ref<InstanceType<typeof SearchBox> | null>(null)
const pluginHost = ref<InstanceType<typeof PluginViewHost> | null>(null)
const recentRecords = ref<RecentRecord[]>([])
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

const enabledManifests = computed(() => plugins.value.filter((p) => p.enabled).map((p) => p.manifest))
const pluginEntries = computed(() => buildEntries(plugins.value))
const appEntries = computed(() => buildAppEntries(apps.value))
const entries = computed(() => [...pluginEntries.value, ...appEntries.value])
const results = computed(() => {
  const q = router.query.trim()
  if (q === '') return entries.value.map((e) => ({ entry: e, score: 0 }))
  const scored: { entry: (typeof entries.value)[number]; score: number }[] = []
  for (const e of entries.value) {
    const s = matchEntryBest(q, e)
    if (s !== null) scored.push({ entry: e, score: s })
  }
  return scored.sort((a, b) => a.score - b.score)
})
const visibleResults = computed(() => results.value.slice(0, 50))

const recentRows = computed<RecentRow[]>(() => {
  const rows: RecentRow[] = []
  for (const r of recentRecords.value) {
    if (r.kind === 'app') continue
    const m = enabledManifests.value.find((x) => x.id === r.pluginId)
    if (!m) continue // 插件已禁用/卸载则不展示
    const cmd = (m.commands ?? []).find((c) => c.id === r.commandId)
    rows.push({
      key: `${r.pluginId}:${r.commandId ?? '_main'}`,
      title: cmd ? cmd.title : m.name,
      subtitle: cmd ? m.name : (m.description ?? ''),
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

const emptyTargets = computed<EmptyTarget[]>(() => {
  if (appsMode.value) {
    const targets: EmptyTarget[] = [
      ...recentTiles.value.map((t) =>
        t.kind === 'app' ? { kind: 'app' as const, appId: t.appId! } : { kind: 'plugin' as const, pluginId: t.pluginId!, commandId: t.commandId }
      ),
      ...visibleApps.value.map((a) => ({ kind: 'app' as const, appId: a.id }))
    ]
    if (hasAppsToggle.value) targets.push({ kind: 'apps-toggle' })
    return targets
  }
  return [
    ...enabledManifests.value.map((m) => ({ kind: 'plugin' as const, pluginId: m.id })),
    ...recentRows.value.map((r) => ({ kind: 'plugin' as const, pluginId: r.pluginId, commandId: r.commandId }))
  ]
})

const emptyVisible = computed(() => router.mode === 'global' && router.query.trim() === '')

watch(
  () => router.query,
  () => {
    syncMode(enabledManifests.value)
    activeIndex.value = 0
    emptyIndex.value = 0
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
    if (router.mode !== 'global') return WINDOW_NORMAL_H
    if (measuredH.value <= 0) return WINDOW_NORMAL_H
    return measuredH.value
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

async function openAppById(appId: string): Promise<void> {
  const a = apps.value.find((x) => x.id === appId)
  if (!a) return
  if (isDemo.value) {
    opError.value = { id: '', name: a.name, error: `「${a.name}」为示例应用，不可打开` }
    return
  }
  const r = await window.gtools.host('apps:open', { path: a.path })
  if (!r.ok) {
    opError.value = { id: a.id, name: a.name, error: `打开「${a.name}」失败：${r.error ?? '未知错误'}` }
    return
  }
  opError.value = null
  pushRecentApp(a.id)
  router.query = ''
  void window.gtools.host('window:hide')
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

function activateEntry(pluginId: string, commandId?: string): void {
  if (isSettingsEntry(pluginId)) {
    enterSettings()
    void nextTick(() => searchBox.value?.focus())
    return
  }
  enterPlugin(pluginId, enabledManifests.value, commandId)
  // trigger 型带 backend 的插件（如 app-launcher）在首次进入时启动
  void window.gtools.host('plugin:enter', { id: pluginId })
  pushRecentPlugin(pluginId, commandId)
}

function activateEmptyTarget(t: EmptyTarget): void {
  if (t.kind === 'app') void openAppById(t.appId)
  else if (t.kind === 'apps-toggle') toggleAppsExpanded()
  else activateEntry(t.pluginId, t.commandId)
}

// appsMode 键盘导航：扁平序 = 最近行（1×N）→ 可见应用网格（9 列）→ 抽屉开关格；横向循环，纵向按列对齐跨行/进最近行，边界停住
function navEmptyGrid(dir: 1 | -1, axis: 'x' | 'y'): void {
  const R = recentTiles.value.length
  const A = visibleApps.value.length + (hasAppsToggle.value ? 1 : 0)
  const n = R + A
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
    // 兜底网格区上下按列距 4 跨行，其余步长 1；整体循环导航
    const step = axis === 'y' && emptyIndex.value < enabledManifests.value.length ? 4 : 1
    emptyIndex.value = (emptyIndex.value + dir * step + n) % n
    return
  }
  const n = visibleResults.value.length
  if (n === 0) return
  if (axis === 'x') {
    activeIndex.value = (activeIndex.value + dir + n) % n
  } else {
    const next = activeIndex.value + dir * APP_GRID_COLS
    if (next >= 0 && next < n) {
      activeIndex.value = next
    } else if (dir === 1 && activeIndex.value < n - 1) {
      activeIndex.value = n - 1
    } else if (dir === -1 && activeIndex.value > 0) {
      activeIndex.value = 0
    }
  }
}

function onSelect(index: number): void {
  const item = visibleResults.value[index]
  if (!item) return
  if (item.entry.kind === 'app' && item.entry.appId) {
    void openAppById(item.entry.appId)
  } else if (item.entry.pluginId) {
    activateEntry(item.entry.pluginId, item.entry.commandId)
  }
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

onMounted(async () => {
  loadRecent()
  const r = await window.gtools.host('app:init')
  if (r.ok) {
    const init = r.data as HostInitResult
    plugins.value = init.plugins
    settings.value = init.settings
    document.documentElement.dataset.theme = init.settings.theme
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
  }
  window.gtools.on('settings-changed', (p) => {
    settings.value = p as AppSettings
    document.documentElement.dataset.theme = (p as AppSettings).theme
  })
  window.gtools.on('plugin-state-changed', (p) => {
    const d = p as { id: string; enabled: boolean; plugins: PluginState[] }
    plugins.value = d.plugins
  })
  window.gtools.on('host:open-settings', () => {
    enterSettings()
    void nextTick(() => searchBox.value?.focus())
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (router.mode === 'global') {
      resetForShow()
      emptyIndex.value = 0
      searchBox.value?.focus()
      // 重新唤起时低成本刷新（宿主内存缓存命中即回），顺带收敛 TTL 过期与新装应用
      void loadApps()
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
})
</script>

<template>
  <!-- 独立窗口：轻量宿主全屏承接插件视图，主窗外壳（空态/结果/设置）不渲染 -->
  <DetachedHost v-if="isDetachedWindow" :manifests="enabledManifests" />
  <div v-else class="app">
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
  height: 100vh;
  display: flex;
  flex-direction: column;
  border-radius: var(--r-lg);
  overflow: hidden;
  background: var(--bg-raised); /* 外壳统一取 raised 底色（对齐 uTools 全窗统一软灰），无白边/白框 */
}
.topbar {
  flex: none;
  height: 64px;
  padding: 12px 16px 0;
  -webkit-app-region: drag; /* 顶栏拖动移动窗口，搜索框自身 no-drag */
}
.content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.footbar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  padding: 0 var(--sp-2) 0 var(--sp-4);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
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
