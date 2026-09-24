<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import type { MemoRecord } from './logic/memos'
import {
  MEMOS_STORAGE_KEY,
  createMemo,
  demoMemoState,
  deleteMemo,
  emptyMemoState,
  normalizeMemoState,
  togglePin
} from './logic/memos'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

// demo 态只渲染稳定示例且不读写本地存储（截图 / 新手引导用）
const isDemo = computed(() => props.initialCommand === 'demo')

const state = ref(emptyMemoState())
const draft = ref('')
const expandedId = ref<string | null>(null)
const confirmingId = ref<string | null>(null)
const statusMsg = ref('')
const inputRef = ref<HTMLInputElement | null>(null)
let statusTimer: ReturnType<typeof setTimeout> | undefined

const pinned = computed(() => state.value.memos.filter((m) => m.pinned))

// 外壳搜索框 keyword 后剩余输入直达快速输入行（memo 买牛奶 → 预填后回车即存）
watch(
  () => props.query,
  (q) => {
    const t = q.trim()
    if (t !== '') draft.value = t
  },
  { immediate: true }
)

onMounted(async () => {
  if (isDemo.value) {
    state.value = demoMemoState()
    return
  }
  try {
    state.value = normalizeMemoState(await props.ctx.host.storage.get(MEMOS_STORAGE_KEY))
  } catch {
    state.value = emptyMemoState()
  }
})

onBeforeUnmount(() => {
  if (statusTimer !== undefined) clearTimeout(statusTimer)
})

async function persist(): Promise<void> {
  if (isDemo.value) return
  try {
    await props.ctx.host.storage.set(MEMOS_STORAGE_KEY, state.value)
  } catch {
    showStatus('保存失败')
  }
}

function showStatus(msg: string): void {
  statusMsg.value = msg
  if (statusTimer !== undefined) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => (statusMsg.value = ''), 2000)
}

function onEnter(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter 只上屏，不落便签
  const r = createMemo(state.value, draft.value, Date.now())
  if (r.memo === null) return
  state.value = r.state
  draft.value = ''
  confirmingId.value = null
  void persist()
}

function onTogglePin(id: string): void {
  confirmingId.value = null
  const next = togglePin(state.value, id)
  if (next === state.value) return
  state.value = next
  void persist()
}

async function onCopy(m: MemoRecord): Promise<void> {
  try {
    await props.ctx.host.clipboard.writeText(m.text)
    showStatus('已复制')
  } catch {
    showStatus('复制失败')
  }
}

function askDelete(id: string): void {
  confirmingId.value = id
}

function doDelete(id: string): void {
  confirmingId.value = null
  const next = deleteMemo(state.value, id)
  if (next === state.value) return
  state.value = next
  if (expandedId.value === id) expandedId.value = null
  void persist()
  // 删完顺手回输入行，保持「输入 → 回车」闭环不断
  void nextTick(() => inputRef.value?.focus())
}

function onToggleExpand(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
  confirmingId.value = null
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  const now = new Date()
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return hm
  }
  if (d.getFullYear() === now.getFullYear()) return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${hm}`
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
</script>

<template>
  <div class="memo">
    <div v-if="isDemo" class="demo-banner">示例数据 · 演示模式（不写入本地存储）</div>
    <div class="composer">
      <input
        ref="inputRef"
        v-model="draft"
        class="quick-input"
        :class="{ 'has-hint': statusMsg !== '' || state.memos.length > 0 }"
        type="text"
        placeholder="记一条，回车保存…"
        spellcheck="false"
        @keydown.enter.prevent="onEnter"
      />
      <span v-if="statusMsg !== ''" class="hint status">{{ statusMsg }}</span>
      <span v-else-if="state.memos.length > 0" class="hint count">
        共 {{ state.memos.length }} 条<template v-if="pinned.length > 0"> · 置顶 {{ pinned.length }}</template>
      </span>
    </div>

    <div v-if="state.memos.length === 0" class="empty" @click="inputRef?.focus()">
      <div class="empty-icon">🗒️</div>
      <p>输入内容按回车，记下第一条便签</p>
    </div>

    <section v-else class="list">
      <div v-if="pinned.length > 0" class="group-label">置顶</div>
      <article
        v-for="m in state.memos"
        :key="m.id"
        class="card"
        :class="{ expanded: expandedId === m.id }"
      >
        <div class="text" :title="m.text" @click="onToggleExpand(m.id)">{{ m.text }}</div>
        <div class="meta">
          <span v-if="m.pinned" class="badge">📌 置顶</span>
          <span class="time">{{ formatTime(m.createdAt) }}</span>
          <span class="ops" @click.stop>
            <button v-if="confirmingId === m.id" class="op confirm" @click="doDelete(m.id)">确认删除</button>
            <template v-else>
              <button class="op" @click="onCopy(m)">复制</button>
              <button class="op" @click="onTogglePin(m.id)">{{ m.pinned ? '取消置顶' : '置顶' }}</button>
              <button class="op danger" @click="askDelete(m.id)">删除</button>
            </template>
          </span>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.memo {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  font-size: var(--fs-title);
}
.demo-banner {
  flex: none;
  margin-bottom: var(--sp-2);
  padding: var(--sp-1) var(--sp-3);
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: var(--r-sm);
  font-size: var(--fs-foot);
  text-align: center;
}
.composer {
  flex: none;
  position: relative;
}
.quick-input {
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  padding: 0 var(--sp-3);
  background: var(--bg-raised);
  color: var(--fg);
  border: none;
  border-radius: var(--r-md);
  font-size: var(--fs-input);
  outline: none;
  transition: box-shadow 0.12s ease;
}
.quick-input:focus {
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.quick-input.has-hint {
  padding-right: 120px;
}
.quick-input::placeholder {
  color: var(--fg-dim);
}
.hint {
  position: absolute;
  right: var(--sp-3);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-foot);
  color: var(--fg-dim);
  pointer-events: none;
}
.hint.status {
  color: var(--accent);
}
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  color: var(--fg-dim);
  cursor: pointer;
}
.empty-icon {
  font-size: 40px;
  opacity: 0.45;
}
.empty p {
  margin: 0;
  font-size: var(--fs-sub);
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin-top: var(--sp-3);
  padding-right: var(--sp-1);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.group-label {
  flex: none;
  padding: var(--sp-1) var(--sp-1) 0;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.card {
  flex: none;
  padding: var(--sp-2) var(--sp-3);
  background: var(--bg-raised);
  border-radius: var(--r-md);
  transition: box-shadow 0.12s ease;
}
.card:hover {
  box-shadow: var(--shadow-pop);
}
.text {
  font-size: var(--fs-title);
  line-height: 1.55;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  cursor: pointer;
  user-select: none;
}
.card.expanded .text {
  display: block;
  -webkit-line-clamp: none;
  cursor: auto;
}
.meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}
.badge {
  flex: none;
  display: inline-flex;
  align-items: center;
  padding: 1px var(--sp-2);
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: var(--r-sm);
  font-size: var(--fs-foot);
}
.time {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.ops {
  flex: none;
  display: flex;
  gap: 2px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}
.card:hover .ops,
.card:focus-within .ops {
  opacity: 1;
  pointer-events: auto;
}
.op {
  height: 22px;
  padding: 0 var(--sp-2);
  border: none;
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  border-radius: var(--r-sm);
  cursor: pointer;
}
.op:hover {
  background: var(--hover);
  color: var(--fg);
}
.op.danger:hover {
  color: var(--danger);
}
.op.confirm {
  background: none;
  color: var(--danger);
  font-weight: 600;
}
</style>
