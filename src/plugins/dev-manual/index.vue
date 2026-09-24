<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { marked } from 'marked'
import type { PluginContext } from '@sdk/api'
import type { ManualEntry } from './data/types'
import { ALL_ENTRIES, ENTRY_BY_ID, MANUALS, manualLabelOf } from './data'
import { searchEntries } from './logic/search'
import { FAVORITES_KEY, favoriteEntries, normalizeFavorites, toggleFavorite } from './logic/favorites'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const views = [
  { id: 'fav', label: '收藏', icon: '⭐' },
  ...MANUALS.map((m) => ({ id: m.id, label: m.label, icon: m.icon }))
]

// command id → 视图 id（regex-syntax 手册 id 是 regex）
const COMMAND_TO_VIEW: Record<string, string> = {
  linux: 'linux',
  git: 'git',
  http: 'http',
  'regex-syntax': 'regex',
  vscode: 'vscode',
  favorites: 'fav'
}

const currentView = ref<string>('linux')
const keyword = ref(props.query.trim())
const favorites = ref<string[]>([])
const selectedId = ref<string | null>(null)
const flash = ref('')
let flashTimer: ReturnType<typeof setTimeout> | null = null

// app.platform 经 IPC 异步填充，取值瞬间可能为空，UA 兜底
// win32 分支仅静态编写，未在 Windows 实测
function guessPlatform(): string {
  const ua = navigator.userAgent
  return ua.includes('Windows') ? 'win32' : ua.includes('Mac') ? 'darwin' : 'linux'
}
const platform = ref(props.ctx.host.app.platform || guessPlatform())

watch(
  () => props.query,
  (q) => {
    keyword.value = q.trim()
  }
)
watch(
  () => props.initialCommand,
  (cmd) => {
    if (cmd && COMMAND_TO_VIEW[cmd]) currentView.value = COMMAND_TO_VIEW[cmd]
  },
  { immediate: true }
)

onMounted(async () => {
  try {
    favorites.value = normalizeFavorites(await props.ctx.host.storage.get(FAVORITES_KEY))
  } catch {
    favorites.value = [] // 读失败当空收藏处理，不影响浏览
  }
})

const scopeEntries = computed<ManualEntry[]>(() =>
  currentView.value === 'fav' ? favoriteEntries(favorites.value, ENTRY_BY_ID) : (MANUALS.find((m) => m.id === currentView.value)?.entries ?? [])
)

// 有关键词就跨全部手册搜（行上带手册角标），清空则回到当前视图
const results = computed(() =>
  keyword.value.trim() === ''
    ? scopeEntries.value.map((entry) => ({ entry, score: 0 }))
    : searchEntries(keyword.value, ALL_ENTRIES)
)

const selected = computed<ManualEntry | null>(() => results.value.find((r) => r.entry.id === selectedId.value)?.entry ?? null)

watch(
  results,
  (list) => {
    if (list.length === 0) {
      selectedId.value = null
      return
    }
    if (!list.some((r) => r.entry.id === selectedId.value)) selectedId.value = list[0].entry.id
  },
  { immediate: true }
)

function isFav(entry: ManualEntry): boolean {
  return favorites.value.includes(entry.id)
}

async function persistFavorites(): Promise<void> {
  try {
    await props.ctx.host.storage.set(FAVORITES_KEY, { v: 1, ids: favorites.value })
  } catch {
    flashMessage('收藏保存失败')
  }
}

async function onToggleFav(entry: ManualEntry): Promise<void> {
  favorites.value = toggleFavorite(favorites.value, entry.id)
  await persistFavorites()
}

function metaCombo(entry: ManualEntry): string | null {
  const m = entry.meta
  if (!m) return null
  return platform.value === 'win32' ? (m.win ?? m.mac ?? null) : (m.mac ?? m.win ?? null)
}

function copyTarget(entry: ManualEntry): string {
  return entry.copyText ?? metaCombo(entry) ?? entry.name
}

async function copyEntry(entry: ManualEntry): Promise<void> {
  try {
    await props.ctx.host.clipboard.writeText(copyTarget(entry))
    flashMessage('已复制')
  } catch (err) {
    flashMessage(`复制失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function flashMessage(text: string): void {
  flash.value = text
  if (flashTimer !== null) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    flash.value = ''
  }, 1500)
}

// 内容为随插件打包的本地数据（非用户/远端输入），marked 直渲可接受
const detailHtml = computed<string>(() => {
  if (!selected.value) return ''
  return marked.parse(selected.value.md, { async: false })
})

const entryCount = (viewId: string): number =>
  viewId === 'fav' ? favorites.value.length : (MANUALS.find((m) => m.id === viewId)?.entries.length ?? 0)
</script>

<template>
  <div class="manual">
    <nav class="nav">
      <button
        v-for="v in views"
        :key="v.id"
        class="nav-btn"
        :class="{ active: currentView === v.id }"
        @click="currentView = v.id"
      >
        <span class="nav-icon">{{ v.icon }}</span>
        <span class="nav-label">{{ v.label }}</span>
        <span class="nav-count">{{ entryCount(v.id) }}</span>
      </button>
    </nav>

    <div class="list-col">
      <div class="bar">
        <input v-model="keyword" class="search" type="text" placeholder="搜全部手册：命令 / 状态码 / 拼音…" />
        <span v-if="keyword.trim() !== ''" class="count">{{ results.length }} 条</span>
      </div>
      <ul class="list">
        <li
          v-for="r in results"
          :key="r.entry.id"
          class="item"
          :class="{ active: r.entry.id === selectedId }"
          @click="selectedId = r.entry.id"
        >
          <button class="star" :class="{ on: isFav(r.entry) }" :title="isFav(r.entry) ? '取消收藏' : '收藏'" @click.stop="onToggleFav(r.entry)">
            {{ isFav(r.entry) ? '★' : '☆' }}
          </button>
          <div class="item-main">
            <span class="item-name">{{ r.entry.name }}</span>
            <span class="item-summary">{{ r.entry.summary }}</span>
          </div>
          <span v-if="keyword.trim() !== '' || currentView === 'fav'" class="badge">{{ manualLabelOf(r.entry) }}</span>
        </li>
      </ul>
      <div v-if="results.length === 0" class="empty">
        {{ currentView === 'fav' && keyword.trim() === '' ? '暂无收藏，点击条目右侧 ☆ 收藏高频命令' : '无匹配条目' }}
      </div>
    </div>

    <div class="detail">
      <template v-if="selected">
        <header class="detail-head">
          <h2 class="title">{{ selected.name }}</h2>
          <span class="combo">{{ metaCombo(selected) ?? copyTarget(selected) }}</span>
          <span class="spacer" />
          <button class="btn primary" @click="copyEntry(selected)">复制</button>
          <button class="btn" :class="{ on: isFav(selected) }" @click="onToggleFav(selected)">
            {{ isFav(selected) ? '★ 已收藏' : '☆ 收藏' }}
          </button>
        </header>
        <p class="summary">{{ selected.summary }} · {{ manualLabelOf(selected) }}</p>
        <!-- 本地打包数据经 marked 渲染，非外部输入 -->
        <div class="md" v-html="detailHtml" />
      </template>
      <div v-else class="empty dim">左侧选择条目查看详情</div>
      <div v-if="flash !== ''" class="flash">{{ flash }}</div>
    </div>
  </div>
</template>

<style scoped>
.manual {
  height: 100%;
  display: flex;
}
.nav {
  flex: none;
  width: 120px;
  padding: 10px 6px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nav-btn {
  border: none;
  background: transparent;
  color: var(--fg-dim);
  padding: 8px 8px;
  border-radius: 6px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}
.nav-btn.active {
  background: var(--accent-dim);
  color: var(--accent);
}
.nav-icon {
  flex: none;
}
.nav-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-count {
  flex: none;
  font-size: 11px;
  color: var(--fg-dim);
}
.list-col {
  flex: none;
  width: 320px;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  min-height: 0;
}
.bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.search {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-raised);
  color: var(--fg);
  padding: 7px 10px;
  font-size: 14px;
  outline: none;
}
.search:focus {
  border-color: var(--accent);
}
.count {
  flex: none;
  color: var(--fg-dim);
  font-size: 12px;
}
.list {
  flex: 1;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  list-style: none;
  min-height: 0;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}
.item:hover {
  background: var(--accent-dim);
}
.item.active {
  background: var(--accent-dim);
  box-shadow: inset 0 0 0 1px var(--accent);
}
.star {
  flex: none;
  border: none;
  background: transparent;
  color: var(--fg-dim);
  font-size: 15px;
  cursor: pointer;
  padding: 2px;
  line-height: 1;
}
.star.on {
  color: var(--accent);
}
.item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.item-name {
  color: var(--fg);
  font-size: 14px;
  font-family: ui-monospace, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.item-summary {
  color: var(--fg-dim);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  flex: none;
  font-size: 11px;
  color: var(--fg-dim);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  white-space: nowrap;
}
.detail {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 20px;
  position: relative;
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.title {
  margin: 0;
  font-size: 18px;
  color: var(--fg);
  font-family: ui-monospace, monospace;
  word-break: break-all;
}
.combo {
  color: var(--accent);
  font-size: 13px;
  font-family: ui-monospace, monospace;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 8px;
}
.spacer {
  flex: 1;
}
.btn {
  border: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--fg);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.btn:hover {
  border-color: var(--accent);
}
.btn.primary {
  background: var(--accent);
  color: var(--bg);
  border-color: var(--accent);
}
.btn.on {
  color: var(--accent);
  border-color: var(--accent);
}
.summary {
  margin: 8px 0 4px;
  color: var(--fg-dim);
  font-size: 13px;
}
.empty {
  flex: none;
  padding: 32px 12px;
  text-align: center;
  color: var(--fg);
  font-size: 14px;
}
.empty.dim {
  color: var(--fg-dim);
  padding: 48px 12px;
}
.flash {
  position: sticky;
  bottom: 0;
  align-self: flex-end;
  margin-top: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 13px;
}
.md {
  margin-top: 10px;
  font-size: 14px;
  color: var(--fg);
  line-height: 1.7;
  user-select: text;
}
.md :deep(h2),
.md :deep(h3) {
  margin: 18px 0 8px;
  font-size: 15px;
  color: var(--fg);
}
.md :deep(h2:first-child),
.md :deep(h3:first-child) {
  margin-top: 0;
}
.md :deep(p) {
  margin: 8px 0;
}
.md :deep(ul) {
  margin: 8px 0;
  padding-left: 20px;
}
.md :deep(li) {
  margin: 4px 0;
}
.md :deep(code) {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: ui-monospace, monospace;
  font-size: 12.5px;
  word-break: break-all;
}
.md :deep(pre) {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  overflow: auto;
  margin: 8px 0;
}
.md :deep(pre code) {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 12.5px;
  line-height: 1.6;
  word-break: normal;
}
.md :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}
.md :deep(th),
.md :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 10px;
  text-align: left;
}
.md :deep(th) {
  background: var(--bg-raised);
}
.md :deep(strong) {
  color: var(--accent);
}
</style>
