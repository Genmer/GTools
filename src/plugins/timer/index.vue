<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import { CMD_KEY, type TimerPluginCommand } from './logic/commands'
import {
  IDLE_COUNTDOWN,
  formatDuration,
  formatRemaining,
  parseDuration,
  remaining,
  type CountdownState
} from './logic/countdown'
import {
  DEFAULT_TIMER_SETTINGS,
  IDLE_POMODORO_STATE,
  formatClock,
  pausePomodoro,
  remainingMsOf,
  resumePomodoro,
  startBreak,
  startFocus,
  stopPomodoro,
  tickPomodoro,
  type PomodoroState,
  type TimerSettings
} from './logic/pomodoro'
import { dateKeyOf, parsePomodoroLog, todayCount, totalCount } from './logic/stats'
import { TIMER_EVENT, parsePersistedTimerState, type TimerSnapshot } from './logic/session'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const SETTINGS_KEY = 'settings'
const STATE_KEY = 'timer-state'
const LOG_KEY = 'pomodoro-log'

const isDemo = computed(() => props.initialCommand === 'demo')

type TimerMode = 'countdown' | 'pomodoro'
interface PanelSettings extends TimerSettings {
  lastMode: TimerMode
}

function normalizeSettings(raw: unknown): PanelSettings {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const num = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' ? v : Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(120, Math.max(1, Math.round(n)))
  }
  return {
    focusMin: num(r.focusMin, DEFAULT_TIMER_SETTINGS.focusMin),
    breakMin: num(r.breakMin, DEFAULT_TIMER_SETTINGS.breakMin),
    autoStartBreak: r.autoStartBreak !== false,
    lastMode: r.lastMode === 'pomodoro' ? 'pomodoro' : 'countdown'
  }
}

const mode = ref<TimerMode>('countdown')
const settings = ref<PanelSettings>({ focusMin: 25, breakMin: 5, autoStartBreak: true, lastMode: 'countdown' })
const countdown = ref<CountdownState>({ ...IDLE_COUNTDOWN })
const pomodoro = ref<PomodoroState>({ ...IDLE_POMODORO_STATE })
const ballVisible = ref(true)
const todayPomodoros = ref(0)
const totalPomodoros = ref(0)
const statusText = ref('')
const banner = ref<{ head: string; body: string } | null>(null)
const now = ref(Date.now())

// demo 态：冻结示例数据，交互只在内存里演算，不落 storage、不发命令
const demoCountdown = ref<CountdownState>({ status: 'paused', endAt: 0, remainingMs: 24 * 60_000 + 59_000, totalMs: 25 * 60_000, label: '泡面' })
const demoPomodoro = ref<PomodoroState>({ status: 'paused', phase: 'focus', remainingMs: 24 * 60_000 + 59_000, endAt: null, totalMs: 25 * 60_000 })

if (isDemo.value) {
  todayPomodoros.value = 3
  totalPomodoros.value = 42
}

const cdInput = ref('25m')
const cdLabel = ref('')

let offEvents: (() => void) | null = null
let clockTimer: ReturnType<typeof setInterval> | null = null
let statusTimer: ReturnType<typeof setTimeout> | null = null
let bannerTimer: ReturnType<typeof setTimeout> | null = null
let cmdSeq = 0

const activeCountdown = computed<CountdownState>(() => (isDemo.value ? demoCountdown.value : countdown.value))
const activePomodoro = computed<PomodoroState>(() => (isDemo.value ? demoPomodoro.value : pomodoro.value))
const effSettings = computed<TimerSettings>(() => ({ ...settings.value }))
const todayKey = computed(() => dateKeyOf(now.value))

const CD_PRESETS: readonly { label: string; ms: number }[] = [
  { label: '1m', ms: 60_000 },
  { label: '5m', ms: 300_000 },
  { label: '25m', ms: 1_500_000 }
]

const cdInvalid = computed(() => cdInput.value.trim() !== '' && parseDuration(cdInput.value) === null)
const cdClock = computed(() => {
  const s = activeCountdown.value
  if (s.status === 'running') return formatRemaining(remaining(s.endAt, now.value))
  if (s.status === 'paused') return formatRemaining(s.remainingMs)
  if (s.status === 'expired') return '00:00'
  const preview = parseDuration(cdInput.value) // 空闲态预览当前输入的时长
  return preview === null ? '00:00' : formatRemaining(preview)
})
const cdProgress = computed(() => {
  const s = activeCountdown.value
  if (s.totalMs <= 0) return 0
  const left = s.status === 'running' ? remaining(s.endAt, now.value) : s.status === 'paused' ? s.remainingMs : s.status === 'expired' ? 0 : s.totalMs
  return Math.min(100, Math.max(0, ((s.totalMs - left) / s.totalMs) * 100))
})

const pmClock = computed(() => {
  const s = activePomodoro.value
  if (s.status === 'idle') return formatClock(effSettings.value.focusMin * 60_000)
  return formatClock(remainingMsOf(s, now.value))
})
const pmProgress = computed(() => {
  const s = activePomodoro.value
  if (s.totalMs <= 0) return 0
  return Math.min(100, Math.max(0, ((s.totalMs - remainingMsOf(s, now.value)) / s.totalMs) * 100))
})
const phasePill = computed(() => {
  const s = activePomodoro.value
  if (s.status === 'idle') return '待命'
  const ph = s.phase === 'focus' ? '专注' : '休息'
  return s.status === 'running' ? `${ph}中` : `${ph}已暂停`
})
const pmMainText = computed(() => {
  const s = activePomodoro.value.status
  if (s === 'running') return '暂停'
  if (s === 'paused') return '继续'
  return '开始专注'
})
const sessionActive = computed(
  () => activeCountdown.value.status === 'running' || activeCountdown.value.status === 'paused' || activePomodoro.value.status !== 'idle'
)

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

function nextSeq(): number {
  cmdSeq = Math.max(Date.now(), cmdSeq + 1)
  return cmdSeq
}

async function sendCommand(cmd: TimerPluginCommand): Promise<void> {
  try {
    await props.ctx.host.storage.set(CMD_KEY, { seq: nextSeq(), cmd })
  } catch {
    flash('操作发送失败')
  }
}

// demo 态复用纯状态机本地演算，语义与 backend 一致但不产生真实计时/统计
function applyLocalCommand(cmd: TimerPluginCommand): void {
  const t = Date.now()
  switch (cmd.type) {
    case 'cd-start':
      demoPomodoro.value = stopPomodoro()
      demoCountdown.value = { status: 'running', endAt: t + cmd.ms, remainingMs: 0, totalMs: cmd.ms, label: cmd.label }
      break
    case 'pm-start':
      demoCountdown.value = { ...IDLE_COUNTDOWN }
      demoPomodoro.value = startFocus({ focusMin: cmd.focusMin }, t)
      break
    case 'pause':
      if (demoCountdown.value.status === 'running') demoCountdown.value = { ...demoCountdown.value, status: 'paused', remainingMs: remaining(demoCountdown.value.endAt, t) }
      else demoPomodoro.value = pausePomodoro(demoPomodoro.value, t)
      break
    case 'resume':
      if (demoCountdown.value.status === 'paused') demoCountdown.value = { ...demoCountdown.value, status: 'running', endAt: t + demoCountdown.value.remainingMs }
      else demoPomodoro.value = resumePomodoro(demoPomodoro.value, t)
      break
    case 'stop':
      demoCountdown.value = { ...IDLE_COUNTDOWN }
      demoPomodoro.value = stopPomodoro()
      break
    case 'skip':
      if (demoPomodoro.value.status !== 'idle') {
        demoPomodoro.value =
          demoPomodoro.value.phase === 'focus'
            ? startBreak(demoPomodoro.value, effSettings.value.breakMin, t)
            : stopPomodoro()
      } else if (demoCountdown.value.status !== 'idle') {
        demoCountdown.value = { ...IDLE_COUNTDOWN }
      }
      break
    case 'ball-toggle':
      break // 示例态无球
  }
}

function send(cmd: TimerPluginCommand): void {
  if (isDemo.value) applyLocalCommand(cmd)
  else void sendCommand(cmd)
}

async function persistSettings(): Promise<void> {
  if (isDemo.value) return
  try {
    await props.ctx.host.storage.set(SETTINGS_KEY, settings.value)
  } catch {
    // 写失败不打断交互，下次保存重试
  }
}

function switchMode(target: TimerMode): void {
  if (target === mode.value) return
  // 离开的模式有活动会话（running/paused，expired 只是收尾展示）→ 确认后终止再切
  const leavingActive =
    mode.value === 'countdown'
      ? activeCountdown.value.status === 'running' || activeCountdown.value.status === 'paused'
      : activePomodoro.value.status !== 'idle'
  if (leavingActive && !window.confirm('切换模式将终止当前计时，确定？')) return
  if (leavingActive) send({ type: 'stop' })
  mode.value = target
  settings.value.lastMode = target
  void persistSettings()
}

function applyPreset(p: { label: string; ms: number }): void {
  cdInput.value = p.label // 仅预填，不自动起跑
}

function startCountdownFromInput(): void {
  const ms = parseDuration(cdInput.value)
  if (ms === null) {
    flash('时长无法识别：支持 90s / 25m / 1h30m 或纯数字（分钟）')
    return
  }
  send({ type: 'cd-start', ms, label: cdLabel.value })
}

function onPmMainButton(): void {
  const s = activePomodoro.value.status
  if (s === 'running') send({ type: 'pause' })
  else if (s === 'paused') send({ type: 'resume' })
  else send({ type: 'pm-start', focusMin: effSettings.value.focusMin, breakMin: effSettings.value.breakMin, autoStartBreak: effSettings.value.autoStartBreak })
}

function toggleBall(): void {
  if (!sessionActive.value) {
    flash('开始计时后显示')
    return
  }
  ballVisible.value = !ballVisible.value // 乐观更新，backend 快照随后校正
  if (isDemo.value) {
    flash('示例态：悬浮球仅作展示')
    return
  }
  void sendCommand({ type: 'ball-toggle', visible: ballVisible.value })
}

async function saveSettings(): Promise<void> {
  settings.value = normalizeSettings(settings.value)
  await persistSettings()
  flash('设置已保存')
}

// query 快速设定：倒计时模式认时长（90s/25m/1h30m），番茄模式认纯数字（专注分钟），只预填不自动起跑
function applyQuery(q: string): void {
  const s = q.trim()
  if (s === '') return
  if (mode.value === 'countdown') {
    if (parseDuration(s) !== null) cdInput.value = s
  } else if (/^\d+$/.test(s)) {
    settings.value.focusMin = normalizeSettings({ focusMin: Number(s) }).focusMin
  }
}

watch(() => props.query, (q) => applyQuery(q), { immediate: true })

function applySnapshot(p: unknown): void {
  const s = p as Partial<TimerSnapshot>
  if (s === null || typeof s !== 'object') return
  if (s.countdown !== undefined) countdown.value = s.countdown
  if (s.pomodoro !== undefined) pomodoro.value = s.pomodoro
  if (typeof s.ballVisible === 'boolean') ballVisible.value = s.ballVisible
  if (typeof s.todayCount === 'number') todayPomodoros.value = s.todayCount
  if (typeof s.totalCount === 'number') totalPomodoros.value = s.totalCount
}

// 真实模式：快照里倒计时 running→expired 或番茄相位回落即视为到点（页面内兜底提示）
watch(
  () => `${countdown.value.status}|${pomodoro.value.status}|${pomodoro.value.phase}`,
  (cur, prev) => {
    if (isDemo.value) return
    const [prevCd, prevPmStatus, prevPhase] = prev.split('|')
    const [curCd] = cur.split('|')
    if (prevCd === 'running' && curCd === 'expired') {
      const label = countdown.value.label
      showBanner('⏰ 时间到！', label !== '' ? `「${label}」设定的 ${formatDuration(countdown.value.totalMs)} 已到` : `设定的 ${formatDuration(countdown.value.totalMs)} 已到`)
      return
    }
    if (prevPmStatus === 'running' && pomodoro.value.status !== 'running') {
      if (prevPhase === 'focus') showBanner('🍅 番茄完成！', '休息一下吧，喝口水走动走动')
      else showBanner('☕ 休息结束', '回来继续下一个番茄吧')
    }
  }
)

// 本地 tick：非 demo 只推进钟面（now ref）；demo 态额外演算运行中的示例计时
watch(now, () => {
  if (!isDemo.value) return
  if (demoCountdown.value.status === 'running') {
    const t = Date.now()
    if (t >= demoCountdown.value.endAt) {
      demoCountdown.value = { ...demoCountdown.value, status: 'expired', remainingMs: 0 }
      showBanner('⏰ 时间到！', `「${demoCountdown.value.label}」设定的 ${formatDuration(demoCountdown.value.totalMs)} 已到`)
    }
  }
  if (demoPomodoro.value.status === 'running') {
    const r = tickPomodoro(demoPomodoro.value, Date.now(), { breakMin: effSettings.value.breakMin, autoStartBreak: effSettings.value.autoStartBreak })
    if (r !== null) {
      demoPomodoro.value = r.state
      if (r.completed === 'focus') {
        todayPomodoros.value += 1
        totalPomodoros.value += 1
        showBanner('🍅 番茄完成！', '休息一下吧，喝口水走动走动')
      } else {
        showBanner('☕ 休息结束', '回来继续下一个番茄吧')
      }
    }
  }
})

// initialCommand 消费（命令直达/推荐条进入）
let initialCommandConsumed = false
function consumeInitialCommand(cmd?: string): void {
  if (initialCommandConsumed || cmd === undefined || cmd === '') return
  initialCommandConsumed = true
  if (cmd === 'countdown' || cmd === 'pomodoro') {
    mode.value = cmd
    settings.value.lastMode = cmd
    void persistSettings()
  }
}

async function load(): Promise<void> {
  try {
    settings.value = normalizeSettings(await props.ctx.host.storage.get(SETTINGS_KEY))
  } catch {
    settings.value = { focusMin: 25, breakMin: 5, autoStartBreak: true, lastMode: 'countdown' }
  }
  mode.value = settings.value.lastMode
  consumeInitialCommand(props.initialCommand)
  // 上面的 immediate watch 跑在 setup（mode 还是默认 countdown），lastMode/initialCommand 定完 mode 后重放一次
  applyQuery(props.query)
  // backend 可能在视图挂载前就发过快照，事件收不到，这里直读兜底
  try {
    const persisted = parsePersistedTimerState(await props.ctx.host.storage.get(STATE_KEY))
    if (persisted !== null) {
      countdown.value = persisted.countdown
      pomodoro.value = persisted.pomodoro
      ballVisible.value = persisted.ballVisible
    }
    const log = parsePomodoroLog(await props.ctx.host.storage.get(LOG_KEY))
    if (log !== null) {
      totalPomodoros.value = totalCount(log)
      todayPomodoros.value = todayCount(log, todayKey.value)
    }
  } catch {
    // 保持默认态，等 backend 事件刷新
  }
}

onMounted(() => {
  if (!isDemo.value) {
    void load()
    offEvents = props.ctx.host.events.on(TIMER_EVENT, (p) => applySnapshot(p))
  } else {
    consumeInitialCommand(props.initialCommand)
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
  <div class="timer">
    <header class="toolbar">
      <div class="seg">
        <button :class="{ active: mode === 'countdown' }" @click="switchMode('countdown')">倒计时</button>
        <button :class="{ active: mode === 'pomodoro' }" @click="switchMode('pomodoro')">番茄钟</button>
      </div>
      <span class="spacer"></span>
      <span v-if="isDemo" class="demo-badge" title="demo 演示态：示例数据仅供展示，不会被保存">示例数据</span>
      <button class="ghost" :class="{ active: ballVisible }" title="计时悬浮球（桌面常驻小球）" @click="toggleBall">悬浮球</button>
    </header>

    <section v-if="mode === 'countdown'" class="card" :class="{ running: activeCountdown.status === 'running' }">
      <div class="clock mono">{{ cdClock }}</div>
      <div class="track"><i class="fill" :style="{ width: `${cdProgress}%` }"></i></div>
      <p v-if="activeCountdown.status !== 'idle' && activeCountdown.label !== ''" class="linked" :title="activeCountdown.label">
        「{{ activeCountdown.label }}」 · 共 {{ formatDuration(activeCountdown.totalMs) }}
      </p>
      <p v-else-if="activeCountdown.status !== 'idle'" class="linked">共 {{ formatDuration(activeCountdown.totalMs) }}</p>
      <p v-else class="linked">到点发系统通知 · 窗口隐藏也在计时</p>

      <div class="controls">
        <button
          v-for="p in CD_PRESETS"
          :key="p.label"
          type="button"
          class="btn"
          :class="{ 'preset-on': cdInput === p.label }"
          @click="applyPreset(p)"
        >
          {{ p.label }}
        </button>
        <input
          v-model="cdInput"
          class="input num mono"
          type="text"
          placeholder="25m / 1h30m / 90s"
          spellcheck="false"
          @keydown.enter="startCountdownFromInput"
        />
        <input v-model="cdLabel" class="input grow" type="text" placeholder="标签（可选，如：泡面）" spellcheck="false" maxlength="120" />
      </div>
      <p v-if="cdInvalid" class="error">时长无法识别：支持 90s / 25m / 1h30m，或纯数字（按分钟）</p>

      <div class="actions">
        <template v-if="activeCountdown.status === 'running'">
          <button type="button" class="btn primary grow" @click="send({ type: 'pause' })">暂停</button>
          <button type="button" class="btn" @click="send({ type: 'stop' })">取消</button>
        </template>
        <template v-else-if="activeCountdown.status === 'paused'">
          <button type="button" class="btn primary grow" @click="send({ type: 'resume' })">继续</button>
          <button type="button" class="btn" @click="send({ type: 'stop' })">取消</button>
        </template>
        <template v-else-if="activeCountdown.status === 'expired'">
          <button type="button" class="btn primary grow" @click="send({ type: 'stop' })">知道了</button>
        </template>
        <template v-else>
          <button type="button" class="btn primary grow" @click="startCountdownFromInput">开始</button>
        </template>
      </div>

      <div v-if="activeCountdown.status === 'expired'" class="cd-banner">
        <span>⏰ 时间到！{{ activeCountdown.label !== '' ? `「${activeCountdown.label}」` : '' }}设定的 {{ formatDuration(activeCountdown.totalMs) }} 已到</span>
      </div>
    </section>

    <section v-else class="card" :class="{ running: activePomodoro.status === 'running' }">
      <div class="card-top">
        <span class="phase" :class="{ on: activePomodoro.status === 'running' }">{{ phasePill }}</span>
        <span class="spacer"></span>
        <span class="linked">专注 {{ effSettings.focusMin }} 分钟 · 休息 {{ effSettings.breakMin }} 分钟</span>
      </div>

      <div class="clock mono">{{ pmClock }}</div>
      <div class="track"><i class="fill" :style="{ width: `${pmProgress}%` }"></i></div>

      <div class="actions">
        <button type="button" class="btn primary grow" @click="onPmMainButton">{{ pmMainText }}</button>
        <button type="button" class="btn" :disabled="activePomodoro.status === 'idle'" title="回到初始待命，进度不计入统计" @click="send({ type: 'stop' })">
          重置
        </button>
        <button v-if="activePomodoro.status !== 'idle'" type="button" class="ghost" title="跳过当前阶段（不计入统计）" @click="send({ type: 'skip' })">
          跳过
        </button>
      </div>

      <div class="stats">
        <div class="stat"><span class="num">{{ todayPomodoros }}</span><span class="lbl">今日番茄</span></div>
        <div class="stat"><span class="num">{{ totalPomodoros }}</span><span class="lbl">累计完成</span></div>
      </div>

      <div class="settings">
        <label class="field">专注 <input v-model.number="settings.focusMin" class="num-input" type="number" :min="1" :max="120" /> 分</label>
        <label class="field">休息 <input v-model.number="settings.breakMin" class="num-input" type="number" :min="1" :max="120" /> 分</label>
        <label class="field"><input v-model="settings.autoStartBreak" type="checkbox" /> 专注结束自动休息</label>
        <button type="button" class="btn" @click="saveSettings">保存</button>
      </div>
    </section>

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
.timer {
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  color: var(--fg);
  font-size: var(--fs-title);
}
.timer :focus-visible {
  outline: 2px solid var(--accent-dim);
  outline-offset: 1px;
}
.toolbar {
  flex: none;
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
.spacer {
  flex: 1;
}
.demo-badge {
  padding: 2px 8px;
  border: 1px solid var(--warn);
  border-radius: var(--r-sm);
  color: var(--warn);
  font-size: var(--fs-foot);
}

.card {
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
  gap: var(--sp-2);
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
.clock {
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
.linked {
  margin: 0;
  min-height: 18px;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}

.controls {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.input {
  height: 32px;
  box-sizing: border-box;
  background: var(--bg);
  color: var(--fg);
  border: none;
  border-radius: var(--r-md);
  padding: 0 10px;
  font-size: var(--fs-title);
  outline: none;
}
.input:focus {
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.num {
  width: 108px;
  text-align: center;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-sub);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.btn {
  flex: none;
  height: 32px;
  padding: 0 14px;
  background: transparent;
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
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
.btn.preset-on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}
.grow {
  flex: 1;
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

.cd-banner {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: 8px var(--sp-3);
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: var(--r-md);
  font-size: var(--fs-sub);
  font-weight: 600;
}

.stats {
  display: flex;
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
