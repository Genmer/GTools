<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import { DEMO_HITS, DEMO_QUERY } from './logic/demo'
import { fileTypeIcon, fileTypeLabel, highlightName, type FileHit, type NameHighlight } from './logic/parse'
import {
  ERROR_EVENT,
  REQ_KEY,
  RESULTS_EVENT,
  type SearchErrorPayload,
  type SearchResultsPayload
} from './logic/protocol'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const SEARCH_DEBOUNCE_MS = 300
const SPOTLIGHT_CHIPS = ['kind:pdf', 'kind:folder', 'date:today', 'size:>100MB']

const isDemo = computed(() => props.initialCommand === 'demo')

const input = ref(props.query)
const hits = ref<FileHit[]>([])
const total = ref<number | null>(null)
const searching = ref(false)
const errorCode = ref<string | null>(null)
const errorMsg = ref('')
const elapsedMs = ref<number | null>(null)
const selected = ref(0)
const tip = ref('')
const listRef = ref<HTMLElement | null>(null)

const offs: (() => void)[] = []
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let tipTimer: ReturnType<typeof setTimeout> | undefined
let activeSeq = 0

interface Row {
  hit: FileHit
  hl: NameHighlight | null
}

const rows = computed<Row[]>(() => {
  const list = isDemo.value ? DEMO_HITS : hits.value
  const q = isDemo.value ? DEMO_QUERY : input.value
  return list.map((hit) => ({ hit, hl: highlightName(hit.name, q) }))
})

const truncatedNote = computed(() => {
  if (total.value === null || hits.value.length === 0) return ''
  return total.value > hits.value.length ? ` · 已显示前 ${hits.value.length} 条` : ''
})

const showIdleEmpty = computed(
  () => !isDemo.value && input.value.trim() === '' && hits.value.length === 0 && errorCode.value === null
)
const showNoResult = computed(
  () =>
    !isDemo.value &&
    input.value.trim() !== '' &&
    !searching.value &&
    hits.value.length === 0 &&
    errorCode.value === null
)

function flashTip(msg: string): void {
  tip.value = msg
  if (tipTimer !== undefined) clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 1800)
}

function request(q: string, immediate = false): void {
  if (isDemo.value) return
  if (debounceTimer !== undefined) clearTimeout(debounceTimer)
  if (!immediate) {
    debounceTimer = setTimeout(() => void send(q), SEARCH_DEBOUNCE_MS)
    return
  }
  void send(q)
}

async function send(q: string): Promise<void> {
  const query = q.trim()
  if (query === '') {
    hits.value = []
    total.value = null
    elapsedMs.value = null
    searching.value = false
    errorCode.value = null
    return
  }
  activeSeq = Date.now() // 跨插件进出单调，backend 按 seq 去重
  searching.value = true
  errorCode.value = null
  try {
    await props.ctx.host.storage.set(REQ_KEY, { q: query, seq: activeSeq })
  } catch (err) {
    searching.value = false
    flashTip(`发起搜索失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function applyChip(chip: string): void {
  input.value = `${input.value.trim()} ${chip}`.trim()
  request(input.value, true)
}

async function openRow(hit: FileHit): Promise<void> {
  if (isDemo.value) {
    try {
      await props.ctx.host.notification.show('示例条目', 'demo 模式仅用于展示样式；真实搜索请在主窗口输入 fs 关键词')
    } catch {
      // 通知失败不影响页面
    }
    return
  }
  try {
    await props.ctx.host.shell.openPath(hit.path)
    await props.ctx.host.window.hide()
  } catch (err) {
    flashTip(`打开失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

async function copyPath(hit: FileHit): Promise<void> {
  try {
    await props.ctx.host.clipboard.writeText(hit.path)
    flashTip('路径已复制')
  } catch (err) {
    flashTip(`复制失败：${err instanceof Error ? err.message : String(err)}`)
  }
}

function move(dir: 1 | -1): void {
  const n = rows.value.length
  if (n === 0) return
  selected.value = (selected.value + dir + n) % n
}

// 插件模式下外壳 SearchBox 不转发按键，列表导航由插件自治监听（同 launcher）
function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  if ((e.target as HTMLElement).tagName === 'BUTTON') return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const row = rows.value[selected.value]
    if (row) void openRow(row.hit)
  } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
    const sel = window.getSelection()
    if (sel !== null && sel.toString() !== '') return // 输入框里有选区时让给系统复制
    const row = rows.value[selected.value]
    if (row) {
      e.preventDefault()
      void copyPath(row.hit)
    }
  }
}

watch(
  () => props.query,
  (q) => {
    if (isDemo.value || q === input.value) return
    input.value = q
    request(q, true)
  }
)
watch([() => props.query, input], () => {
  selected.value = 0
})
watch(selected, async () => {
  await nextTick()
  listRef.value?.querySelector(`[data-i="${selected.value}"]`)?.scrollIntoView({ block: 'nearest' })
})

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  if (isDemo.value) return // demo 纯静态：不启动 backend、不发真实请求，保证截图稳定
  void window.gtools.host('plugin:enter', { id: props.ctx.manifest.id })
  offs.push(
    props.ctx.host.events.on(RESULTS_EVENT, (p) => {
      const d = p as SearchResultsPayload
      if (d.seq !== activeSeq) return // 过期响应丢弃
      hits.value = d.hits
      total.value = d.total
      elapsedMs.value = d.elapsedMs
      searching.value = false
      selected.value = 0
    }),
    props.ctx.host.events.on(ERROR_EVENT, (p) => {
      const d = p as SearchErrorPayload
      if (d.seq !== activeSeq) return
      searching.value = false
      errorCode.value = d.code
      errorMsg.value = d.message
      hits.value = []
      total.value = null
    })
  )
  // 先写一条空请求抬高 backend 的 seq 基线，吃掉上次会话残留在 storage 里的旧请求
  activeSeq = Date.now()
  void props.ctx.host.storage.set(REQ_KEY, { q: '', seq: activeSeq }).catch(() => undefined)
  if (input.value.trim() !== '') request(input.value, true)
})

onBeforeUnmount(() => {
  for (const off of offs) off()
  if (debounceTimer !== undefined) clearTimeout(debounceTimer)
  if (tipTimer !== undefined) clearTimeout(tipTimer)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="fs-page">
    <div class="meta">
      <span class="source">来源：{{ isDemo ? '示例数据' : 'Spotlight（macOS mdfind）' }}</span>
      <span v-if="tip" class="tip">{{ tip }}</span>
      <span v-else-if="searching" class="searching">搜索中…</span>
      <span v-else-if="total !== null && input.trim() !== ''" class="count">
        共 {{ total }} 条{{ truncatedNote }}<template v-if="elapsedMs !== null"> · {{ elapsedMs }}ms</template>
      </span>
    </div>

    <div v-if="!isDemo" class="searchbar">
      <svg class="mag" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input
        v-model="input"
        class="input"
        type="text"
        placeholder="输入文件名关键词，支持 Spotlight 语法（kind:pdf / date:today）"
        @input="request(input)"
      />
      <button v-if="input !== ''" class="clear" title="清空" @click="input = ''; request('')">×</button>
    </div>

    <div v-if="isDemo" class="banner demo-banner">
      示例数据（演示模式）· 真实搜索：主窗口输入「fs 关键词」进入本插件
    </div>
    <div v-else-if="errorCode !== null" class="banner" :class="errorCode === 'UNSUPPORTED_PLATFORM' ? 'warn' : 'danger'">
      {{ errorMsg }}
    </div>

    <div v-if="rows.length > 0" ref="listRef" class="list">
      <div
        v-for="(row, i) in rows"
        :key="row.hit.path"
        class="row"
        :class="{ active: i === selected }"
        :data-i="i"
        @click="openRow(row.hit)"
        @mouseenter="selected = i"
      >
        <span class="icon">{{ fileTypeIcon(row.hit) }}</span>
        <span class="name">
          <template v-if="row.hl">{{ row.hl.before }}<span class="hl">{{ row.hl.match }}</span>{{ row.hl.after }}</template>
          <template v-else>{{ row.hit.name }}</template>
        </span>
        <span class="dir">{{ row.hit.dir }}</span>
        <span class="badge">{{ fileTypeLabel(row.hit) }}</span>
        <span v-if="isDemo" class="badge demo-chip">示例</span>
      </div>
    </div>

    <div v-if="showIdleEmpty || showNoResult" class="empty">
      <span class="big">{{ showNoResult ? '🗂' : '🔍' }}</span>
      <span class="title">{{ showNoResult ? '无匹配结果' : '搜索本机文件' }}</span>
      <span class="sub">
        {{ showNoResult ? '试试更短的关键词，或用 Spotlight 语法缩小范围' : '输入文件名关键词（macOS 走 Spotlight 索引；Windows 支持规划中）' }}
      </span>
      <div class="chips">
        <button v-for="chip in SPOTLIGHT_CHIPS" :key="chip" class="chip" @click="applyChip(chip)">{{ chip }}</button>
      </div>
    </div>

    <div class="foot">↑↓ 选择 · Enter 打开 · ⌘/Ctrl+C 复制路径</div>
  </div>
</template>

<style scoped>
.fs-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.meta {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-height: 28px;
  font-size: var(--fs-sub);
  color: var(--fg-dim);
}
.source {
  flex: none;
}
.tip {
  color: var(--accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.searching {
  margin-left: auto;
  color: var(--accent);
}
.count {
  margin-left: auto;
  white-space: nowrap;
}

/* §2 输入控件：32px、raised 底、聚焦 2px accent-dim 外圈 */
.searchbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 32px;
  margin-top: var(--sp-2);
  padding: 0 var(--sp-3);
  border-radius: var(--r-md);
  background: var(--bg-raised);
}
.searchbar:focus-within {
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.mag {
  flex: none;
  color: var(--fg-dim);
}
.input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-input);
  caret-color: var(--accent);
}
.input::placeholder {
  color: var(--fg-dim);
}
.clear {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}
.clear:hover {
  color: var(--fg);
  background: var(--hover);
}

.banner {
  flex: none;
  margin-top: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  font-size: var(--fs-sub);
}
.demo-banner {
  background: var(--accent-dim);
  color: var(--accent);
}
.banner.warn {
  background: var(--bg-raised);
  color: var(--warn);
}
.banner.danger {
  background: var(--bg-raised);
  color: var(--danger);
}

/* §1.4 行样式：46px 高、16px 内边距、r-md、选中/悬停才见底色 */
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: var(--sp-3);
  padding-bottom: var(--sp-1);
}
.list::-webkit-scrollbar {
  width: 6px;
}
.list::-webkit-scrollbar-thumb {
  border-radius: var(--r-sm);
  background: var(--border);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 46px;
  padding: 0 var(--sp-4);
  margin-bottom: 2px;
  border-radius: var(--r-md);
  cursor: pointer;
  user-select: none;
}
.row:hover {
  background: var(--hover);
}
.row.active {
  background: var(--active-row);
}
.icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  font-size: 15px;
  line-height: 1;
}
.name {
  flex: none;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-size: var(--fs-title);
}
.hl {
  color: var(--accent);
  font-weight: 600;
}
.dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.badge {
  flex: none;
  padding: 2px var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  line-height: 1.4;
}
.demo-chip {
  background: transparent;
  border: 1px solid var(--border);
}

.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-4) 0;
  min-height: 200px;
}
.big {
  font-size: 40px;
  line-height: 1;
}
.title {
  color: var(--fg);
  font-size: var(--fs-title);
}
.sub {
  max-width: 480px;
  text-align: center;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
.chip {
  height: 24px;
  padding: 0 var(--sp-3);
  border: none;
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  color: var(--fg-dim);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-sub);
  cursor: pointer;
}
.chip:hover {
  background: var(--hover);
  color: var(--fg);
}

.foot {
  flex: none;
  display: flex;
  align-items: center;
  height: 30px;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
</style>
