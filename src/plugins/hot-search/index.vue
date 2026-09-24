<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import { filterItems } from './logic/filter'
import { refreshAllBoards } from './logic/board'
import { demoBoards } from './logic/demo'
import { HOT_SOURCES } from './logic/sources'
import {
  AUTO_REFRESH_OPTIONS,
  DEFAULT_SETTINGS,
  normalizeSettings,
  parseCache,
  toCache,
  type BoardData,
  type HotItem,
  type HotSearchSettings
} from './logic/types'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

// demo 态（initialCommand === 'demo'）：稳定示例榜单、零网络请求、不读写本地存储（截图/新手引导用）
const isDemo = computed(() => props.initialCommand === 'demo')

interface BoardState {
  items: HotItem[]
  fetchedAt: number | null
  error: string
  loading: boolean
}

const CACHE_KEY = 'cache'
const SETTINGS_KEY = 'settings'
/** 挂载时缓存的容忍年龄：超过即自动刷新（秒级新鲜度对热搜没意义） */
const STALE_MS = 2 * 60_000
const MAX_VISIBLE = 60

function emptyBoards(): Record<string, BoardState> {
  const out: Record<string, BoardState> = {}
  for (const s of HOT_SOURCES) out[s.id] = { items: [], fetchedAt: null, error: '', loading: false }
  return out
}

const boards = ref<Record<string, BoardState>>(emptyBoards())
const activeId = ref<string>(HOT_SOURCES[0].id)
const settings = ref<HotSearchSettings>(normalizeSettings(null))
const settingsOpen = ref(false)
const newKeyword = ref('')
const selected = ref(0)
const refreshing = ref(false)
const openError = ref('')
const listRef = ref<HTMLElement | null>(null)

let autoTimer: ReturnType<typeof setInterval> | null = null
let refreshSeq = 0

const activeBoard = computed(() => boards.value[activeId.value])
const visible = computed(() => {
  const items = activeBoard.value?.items ?? []
  return filterItems(items, { query: props.query, watchOnly: settings.value.watchOnly, watchKeywords: settings.value.watchKeywords }).slice(0, MAX_VISIBLE)
})

const statusText = computed(() => {
  const b = activeBoard.value
  if (b === undefined) return ''
  if (b.items.length === 0 && b.loading) return '正在获取榜单…'
  if (b.error !== '') return `上次刷新失败：${b.error}（展示的是更早的数据）`
  if (b.fetchedAt !== null) return `更新于 ${new Date(b.fetchedAt).toLocaleTimeString()}`
  return b.loading ? '正在获取榜单…' : '暂无数据，点击「刷新」获取'
})

const emptyText = computed(() => {
  const b = activeBoard.value
  if (b === undefined) return ''
  if (b.items.length === 0) return b.error !== '' ? '获取失败，请检查网络后点击「刷新」重试' : '暂无数据'
  if (props.query.trim() !== '') return `没有标题含「${props.query.trim()}」的热搜`
  if (settings.value.watchOnly && settings.value.watchKeywords.length > 0) return '关注词暂无匹配（可关闭「只看关注」查看全部）'
  return '没有匹配条目'
})

function formatHeat(v: number): string {
  if (v >= 100_000_000) return `${(v / 100_000_000).toFixed(1).replace(/\.0$/, '')}亿`
  if (v >= 10_000) return `${(v / 10_000).toFixed(1).replace(/\.0$/, '')}万`
  return String(v)
}

function snapshotForRefresh(): Record<string, BoardData> {
  const out: Record<string, BoardData> = {}
  for (const s of HOT_SOURCES) {
    const b = boards.value[s.id]
    if (b !== undefined && b.items.length > 0) out[s.id] = { fetchedAt: b.fetchedAt ?? 0, items: b.items }
  }
  return out
}

async function persistCache(): Promise<void> {
  if (isDemo.value) return
  try {
    const data: Record<string, BoardData> = {}
    for (const s of HOT_SOURCES) {
      const b = boards.value[s.id]
      if (b !== undefined && b.items.length > 0) data[s.id] = { fetchedAt: b.fetchedAt ?? 0, items: b.items }
    }
    if (Object.keys(data).length > 0) await props.ctx.host.storage.set(CACHE_KEY, toCache(data))
  } catch {
    // 缓存写失败不影响本次展示，下次刷新重写
  }
}

async function refresh(): Promise<void> {
  if (isDemo.value) return // demo 态没有真实数据源，刷新按钮保持展示不触发网络
  if (refreshing.value) return
  refreshing.value = true
  const seq = ++refreshSeq
  for (const s of HOT_SOURCES) boards.value[s.id].loading = true
  const outcomes = await refreshAllBoards(
    (url, init) => props.ctx.host.net.fetch(url, init),
    HOT_SOURCES,
    snapshotForRefresh()
  )
  if (seq !== refreshSeq) return // 组件即将卸载，不再落状态
  for (const o of outcomes) {
    const b = boards.value[o.sourceId]
    if (b === undefined) continue
    b.loading = false
    if (o.ok && o.data !== undefined) {
      b.items = o.data.items
      b.fetchedAt = o.data.fetchedAt
      b.error = ''
    } else {
      // 失败保留旧榜单，错误提示放状态栏，不让单平台故障清空屏幕
      b.error = o.error ?? '未知错误'
    }
  }
  refreshing.value = false
  selected.value = 0
  await persistCache()
}

async function persistSettings(): Promise<void> {
  if (isDemo.value) return
  try {
    await props.ctx.host.storage.set(SETTINGS_KEY, settings.value)
  } catch {
    // 写失败静默：设置下次改动重写
  }
}

function scheduleAuto(): void {
  if (autoTimer !== null) {
    clearInterval(autoTimer)
    autoTimer = null
  }
  const min = settings.value.autoRefreshMin
  if (min > 0) autoTimer = setInterval(() => void refresh(), min * 60_000)
}

watch(
  () => settings.value.autoRefreshMin,
  () => scheduleAuto()
)

watch(
  settings,
  () => void persistSettings(),
  { deep: true }
)

watch(
  () => props.query,
  () => {
    selected.value = 0
  }
)

watch(activeId, () => {
  selected.value = 0
})

watch(selected, async () => {
  await nextTick()
  listRef.value?.querySelector(`[data-i="${selected.value}"]`)?.scrollIntoView({ block: 'nearest' })
})

function onKeywordEnter(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter 只上屏
  addKeyword()
}

function addKeyword(): void {
  const k = newKeyword.value.trim()
  if (k === '') return
  if (settings.value.watchKeywords.some((x) => x.toLowerCase() === k.toLowerCase())) {
    newKeyword.value = ''
    return
  }
  settings.value.watchKeywords = [...settings.value.watchKeywords, k].slice(0, 50)
  newKeyword.value = ''
}

function removeKeyword(k: string): void {
  settings.value.watchKeywords = settings.value.watchKeywords.filter((x) => x !== k)
}

async function open(item: HotItem): Promise<void> {
  openError.value = ''
  if (isDemo.value) {
    // 示例 url 为占位链，不真开浏览器（manifest 也没有 notification 权限，借状态栏提示）
    openError.value = `示例条目「${item.title}」：演示模式仅展示样式`
    return
  }
  try {
    // 打开后浏览器抢焦点，搜索窗失焦自动隐藏（uTools 同款交互），无需手动 hide
    await props.ctx.host.shell.openExternal(item.url)
  } catch (err) {
    openError.value = `打开失败：${err instanceof Error ? err.message : String(err)}`
  }
}

function move(dir: 1 | -1): void {
  const count = visible.value.length
  if (count === 0) return
  selected.value = (selected.value + dir + count) % count
}

// 插件模式下外壳 SearchBox 不转发按键，列表导航由插件自治监听（与 launcher 同款）
function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return
  if (e.key === 'Enter') {
    e.preventDefault()
    const item = visible.value[selected.value]
    if (item) void open(item)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'F5') {
    e.preventDefault()
    void refresh()
  }
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  if (isDemo.value) {
    // demo 态：填充全部平台示例榜单，不读缓存/设置、不发网络请求、不排自动刷新
    for (const [id, b] of Object.entries(demoBoards(Date.now()))) {
      const state = boards.value[id]
      if (state !== undefined) {
        state.items = b.items
        state.fetchedAt = b.fetchedAt
      }
    }
    return
  }
  try {
    const cached = parseCache(await props.ctx.host.storage.get(CACHE_KEY))
    if (cached !== null) {
      for (const [id, b] of Object.entries(cached.boards)) {
        const state = boards.value[id]
        if (state !== undefined) {
          state.items = b.items
          state.fetchedAt = b.fetchedAt
        }
      }
    }
  } catch {
    // 缓存读失败按首开处理
  }
  try {
    settings.value = normalizeSettings(await props.ctx.host.storage.get(SETTINGS_KEY))
  } catch {
    settings.value = normalizeSettings(DEFAULT_SETTINGS)
  }
  scheduleAuto()
  const b = boards.value[activeId.value]
  const stale = b === undefined || b.fetchedAt === null || Date.now() - b.fetchedAt > STALE_MS
  if (stale) void refresh()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  if (autoTimer !== null) {
    clearInterval(autoTimer)
    autoTimer = null
  }
  refreshSeq++
})
</script>

<template>
  <div class="hot-search">
    <div v-if="isDemo" class="demo-banner">示例数据 · 演示模式（不发真实请求）</div>
    <div class="bar">
      <div class="tabs">
        <button
          v-for="s in HOT_SOURCES"
          :key="s.id"
          class="tab"
          :class="{ active: activeId === s.id }"
          :title="boards[s.id]?.error !== '' ? boards[s.id].error : s.name"
          @click="activeId = s.id"
        >
          <span>{{ s.icon }} {{ s.name }}</span>
          <span v-if="boards[s.id]?.error !== ''" class="warn">!</span>
        </button>
      </div>
      <div class="tools">
        <button class="btn" :class="{ active: settings.watchOnly }" @click="settings.watchOnly = !settings.watchOnly">只看关注</button>
        <button class="btn" :class="{ active: settingsOpen }" @click="settingsOpen = !settingsOpen">关注词</button>
        <select v-model.number="settings.autoRefreshMin" class="btn select" title="自动刷新间隔">
          <option v-for="m in AUTO_REFRESH_OPTIONS" :key="m" :value="m">{{ m === 0 ? '不自动' : `${m} 分钟` }}</option>
        </select>
        <button class="btn primary" :disabled="refreshing" @click="refresh()">{{ refreshing ? '刷新中…' : '刷新' }}</button>
      </div>
    </div>

    <div v-if="settingsOpen" class="watch-panel">
      <div class="chips">
        <span v-for="k in settings.watchKeywords" :key="k" class="chip">
          {{ k }}
          <button class="chip-x" :title="`删除 ${k}`" @click="removeKeyword(k)">×</button>
        </span>
        <span v-if="settings.watchKeywords.length === 0" class="muted">尚未添加关注词</span>
      </div>
      <input
        v-model="newKeyword"
        class="kw-input"
        placeholder="输入关注关键词后回车添加，如：iPhone / 乒乓 / 哪吒"
        @keydown.enter.prevent="onKeywordEnter"
      />
      <p class="muted tip">开启「只看关注」后，六个平台只显示标题命中关注词的条目；输入框的剩余输入也可直接过滤当前榜单。</p>
    </div>

    <div class="status">
      <span class="status-main" :class="{ err: activeBoard?.error !== '' && activeBoard?.error !== undefined }">{{ statusText }}</span>
      <span v-if="openError !== ''" class="err">{{ openError }}</span>
      <span class="spacer"></span>
      <span v-if="visible.length > 0" class="muted">{{ visible.length }} 条</span>
    </div>

    <div ref="listRef" class="list">
      <div
        v-for="(item, i) in visible"
        :key="item.key"
        class="item"
        :class="{ active: i === selected }"
        :data-i="i"
        :title="item.title"
        @click="open(item)"
        @mouseenter="selected = i"
      >
        <span class="rank" :class="{ top: i < 3 }">{{ i + 1 }}</span>
        <span class="title">{{ item.title }}</span>
        <span class="badges">
          <span v-if="item.tag" class="pill">{{ item.tag }}</span>
          <span v-if="item.isNew" class="pill new">新</span>
        </span>
        <span v-if="item.heat !== undefined" class="heat">{{ formatHeat(item.heat) }}</span>
      </div>
      <div v-if="visible.length === 0" class="empty">{{ emptyText }}</div>
    </div>
  </div>
</template>

<style scoped>
.hot-search {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
.demo-banner {
  flex: none;
  margin: var(--sp-1) 10px 0;
  padding: var(--sp-1) var(--sp-3);
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: var(--r-sm);
  font-size: var(--fs-foot);
  text-align: center;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  min-height: 38px;
  overflow-x: auto;
}
.tabs {
  display: flex;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}
.tab {
  flex: none;
  border: 1px solid transparent;
  background: transparent;
  color: var(--fg-dim);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}
.tab:hover {
  background: var(--bg-raised);
}
.tab.active {
  background: var(--accent-dim);
  color: var(--accent);
}
.warn {
  color: var(--danger);
  font-weight: 700;
  font-size: 11px;
}
.tools {
  flex: none;
  display: flex;
  gap: 6px;
  align-items: center;
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.btn.active {
  border-color: var(--accent);
  color: var(--accent);
}
.btn.primary {
  background: var(--accent-dim);
  color: var(--accent);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.select {
  appearance: auto;
}
.watch-panel {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: 10px;
  padding: 2px 6px 2px 10px;
  font-size: 12px;
}
.chip-x {
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0 2px;
}
.kw-input {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  outline: none;
}
.kw-input:focus {
  border-color: var(--accent);
}
.tip {
  margin: 0;
  font-size: 12px;
}
.status {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 14px;
  color: var(--fg-dim);
  font-size: 12px;
  min-height: 26px;
}
.status-main {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-main.err {
  color: var(--danger);
}
.err {
  color: var(--danger);
}
.spacer {
  flex: 1;
}
.muted {
  color: var(--fg-dim);
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 4px 8px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
}
.item.active {
  background: var(--accent-dim);
}
.rank {
  flex: none;
  width: 22px;
  text-align: center;
  color: var(--fg-dim);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.rank.top {
  color: var(--accent);
  font-weight: 700;
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-size: 14px;
}
.badges {
  flex: none;
  display: flex;
  gap: 4px;
}
.pill {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  color: var(--fg-dim);
  border-radius: 4px;
  font-size: 11px;
  padding: 0 4px;
  line-height: 16px;
}
.pill.new {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}
.heat {
  flex: none;
  color: var(--fg-dim);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--fg-dim);
  font-size: 14px;
}
</style>
