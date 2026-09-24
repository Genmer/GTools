<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import {
  CLEAR_MARKER_KEY,
  DEFAULT_SETTINGS,
  clampMaxRecords,
  filterRecords,
  previewOf,
  type ClipboardRecord,
  type ClipboardSettings
} from './logic/history'
import {
  EMPTY_UI_STATE,
  KIND_LABELS,
  TAB_DEFS,
  UI_STATE_KEY,
  buildDemoEntries,
  entryKindOf,
  filterByTab,
  hideRecord,
  orderRecords,
  parseUiState,
  pruneUiState,
  togglePin,
  type ClipboardUiState,
  type EntryTab
} from './logic/view'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

// demo 态（initialCommand==='demo'）：渲染稳定示例数据，不读写真实存储、不写剪贴板
const isDemo = computed(() => props.initialCommand === 'demo')

const records = ref<ClipboardRecord[]>([])
const ui = ref<ClipboardUiState>({ ...EMPTY_UI_STATE })
const settings = ref<ClipboardSettings>({ ...DEFAULT_SETTINGS })
const tab = ref<EntryTab>('all')
const keyword = ref(props.query.trim())
const pastedId = ref<string | null>(null)
const statusText = ref('')
const clearArmed = ref(false)
const showSettings = ref(false)
const maxDraft = ref(String(DEFAULT_SETTINGS.maxRecords))
const exitClearDraft = ref(false)
const loading = ref(true)

// 来源应用只有 demo 才有值（Electron 剪贴板不暴露来源应用，真实条目该槽位显示类型标签）
let demoApps = new Map<string, string>()

let offEvents: (() => void) | null = null
let flashTimer: ReturnType<typeof setTimeout> | null = null
let armTimer: ReturnType<typeof setTimeout> | null = null
let statusTimer: ReturnType<typeof setTimeout> | null = null
let lastClearMarker = 0

watch(
  () => props.query,
  (q) => {
    keyword.value = q.trim()
  }
)

interface StoredState {
  v: 1
  settings: ClipboardSettings
  records: ClipboardRecord[]
}

async function load(): Promise<void> {
  try {
    const raw = await props.ctx.host.storage.get<StoredState>('state')
    if (raw !== null && Array.isArray(raw.records)) {
      records.value = raw.records
      if (raw.settings !== undefined) {
        settings.value = {
          maxRecords: clampMaxRecords(raw.settings.maxRecords),
          clearOnExit: raw.settings.clearOnExit === true
        }
        maxDraft.value = String(settings.value.maxRecords)
        exitClearDraft.value = settings.value.clearOnExit
      }
    }
    ui.value = parseUiState(await props.ctx.host.storage.get(UI_STATE_KEY))
    const pruned = pruneUiState(ui.value, records.value)
    if (pruned !== ui.value) {
      ui.value = pruned
      void saveUi()
    }
    const marker = await props.ctx.host.storage.get(CLEAR_MARKER_KEY)
    if (typeof marker === 'number') lastClearMarker = marker
  } catch {
    // 读取失败保持当前列表，等下一轮 history-changed 再刷
  }
  loading.value = false
}

const pinnedSet = computed(() => new Set(ui.value.pinned))
const hiddenSet = computed(() => new Set(ui.value.hidden))
// tab 计数基于隐藏过滤后的全量（不受当前搜索词影响），让用户知道每个分类存量
const baseRecords = computed(() => records.value.filter((r) => !hiddenSet.value.has(r.id)))

const counts = computed<Record<EntryTab, number>>(() => {
  const c: Record<EntryTab, number> = { all: baseRecords.value.length, text: 0, link: 0, image: 0, file: 0 }
  for (const r of baseRecords.value) c[entryKindOf(r)] += 1
  return c
})

const visible = computed(() =>
  orderRecords(filterByTab(filterRecords(baseRecords.value, keyword.value), tab.value), pinnedSet.value)
)

function flash(text: string): void {
  statusText.value = text
  if (statusTimer !== null) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    statusText.value = ''
  }, 1500)
}

async function saveUi(): Promise<void> {
  if (isDemo.value) return
  try {
    await props.ctx.host.storage.set(UI_STATE_KEY, ui.value)
  } catch {
    flash('保存失败')
  }
}

function setUi(next: ClipboardUiState): void {
  ui.value = next
  void saveUi()
}

async function onCopy(rec: ClipboardRecord): Promise<void> {
  if (isDemo.value) {
    flash('示例条目：demo 模式不写入剪贴板')
    return
  }
  try {
    if (rec.kind === 'text') {
      await props.ctx.host.clipboard.writeText(rec.text)
    } else {
      if (rec.dataUrl === null) {
        flash('图片数据已被清理，无法复制')
        return
      }
      await props.ctx.host.clipboard.writeImage(rec.dataUrl)
    }
    pastedId.value = rec.id
    if (flashTimer !== null) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      pastedId.value = null
    }, 1200)
    flash('已复制到剪贴板')
  } catch (err) {
    flash(`复制失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function onTogglePin(rec: ClipboardRecord): void {
  setUi(togglePin(ui.value, rec.id))
  flash(ui.value.pinned.includes(rec.id) ? '已固定，将置顶显示' : '已取消固定')
}

function onDelete(rec: ClipboardRecord): void {
  setUi(hideRecord(ui.value, rec.id))
  flash('已删除')
}

async function persistState(): Promise<void> {
  try {
    await props.ctx.host.storage.set('state', {
      v: 1,
      settings: settings.value,
      records: records.value
    } satisfies StoredState)
  } catch {
    flash('保存失败')
  }
}

function requestClear(): void {
  if (!clearArmed.value) {
    clearArmed.value = true
    if (armTimer !== null) clearTimeout(armTimer)
    armTimer = setTimeout(() => {
      clearArmed.value = false
    }, 3000)
    return
  }
  clearArmed.value = false
  if (armTimer !== null) clearTimeout(armTimer)
  records.value = []
  setUi({ ...EMPTY_UI_STATE })
  flash('已清空')
  // 只写清空标记，由 backend 采纳后统一落盘（渲染层不直写 state，避免与 backend 在途写入互相覆盖）
  lastClearMarker = Math.max(Date.now(), lastClearMarker + 1)
  void props.ctx.host.storage.set(CLEAR_MARKER_KEY, lastClearMarker).catch(() => flash('清空失败'))
}

function saveSettings(): void {
  const n = Number.parseInt(maxDraft.value, 10)
  settings.value = {
    maxRecords: clampMaxRecords(Number.isFinite(n) ? n : settings.value.maxRecords),
    clearOnExit: exitClearDraft.value
  }
  maxDraft.value = String(settings.value.maxRecords)
  showSettings.value = false
  flash('设置已保存')
  void persistState()
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  return sameDay ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function glyphOf(rec: ClipboardRecord): string {
  const kind = entryKindOf(rec)
  return kind === 'link' ? '🔗' : kind === 'file' ? '📄' : '📝'
}

function sourceLabel(rec: ClipboardRecord): string {
  if (isDemo.value) return demoApps.get(rec.id) ?? '示例应用'
  return KIND_LABELS[entryKindOf(rec)]
}

function hostOf(rec: ClipboardRecord): string {
  if (rec.kind !== 'text' || entryKindOf(rec) !== 'link') return ''
  try {
    return new URL(rec.text.trim()).host
  } catch {
    return ''
  }
}

// demo 数据在 setup 内同步初始化，避免首帧先渲染空态再闪换成示例
if (props.initialCommand === 'demo') {
  const { entries, pinnedIds } = buildDemoEntries(Date.now())
  records.value = entries.map((e) => e.record)
  demoApps = new Map(entries.map((e) => [e.record.id, e.sourceApp]))
  ui.value = { pinned: [...pinnedIds], hidden: [] }
  loading.value = false
}

onMounted(() => {
  if (isDemo.value) return
  void load()
  offEvents = props.ctx.host.events.on('history-changed', () => {
    void load()
  })
})

onUnmounted(() => {
  offEvents?.()
  if (flashTimer !== null) clearTimeout(flashTimer)
  if (armTimer !== null) clearTimeout(armTimer)
  if (statusTimer !== null) clearTimeout(statusTimer)
})
</script>

<template>
  <div class="clip">
    <div class="toolbar">
      <div class="tabs" role="tablist">
        <button
          v-for="t in TAB_DEFS"
          :key="t.id"
          class="tab"
          role="tab"
          :aria-selected="tab === t.id"
          :class="{ active: tab === t.id }"
          @click="tab = t.id"
        >
          {{ t.label }}<span class="count">{{ counts[t.id] }}</span>
        </button>
      </div>
      <span class="spacer"></span>
      <input v-model="keyword" class="search" type="text" placeholder="搜索剪贴板历史…" spellcheck="false" />
      <template v-if="!isDemo">
        <button class="icon-btn" :class="{ on: showSettings }" title="设置" @click="showSettings = !showSettings">
          ⚙
        </button>
        <button class="btn-text danger" :class="{ armed: clearArmed }" @click="requestClear">
          {{ clearArmed ? '确认清空' : '清空' }}
        </button>
      </template>
    </div>

    <div v-if="showSettings && !isDemo" class="settings">
      <label class="field">
        容量上限
        <input v-model="maxDraft" class="num" type="number" :min="10" :max="2000" />
        条
      </label>
      <label class="field"><input v-model="exitClearDraft" class="check" type="checkbox" /> 退出应用时清空历史</label>
      <button class="btn-text primary" @click="saveSettings">保存</button>
    </div>

    <p v-if="isDemo" class="demo-banner">示例模式：以下为演示数据（2 文本 / 1 链接 / 1 图片 / 1 文件 / 1 置顶）</p>

    <ul v-if="visible.length > 0" class="cards">
      <li
        v-for="rec in visible"
        :key="rec.id"
        class="card"
        :class="{ pinned: pinnedSet.has(rec.id), pasted: pastedId === rec.id }"
        :title="rec.kind === 'text' ? rec.text : `图片 ${rec.width}×${rec.height}`"
        @click="onCopy(rec)"
      >
        <img v-if="rec.kind === 'image' && rec.dataUrl !== null" class="thumb" :src="rec.dataUrl" alt="" />
        <div v-else-if="rec.kind === 'image'" class="thumb-ph" :class="{ lost: !isDemo }">🖼️</div>
        <div v-else class="glyph">{{ glyphOf(rec) }}</div>
        <div class="main">
          <div
            class="preview"
            :class="{
              'is-link': hostOf(rec) !== '',
              'is-file': rec.kind === 'text' && entryKindOf(rec) === 'file',
              dim: rec.kind === 'image' && rec.dataUrl === null && !isDemo
            }"
          >
            {{
              rec.kind === 'image'
                ? `图片 ${rec.width}×${rec.height} · ${formatBytes(rec.bytes)}`
                : previewOf(rec, 400)
            }}
          </div>
          <div class="meta">
            <span v-if="pinnedSet.has(rec.id)" class="pin-badge">📌 已固定</span>
            <span class="src">{{ sourceLabel(rec) }}</span>
            <span v-if="isDemo" class="demo-chip">示例</span>
            <span class="spacer"></span>
            <span v-if="hostOf(rec) !== ''" class="host">{{ hostOf(rec) }}</span>
            <span class="time">{{ formatTime(rec.ts) }}</span>
          </div>
        </div>
        <div class="ops" @click.stop>
          <button class="op" title="复制到剪贴板" @click="onCopy(rec)">复制</button>
          <button class="op" :title="pinnedSet.has(rec.id) ? '取消固定' : '固定并置顶'" @click="onTogglePin(rec)">
            {{ pinnedSet.has(rec.id) ? '取消固定' : '固定' }}
          </button>
          <button class="op danger" title="从列表删除" @click="onDelete(rec)">删除</button>
        </div>
      </li>
    </ul>

    <div v-else-if="loading && !isDemo" class="state">加载中…</div>
    <div v-else class="state">
      <template v-if="records.length === 0">
        <div class="state-icon">📋</div>
        <p class="state-title">复制任意内容，会自动出现在这里</p>
        <p class="state-sub">支持文本、链接、图片与文件路径</p>
      </template>
      <template v-else-if="baseRecords.length === 0">
        <div class="state-icon">🗑️</div>
        <p class="state-title">{{ isDemo ? '示例条目已删空' : '条目已全部删除' }}</p>
        <p class="state-sub">{{ isDemo ? '重新打开 demo 页可恢复演示数据' : '新复制的内容会自动收录' }}</p>
      </template>
      <template v-else>
        <div class="state-icon">🔍</div>
        <p class="state-title">没有匹配的条目</p>
        <p class="state-sub">换个分类或关键词试试</p>
      </template>
    </div>

    <transition name="toast">
      <p v-if="statusText !== ''" class="toast">{{ statusText }}</p>
    </transition>
  </div>
</template>

<style scoped>
.clip {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 40px;
}
.tabs {
  display: flex;
  gap: var(--sp-1);
  padding: 3px;
  background: var(--bg-raised);
  border-radius: var(--r-md);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  padding: 4px 10px;
  border-radius: var(--r-sm);
  cursor: pointer;
}
.tab:hover {
  background: var(--hover);
  color: var(--fg);
}
.tab.active {
  background: var(--accent-dim);
  color: var(--accent);
  font-weight: 600;
}
.count {
  font-size: var(--fs-foot);
  font-variant-numeric: tabular-nums;
}
.spacer {
  flex: 1;
}
.search {
  flex: none;
  width: 200px;
  height: 32px;
  box-sizing: border-box;
  border: none;
  background: var(--bg-raised);
  border-radius: var(--r-md);
  padding: 0 var(--sp-3);
  color: var(--fg);
  font-size: var(--fs-title);
  outline: none;
  caret-color: var(--accent);
}
.search:focus {
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.search::placeholder {
  color: var(--fg-dim);
}
.icon-btn {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  font-size: 14px;
  cursor: pointer;
}
.icon-btn:hover,
.icon-btn.on {
  background: var(--hover);
  color: var(--fg);
}
.btn-text {
  flex: none;
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.btn-text:hover {
  border-color: var(--accent);
  color: var(--accent);
}
/* §2 主按钮：32px、accent 底白字；次/危险按钮维持 28px 紧凑档 */
.btn-text.primary {
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: var(--r-md);
  background: var(--accent);
  color: var(--on-accent);
}
.btn-text.primary:hover {
  filter: brightness(0.94);
}
.btn-text.danger:hover,
.btn-text.danger.armed {
  border-color: var(--danger);
  color: var(--danger);
}
.settings {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  margin-top: var(--sp-2);
  color: var(--fg);
  font-size: var(--fs-sub);
}
.field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.num {
  width: 72px;
  height: 32px;
  box-sizing: border-box;
  border: none;
  border-radius: var(--r-md);
  background: var(--bg-raised);
  color: var(--fg);
  padding: 0 var(--sp-2);
  font-size: var(--fs-sub);
  outline: none;
}
.num:focus {
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.check {
  accent-color: var(--accent);
}
.demo-banner {
  flex: none;
  margin: var(--sp-2) 0 0;
  padding: 6px var(--sp-3);
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: var(--r-md);
  font-size: var(--fs-sub);
}
.cards {
  flex: 1;
  min-height: 0;
  margin: var(--sp-3) 0 0;
  padding: 0;
  list-style: none;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.cards::-webkit-scrollbar {
  width: 6px;
}
.cards::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
.card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  padding: var(--sp-3);
  background: var(--bg-raised);
  border-radius: var(--r-lg);
  cursor: pointer;
}
.card:hover {
  box-shadow: var(--shadow-pop);
}
.card.pinned {
  box-shadow: inset 3px 0 0 var(--accent);
}
.card.pasted {
  box-shadow: inset 0 0 0 1.5px var(--accent);
}
.thumb {
  flex: none;
  width: 48px;
  height: 48px;
  object-fit: cover;
  border-radius: var(--r-sm);
  background: var(--bg);
}
.thumb-ph {
  flex: none;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  background: var(--hover);
  font-size: 20px;
}
.thumb-ph.lost {
  opacity: 0.6;
}
.glyph {
  flex: none;
  width: 28px;
  height: 28px;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  background: var(--hover);
  font-size: 14px;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.preview {
  color: var(--fg);
  font-size: var(--fs-title);
  line-height: 1.45;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
  overflow-wrap: anywhere;
}
.preview.dim {
  color: var(--fg-dim);
}
.preview.is-link {
  color: var(--accent);
}
.preview.is-file {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-sub);
}
.meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  min-width: 0;
}
.pin-badge {
  color: var(--accent);
  background: var(--accent-dim);
  border-radius: var(--r-sm);
  padding: 1px 6px;
  font-weight: 600;
}
.demo-chip {
  background: var(--hover);
  border-radius: var(--r-sm);
  padding: 1px 6px;
}
.host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time {
  flex: none;
  font-variant-numeric: tabular-nums;
}
.ops {
  position: absolute;
  right: var(--sp-3);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: var(--sp-1);
  padding: 3px;
  background: var(--bg);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop), 0 0 0 1px var(--border);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}
.card:hover .ops {
  opacity: 1;
  pointer-events: auto;
}
.op {
  border: none;
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  padding: 4px 8px;
  border-radius: var(--r-sm);
  cursor: pointer;
  white-space: nowrap;
}
.op:hover {
  background: var(--hover);
  color: var(--fg);
}
.op.danger:hover {
  color: var(--danger);
}
.state {
  flex: 1;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  color: var(--fg);
  font-size: var(--fs-title);
}
.state-icon {
  font-size: 40px;
}
.state-title {
  margin: 0;
  color: var(--fg);
  font-size: var(--fs-title);
}
.state-sub {
  margin: 0;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.toast {
  position: absolute;
  left: 50%;
  bottom: var(--sp-4);
  transform: translateX(-50%);
  margin: 0;
  padding: 6px var(--sp-3);
  background: var(--bg-raised);
  color: var(--fg);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop), 0 0 0 1px var(--border);
  font-size: var(--fs-sub);
  pointer-events: none;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 6px);
}
</style>
