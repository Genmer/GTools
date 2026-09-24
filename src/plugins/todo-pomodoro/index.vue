<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import type { TimerCommand } from './logic/commands'
import { CMD_KEY } from './logic/commands'
import type { TimerSettings, TimerState } from './logic/timer'
import {
  DEFAULT_TIMER_SETTINGS,
  formatClock,
  normalizeTimerSettings,
  parsePersistedTimer,
  pauseTimer,
  remainingMsOf,
  resumeTimer,
  startBreak,
  startFocus,
  stopTimer,
  tickTimer
} from './logic/timer'
import { parsePomodoroLog, todayCount, todoCounts, totalCount } from './logic/stats'
import { TIMER_EVENT } from './backend'
import type { TimerSnapshot } from './backend'
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
const SETTINGS_KEY = 'settings'

const isDemo = computed(() => props.initialCommand === 'demo')

const todos = ref<Todo[]>([])
const view = ref<'today' | 'all'>('today')
const addText = ref('')
const addPriority = ref<Priority>('normal')
const settings = ref<TimerSettings>({ ...DEFAULT_TIMER_SETTINGS })
const timer = ref<TimerState>({ status: 'idle', phase: 'focus', remainingMs: 0, endAt: null, totalMs: 0, linkedTodoId: null, linkedTodoTitle: '' })
const demoTimer = ref<TimerState>({ status: 'idle', phase: 'focus', remainingMs: 0, endAt: null, totalMs: 0, linkedTodoId: null, linkedTodoTitle: '' })
const noteVisible = ref(true)
const countsByTodo = ref<Record<string, number>>({})
const todayPomodoros = ref(0)
const totalPomodoros = ref(0)
const showSettings = ref(false)
const editingId = ref<string | null>(null)
const editingText = ref('')
const statusText = ref('')
const banner = ref<{ head: string; body: string } | null>(null)
const now = ref(Date.now())

let offEvents: (() => void) | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null
let statusTimer: ReturnType<typeof setTimeout> | null = null
let bannerTimer: ReturnType<typeof setTimeout> | null = null
let cmdSeq = 0

// demo 态用固定示例数据，交互只在内存里生效，不落 storage、不驱动真实 backend
if (isDemo.value) {
  const today = dateKeyOf(now.value)
  todos.value = [
    { id: 'demo-1', text: '梳理四期 UI 复刻清单', priority: 'high', done: false, date: today, completedOn: null, createdAt: 3, updatedAt: 3 },
    { id: 'demo-2', text: '走查番茄钟交互闭环', priority: 'low', done: false, date: today, completedOn: null, createdAt: 2, updatedAt: 2 },
    { id: 'demo-3', text: '对齐 uTools 视觉规范', priority: 'normal', done: true, date: today, completedOn: today, createdAt: 1, updatedAt: 1 }
  ]
  demoTimer.value = {
    status: 'paused',
    phase: 'focus',
    remainingMs: 24 * 60_000 + 59_000,
    endAt: null,
    totalMs: 25 * 60_000,
    linkedTodoId: 'demo-1',
    linkedTodoTitle: '梳理四期 UI 复刻清单'
  }
  countsByTodo.value = { 'demo-1': 2 }
  todayPomodoros.value = 3
  totalPomodoros.value = 42
}

const todayKey = computed(() => dateKeyOf(now.value))
const visibleTodos = computed(() => todosForView(todos.value, view.value, todayKey.value))
const activeTimer = computed<TimerState>(() => (isDemo.value ? demoTimer.value : timer.value))
// 输入框清空成 '' 时 v-model.number 会给出空串，钟面/命令一律走规整后的值防 NaN
const effSettings = computed<TimerSettings>(() => normalizeTimerSettings(settings.value))
const remaining = computed(() => remainingMsOf(activeTimer.value, now.value))
const clockText = computed(() =>
  activeTimer.value.status === 'idle' ? formatClock(effSettings.value.focusMin * 60_000) : formatClock(remaining.value)
)
const progressPct = computed(() => {
  const s = activeTimer.value
  if (s.totalMs <= 0) return 0
  return Math.min(100, Math.max(0, ((s.totalMs - remaining.value) / s.totalMs) * 100))
})
const phasePill = computed(() => {
  const s = activeTimer.value
  if (s.status === 'idle') return '待命'
  const ph = s.phase === 'focus' ? '专注' : '休息'
  return s.status === 'running' ? `${ph}中` : `${ph}已暂停`
})
const subLine = computed(() => {
  if (activeTimer.value.status !== 'idle' && activeTimer.value.linkedTodoTitle !== '') return activeTimer.value.linkedTodoTitle
  if (activeTimer.value.status === 'idle') return `专注 ${effSettings.value.focusMin} 分钟 · 休息 ${effSettings.value.breakMin} 分钟`
  return '时间到会在页面内提醒你'
})
const pendingCount = computed(() => todos.value.filter((t) => !t.done).length)
const mainButtonText = computed(() => {
  if (activeTimer.value.status === 'running') return '暂停'
  if (activeTimer.value.status === 'paused') return '继续'
  return '开始专注'
})

function flash(text: string): void {
  statusText.value = text
  if (statusTimer !== null) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => {
    statusText.value = ''
  }, 1600)
}

// 页面内到点提示（不依赖系统通知）：8 秒自动消失，也可手动关
function showBanner(head: string, body: string): void {
  banner.value = { head, body }
  if (bannerTimer !== null) clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => {
    banner.value = null
  }, 8000)
}

function closeBanner(): void {
  banner.value = null
  if (bannerTimer !== null) clearTimeout(bannerTimer)
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

async function load(): Promise<void> {
  try {
    todos.value = parsePersistedTodos(await props.ctx.host.storage.get(TODOS_KEY)) ?? []
  } catch {
    todos.value = []
  }
  try {
    settings.value = normalizeTimerSettings(await props.ctx.host.storage.get(SETTINGS_KEY))
  } catch {
    settings.value = { ...DEFAULT_TIMER_SETTINGS }
  }
  // backend 可能在视图挂载前就发过快照，事件收不到，这里直读兜底
  try {
    const persisted = parsePersistedTimer(await props.ctx.host.storage.get('timer'))
    if (persisted !== null) {
      timer.value = persisted.state
      noteVisible.value = persisted.noteVisible
    }
    const log = parsePomodoroLog(await props.ctx.host.storage.get('pomodoro-log'))
    if (log !== null) {
      countsByTodo.value = todoCounts(log)
      totalPomodoros.value = totalCount(log)
      todayPomodoros.value = todayCount(log, todayKey.value)
    }
  } catch {
    // 保持默认态，等 backend 事件刷新
  }
}

function applySnapshot(p: unknown): void {
  const s = p as Partial<TimerSnapshot>
  if (s === null || typeof s !== 'object') return
  if (s.state !== undefined) timer.value = s.state
  if (s.noteVisible !== undefined) noteVisible.value = s.noteVisible
  if (typeof s.todayCount === 'number') todayPomodoros.value = s.todayCount
  if (typeof s.totalCount === 'number') totalPomodoros.value = s.totalCount
  if (s.countsByTodo !== undefined && s.countsByTodo !== null) countsByTodo.value = s.countsByTodo
}

function nextSeq(): number {
  cmdSeq = Math.max(Date.now(), cmdSeq + 1)
  return cmdSeq
}

async function sendCommand(cmd: TimerCommand): Promise<void> {
  try {
    await props.ctx.host.storage.set(CMD_KEY, { seq: nextSeq(), cmd })
  } catch {
    flash('操作发送失败')
  }
}

// demo 态复用纯状态机本地演算，语义与 backend 一致但不产生真实计时/统计
function applyLocalCommand(cmd: TimerCommand): void {
  const t = Date.now()
  switch (cmd.type) {
    case 'start':
      demoTimer.value = startFocus(demoTimer.value, cmd, t)
      break
    case 'pause':
      demoTimer.value = pauseTimer(demoTimer.value, t)
      break
    case 'resume':
      demoTimer.value = resumeTimer(demoTimer.value, t)
      break
    case 'stop':
      demoTimer.value = stopTimer()
      break
    case 'skip':
      if (demoTimer.value.status !== 'idle') {
        demoTimer.value =
          demoTimer.value.phase === 'focus'
            ? startBreak(demoTimer.value, effSettings.value.breakMin, t)
            : stopTimer()
      }
      break
    case 'note-toggle':
      noteVisible.value = cmd.visible
      break
  }
}

function send(cmd: TimerCommand): void {
  if (isDemo.value) applyLocalCommand(cmd)
  else void sendCommand(cmd)
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

function startFocusFor(t: Todo | null): void {
  send({
    type: 'start',
    todoId: t === null ? null : t.id,
    todoTitle: t === null ? '' : t.text,
    focusMin: effSettings.value.focusMin,
    breakMin: effSettings.value.breakMin,
    autoStartBreak: effSettings.value.autoStartBreak
  })
}

function onMainButton(): void {
  const s = activeTimer.value.status
  if (s === 'running') send({ type: 'pause' })
  else if (s === 'paused') send({ type: 'resume' })
  else startFocusFor(null)
}

function toggleNote(): void {
  noteVisible.value = !noteVisible.value // 乐观更新，backend 快照随后校正
  if (isDemo.value) {
    flash('示例态：便签仅作展示')
    return
  }
  void sendCommand({ type: 'note-toggle', visible: noteVisible.value })
}

async function saveSettings(): Promise<void> {
  settings.value = normalizeTimerSettings(settings.value)
  if (isDemo.value) {
    flash('示例设置已生效')
    return
  }
  try {
    await props.ctx.host.storage.set(SETTINGS_KEY, settings.value)
    flash('设置已保存')
  } catch {
    flash('设置保存失败')
  }
}

function pomodorosOf(t: Todo): number {
  return countsByTodo.value[t.id] ?? 0
}

function dateBadge(t: Todo): string {
  return t.date === todayKey.value ? '' : t.date.slice(5)
}

// 真实模式：backend 快照里阶段回落即视为到点（含 focus→break 自动衔接）
watch(
  () => `${timer.value.status}|${timer.value.phase}`,
  (cur, prev) => {
    if (!prev.startsWith('running')) return
    const [, prevPhase] = prev.split('|')
    const [curStatus, curPhase] = cur.split('|')
    const stillSame = curStatus === 'running' && curPhase === prevPhase
    if (stillSame) return
    if (prevPhase === 'focus') showBanner('🍅 番茄完成！', '休息一下吧，喝口水走动走动')
    else showBanner('☕ 休息结束', '回来继续下一个番茄吧')
  }
)

// demo 态：now 每 500ms 走一步，充当本地 tick
watch(now, () => {
  if (!isDemo.value || demoTimer.value.status !== 'running') return
  const r = tickTimer(demoTimer.value, now.value, {
    breakMin: effSettings.value.breakMin,
    autoStartBreak: effSettings.value.autoStartBreak
  })
  if (r === null) return
  demoTimer.value = r.state
  if (r.completed === 'focus') {
    todayPomodoros.value += 1
    totalPomodoros.value += 1
    showBanner('🍅 番茄完成！', '休息一下吧，喝口水走动走动')
  } else {
    showBanner('☕ 休息结束', '回来继续下一个番茄吧')
  }
})

onMounted(() => {
  if (!isDemo.value) {
    void load()
    offEvents = props.ctx.host.events.on(TIMER_EVENT, (p) => applySnapshot(p))
  }
  clockTimer = setInterval(() => {
    now.value = Date.now()
  }, 500)
})

onUnmounted(() => {
  offEvents?.()
  if (clockTimer !== null) clearInterval(clockTimer)
  if (statusTimer !== null) clearTimeout(statusTimer)
  if (bannerTimer !== null) clearTimeout(bannerTimer)
})
</script>

<template>
  <div class="tp">
    <div class="layout">
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
              <span v-if="pomodorosOf(t) > 0" class="pomo" title="已完成番茄数">🍅×{{ pomodorosOf(t) }}</span>
              <span v-if="dateBadge(t) !== ''" class="date" title="归属日">{{ dateBadge(t) }}</span>
              <span class="acts">
                <button v-if="!t.done" class="act" title="专注此待办" @click="startFocusFor(t)">
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <polygon points="8 5 19 12 8 19" fill="currentColor" />
                  </svg>
                </button>
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

      <aside class="card" :class="{ running: activeTimer.status === 'running' }">
        <div class="card-top">
          <span class="phase" :class="{ on: activeTimer.status === 'running' }">{{ phasePill }}</span>
          <span class="spacer"></span>
          <button class="ghost" :class="{ active: noteVisible }" title="便签悬浮小窗（倒计时常驻桌面）" @click="toggleNote">便签</button>
          <button class="ghost" :class="{ active: showSettings }" title="专注 / 休息时长" @click="showSettings = !showSettings">时长</button>
        </div>

        <p class="linked" :title="subLine">{{ subLine }}</p>

        <div class="clock">{{ clockText }}</div>
        <div class="track"><i class="fill" :style="{ width: `${progressPct}%` }"></i></div>

        <div class="actions">
          <button class="btn primary grow" @click="onMainButton">{{ mainButtonText }}</button>
          <button class="btn" :disabled="activeTimer.status === 'idle'" title="回到初始待命，进度不计入统计" @click="send({ type: 'stop' })">
            重置
          </button>
          <button v-if="activeTimer.status !== 'idle'" class="ghost" title="跳过当前阶段（不计入统计）" @click="send({ type: 'skip' })">
            跳过
          </button>
        </div>

        <div class="stats">
          <div class="stat"><span class="num">{{ todayPomodoros }}</span><span class="lbl">今日番茄</span></div>
          <div class="stat"><span class="num">{{ totalPomodoros }}</span><span class="lbl">累计完成</span></div>
        </div>

        <div v-if="showSettings" class="settings">
          <label class="field">专注 <input v-model.number="settings.focusMin" class="num-input" type="number" :min="1" :max="120" /> 分</label>
          <label class="field">休息 <input v-model.number="settings.breakMin" class="num-input" type="number" :min="1" :max="120" /> 分</label>
          <label class="field"><input v-model="settings.autoStartBreak" type="checkbox" /> 专注结束自动休息</label>
          <button class="btn" @click="saveSettings">保存</button>
        </div>
      </aside>
    </div>

    <div v-if="banner !== null" class="banner" role="status">
      <div class="b-main">
        <p class="b-head">{{ banner.head }}</p>
        <p class="b-body">{{ banner.body }}</p>
      </div>
      <button class="b-close" title="关闭提醒" @click="closeBanner">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </div>

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
.layout {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--sp-4);
}

/* ---------- 左列：任务 ---------- */
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
.pomo,
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

/* ---------- 右列：番茄钟卡 ---------- */
.card {
  flex: none;
  width: 264px;
  align-self: flex-start;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-4);
  background: var(--bg-raised);
  border-radius: var(--r-lg);
}
.card-top {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}
.spacer {
  flex: 1;
}
.phase {
  padding: 2px 8px;
  border-radius: var(--r-sm);
  background: var(--hover);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.phase.on {
  background: var(--accent-dim);
  color: var(--accent);
  font-weight: 600;
}
.ghost {
  height: 24px;
  padding: 0 8px;
  border: none;
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  border-radius: var(--r-sm);
  cursor: pointer;
}
.ghost:hover {
  background: var(--hover);
  color: var(--fg);
}
.ghost.active {
  background: var(--accent-dim);
  color: var(--accent);
}
.linked {
  margin: 0;
  min-height: 18px;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.clock {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 46px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 2px;
  line-height: 1.1;
  text-align: center;
  color: var(--fg);
}
.card.running .clock {
  color: var(--accent);
}
.track {
  height: 4px;
  border-radius: 2px;
  background: var(--hover);
  overflow: hidden;
}
.fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  transition: width 0.3s linear;
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.stats {
  display: flex;
  margin-top: var(--sp-1);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border);
}
.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.stat + .stat {
  border-left: 1px solid var(--border);
}
.num {
  color: var(--fg);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.stat:first-child .num {
  color: var(--accent);
}
.lbl {
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.settings {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2) var(--sp-3);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border);
  color: var(--fg);
  font-size: var(--fs-sub);
}
.field {
  display: flex;
  align-items: center;
  gap: 4px;
}
.num-input {
  width: 52px;
  height: 28px;
  border: none;
  border-radius: var(--r-sm);
  background: var(--bg);
  box-shadow: 0 0 0 1px var(--border);
  color: var(--fg);
  text-align: center;
  font-size: var(--fs-sub);
  outline: none;
}
.num-input:focus {
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.settings input[type='checkbox'] {
  accent-color: var(--accent);
}

/* ---------- 通用按钮（§2）---------- */
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
.btn:disabled {
  opacity: 0.45;
  cursor: default;
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
.grow {
  flex: 1;
}

/* ---------- 页面内提示 ---------- */
.banner {
  position: absolute;
  top: var(--sp-2);
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  max-width: 92%;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: 10px 14px;
  background: var(--bg-raised);
  border: 1px solid var(--accent);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
}
.b-main {
  min-width: 0;
}
.b-head {
  margin: 0;
  color: var(--accent);
  font-size: var(--fs-title);
  font-weight: 600;
}
.b-body {
  margin: 2px 0 0;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.b-close {
  flex: none;
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
.b-close:hover {
  background: var(--hover);
  color: var(--fg);
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
