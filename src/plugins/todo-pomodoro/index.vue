<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import {
  PRIORITY_LABEL,
  addTodo,
  dateKeyOf,
  parsePersistedTodos,
  removeTodo,
  toPersistedTodos,
  todosForView,
  toggleTodo,
  updateTodo,
  type Priority,
  type Todo
} from './logic/todos'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const TODOS_KEY = 'todos'

const isDemo = computed(() => props.initialCommand === 'demo')

const todos = ref<Todo[]>([])
const view = ref<'today' | 'all'>('today')
const addText = ref('')
const addPriority = ref<Priority>('normal')
const editingId = ref<string | null>(null)
const editingText = ref('')
const statusText = ref('')
const now = ref(Date.now())

let clockTimer: ReturnType<typeof setInterval> | null = null
let statusTimer: ReturnType<typeof setTimeout> | null = null

// demo 态用固定示例数据，交互只在内存里生效，不落 storage
if (isDemo.value) {
  const today = dateKeyOf(now.value)
  todos.value = [
    { id: 'demo-1', text: '梳理四期 UI 复刻清单', priority: 'high', done: false, date: today, completedOn: null, createdAt: 3, updatedAt: 3 },
    { id: 'demo-2', text: '走查番茄钟交互闭环', priority: 'low', done: false, date: today, completedOn: null, createdAt: 2, updatedAt: 2 },
    { id: 'demo-3', text: '对齐 uTools 视觉规范', priority: 'normal', done: true, date: today, completedOn: today, createdAt: 1, updatedAt: 1 }
  ]
}

const todayKey = computed(() => dateKeyOf(now.value))
const visibleTodos = computed(() => todosForView(todos.value, view.value, todayKey.value))
const pendingCount = computed(() => todos.value.filter((t) => !t.done).length)

function flash(text: string): void {
  statusText.value = text
  if (statusTimer !== null) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    statusText.value = ''
  }, 1600)
}

// 外壳 keyword 后剩余输入直达添加框（todo 买牛奶 → 预填「买牛奶」）
watch(
  () => props.query,
  (q) => {
    const t = q.trim()
    if (t !== '' && t !== addText.value) addText.value = t
  },
  { immediate: true }
)

// initialCommand 消费（全局推荐条直达）
let initialCommandConsumed = false
function consumeInitialCommand(cmd?: string): void {
  if (initialCommandConsumed || cmd === undefined || cmd === '') return
  if (cmd === 'add') {
    initialCommandConsumed = true
    if (props.query.trim()) {
      const text = props.query.trim()
      const next = addTodo(todos.value, { text, priority: 'normal', now: Date.now() })
      if (next !== null) {
        todos.value = next
        void props.ctx.host.storage.set(TODOS_KEY, toPersistedTodos(todos.value))
        addText.value = ''
      }
    }
  }
}

async function load(): Promise<void> {
  try {
    todos.value = parsePersistedTodos(await props.ctx.host.storage.get(TODOS_KEY)) ?? []
  } catch {
    todos.value = []
  }
  consumeInitialCommand(props.initialCommand)
}

async function persistTodos(next: Todo[]): Promise<void> {
  todos.value = next
  if (isDemo.value) return
  try {
    await props.ctx.host.storage.set(TODOS_KEY, toPersistedTodos(next))
  } catch {
    flash('保存失败')
  }
}

function onAdd(): void {
  const next = addTodo(todos.value, { text: addText.value, priority: addPriority.value, now: Date.now() })
  if (next === null) {
    flash('待办内容不能为空')
    return
  }
  void persistTodos(next)
  addText.value = ''
}

function onToggle(t: Todo): void {
  const next = toggleTodo(todos.value, t.id, Date.now())
  if (next === null) return
  void persistTodos(next)
}

function onAddEnter(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter 只上屏
  onAdd()
}

function onRemove(t: Todo): void {
  void persistTodos(removeTodo(todos.value, t.id))
}

function startEdit(t: Todo): void {
  editingId.value = t.id
  editingText.value = t.text
}

function commitEdit(): void {
  const id = editingId.value
  if (id === null) return
  editingId.value = null
  const next = updateTodo(todos.value, id, { text: editingText.value }, Date.now())
  if (next !== null) void persistTodos(next)
}

function cancelEdit(): void {
  editingId.value = null
}

function onEditEnter(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter 只上屏，不提交编辑
  commitEdit()
}

const PRIORITY_CYCLE: Priority[] = ['low', 'normal', 'high']

function cyclePriority(t: Todo): void {
  const next = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(t.priority) + 1) % PRIORITY_CYCLE.length]
  const updated = updateTodo(todos.value, t.id, { priority: next }, Date.now())
  if (updated !== null) void persistTodos(updated)
}

function cycleAddPriority(): void {
  addPriority.value = PRIORITY_CYCLE[(PRIORITY_CYCLE.indexOf(addPriority.value) + 1) % PRIORITY_CYCLE.length]
}

function dateBadge(t: Todo): string {
  return t.date === todayKey.value ? '' : t.date.slice(5)
}

onMounted(() => {
  if (!isDemo.value) void load()
  else consumeInitialCommand(props.initialCommand)
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 60_000)
})

onUnmounted(() => {
  if (clockTimer !== null) clearInterval(clockTimer)
  if (statusTimer !== null) clearTimeout(statusTimer)
})
</script>

<template>
  <div class="tp">
    <section class="tasks">
      <header class="toolbar">
        <div class="seg">
          <button :class="{ active: view === 'today' }" @click="view = 'today'">今日</button>
          <button :class="{ active: view === 'all' }" @click="view = 'all'">全部</button>
        </div>
        <span class="pending">未完成 {{ pendingCount }}</span>
        <span v-if="isDemo" class="demo-badge" title="demo 演示态：示例数据仅供截图与新手引导，不会被保存">示例数据</span>
      </header>

      <div class="scroll">
        <ul class="list">
          <li v-for="t in visibleTodos" :key="t.id" class="item" :class="{ done: t.done }">
            <button
              class="check"
              :class="{ on: t.done }"
              :aria-label="t.done ? '标记为未完成' : '标记为完成'"
              @click="onToggle(t)"
            >
              <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                <polyline points="5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </button>
            <button
              class="dot"
              :class="`p-${t.priority}`"
              :title="`优先级：${PRIORITY_LABEL[t.priority]}（点击切换）`"
              @click="cyclePriority(t)"
            ></button>
            <input
              v-if="editingId === t.id"
              v-model="editingText"
              class="edit"
              type="text"
              spellcheck="false"
              @keydown.enter.prevent="onEditEnter"
              @keydown.esc.prevent="cancelEdit"
              @blur="commitEdit"
            />
            <span v-else class="text" title="双击编辑" @dblclick="startEdit(t)">{{ t.text }}</span>
            <span v-if="dateBadge(t) !== ''" class="date" title="归属日">{{ dateBadge(t) }}</span>
            <span class="acts">
              <button class="act" title="编辑" @click="startEdit(t)">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                </svg>
              </button>
              <button class="act danger" title="删除" @click="onRemove(t)">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              </button>
            </span>
          </li>
        </ul>

        <div v-if="visibleTodos.length === 0" class="empty">
          <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5" />
            <polyline points="8 12.5 11 15.5 16 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <p class="e-title">{{ view === 'today' ? '今天没有待办' : '还没有任何待办' }}</p>
          <p class="e-sub">在下方输入框里添加一条，回车即创建</p>
        </div>
      </div>

      <div class="add">
        <button
          class="pri-chip"
          :class="`p-${addPriority}`"
          :title="`新任务优先级：${PRIORITY_LABEL[addPriority]}（点击切换）`"
          @click="cycleAddPriority"
        >
          {{ PRIORITY_LABEL[addPriority] }}
        </button>
        <input
          v-model="addText"
          class="add-text"
          type="text"
          placeholder="添加待办，回车即创建"
          spellcheck="false"
          @keydown.enter.prevent="onAddEnter"
        />
        <button class="btn primary" @click="onAdd">添加</button>
      </div>
    </section>

    <transition name="fade">
      <div v-if="statusText !== ''" class="toast">{{ statusText }}</div>
    </transition>
  </div>
</template>

<style scoped>
.tp {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.tp :focus-visible {
  outline: 2px solid var(--accent-dim);
  outline-offset: 1px;
}
.tasks {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  flex: none;
  height: 40px;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-raised);
  border-radius: var(--r-md);
}
.seg button {
  border: none;
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  padding: 3px 12px;
  border-radius: var(--r-sm);
  cursor: pointer;
}
.seg button.active {
  background: var(--accent-dim);
  color: var(--accent);
  font-weight: 600;
}
.pending {
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.demo-badge {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid var(--warn);
  border-radius: var(--r-sm);
  color: var(--warn);
  font-size: var(--fs-foot);
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.scroll::-webkit-scrollbar {
  width: 6px;
}
.scroll::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
.list {
  margin: 0;
  padding: var(--sp-1) 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 40px;
  padding: 0 var(--sp-2);
  border-radius: var(--r-md);
}
.item:hover,
.item:focus-within {
  background: var(--hover);
}
.check {
  flex: none;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1.5px solid var(--border);
  border-radius: 50%;
  background: transparent;
  color: var(--on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.check svg {
  opacity: 0;
}
.check:hover {
  border-color: var(--accent);
}
.check.on {
  background: var(--accent);
  border-color: var(--accent);
}
.check.on svg {
  opacity: 1;
}
/* 优先级色点：16px 命中区，视觉 6px */
.dot {
  flex: none;
  position: relative;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
}
.dot::after {
  content: '';
  position: absolute;
  inset: 5px;
  border-radius: 50%;
  background: currentColor;
}
.dot.p-high {
  color: var(--danger);
}
.dot.p-normal {
  color: var(--accent);
}
.dot.p-low {
  color: var(--fg-dim);
}
.text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-size: var(--fs-title);
}
.item.done .text {
  color: var(--fg-dim);
  text-decoration: line-through;
}
.edit {
  flex: 1;
  min-width: 0;
  height: 26px;
  border: none;
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  color: var(--fg);
  font-size: var(--fs-title);
  padding: 0 var(--sp-2);
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.date {
  flex: none;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  font-variant-numeric: tabular-nums;
}
.acts {
  flex: none;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.item:hover .acts,
.item:focus-within .acts {
  opacity: 1;
}
.act {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--fg-dim);
  border-radius: var(--r-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.act:hover {
  background: var(--hover);
  color: var(--accent);
}
.act.danger:hover {
  color: var(--danger);
}
.empty {
  padding: 48px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1);
  color: var(--fg-dim);
}
.e-title {
  margin: var(--sp-2) 0 0;
  color: var(--fg);
  font-size: var(--fs-title);
}
.e-sub {
  margin: 0;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.add {
  flex: none;
  display: flex;
  gap: var(--sp-2);
  padding-top: var(--sp-2);
}
.pri-chip {
  flex: none;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  border: none;
  background: var(--bg-raised);
  border-radius: var(--r-md);
  color: var(--fg);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.pri-chip::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--fg-dim);
}
.pri-chip.p-high::before {
  background: var(--danger);
}
.pri-chip.p-normal::before {
  background: var(--accent);
}
.add-text {
  flex: 1;
  min-width: 0;
  height: 32px;
  border: none;
  border-radius: var(--r-md);
  background: var(--bg-raised);
  color: var(--fg);
  font-size: var(--fs-input);
  padding: 0 var(--sp-3);
  outline: none;
}
.add-text::placeholder {
  color: var(--fg-dim);
}
.add-text:focus {
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.btn {
  flex: none;
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  background: var(--hover);
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.btn.primary:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(1.08);
}
.toast {
  position: absolute;
  bottom: var(--sp-2);
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  padding: 6px 14px;
  background: var(--bg-raised);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  pointer-events: none;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
