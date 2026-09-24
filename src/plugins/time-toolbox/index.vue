<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import {
  DEMO_MS,
  type RelUnit,
  formatZoned,
  humanizeDistance,
  nowFormats,
  parseLocalDateTime,
  parseTimestamp,
  relativeMs,
  toDatetimeLocalValue,
  toIso,
  zoneRows
} from './logic/time'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

// demo 态：initialCommand === 'demo' 时全部区块渲染冻结的稳定示例数据
const demo = computed(() => props.initialCommand === 'demo')

const nowMs = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  tick = setInterval(() => (nowMs.value = Date.now()), 1000)
})
onBeforeUnmount(() => {
  if (tick !== undefined) clearInterval(tick)
})

const baseMs = computed(() => (demo.value ? DEMO_MS : nowMs.value))

const flash = ref<{ key: string; msg: string } | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => {
  if (flashTimer !== undefined) clearTimeout(flashTimer)
})

function stateOf(key: string): string {
  return flash.value !== null && flash.value.key === key ? flash.value.msg : ''
}

async function copy(text: string, key: string): Promise<void> {
  try {
    await props.ctx.host.clipboard.writeText(text)
    flash.value = { key, msg: '已复制' }
  } catch {
    flash.value = { key, msg: '复制失败' }
  }
  if (flashTimer !== undefined) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = null), 1500)
}

// ① 当前时间多格式
const nowRows = computed(() => nowFormats(baseMs.value))

// ② 时间戳 → 日期
const tsInput = ref('')
const parsed = computed(() => parseTimestamp(tsInput.value))
const tsInvalid = computed(() => tsInput.value.trim() !== '' && parsed.value === null)

// ③ 日期 → 时间戳
const dateInput = ref('')
const dateTs = computed(() => parseLocalDateTime(dateInput.value))

function resetDateInput(): void {
  // demo 与卡片①共用 DEMO_MS，避免两卡示例时刻自相矛盾
  dateInput.value = toDatetimeLocalValue(demo.value ? DEMO_MS : Date.now())
}

// ④ 相对时间计算
const relAmountText = ref('7')
const relUnit = ref<RelUnit>('day')
const relDir = ref<'ago' | 'later'>('later')
const relAmount = computed(() => {
  const n = Number(relAmountText.value)
  return relAmountText.value.trim() !== '' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
})
const relResult = computed(() =>
  relAmount.value === null ? null : relativeMs(baseMs.value, relAmount.value, relUnit.value, relDir.value)
)

const relUnitLabels: Record<RelUnit, string> = { minute: '分钟', hour: '小时', day: '天', week: '周' }
const relFormula = computed(() => {
  if (relAmount.value === null) return ''
  return `${relAmount.value} ${relUnitLabels[relUnit.value]}${relDir.value === 'ago' ? '前' : '后'}`
})

// ⑤ 常用时区对照
const zoneTable = computed(() => zoneRows(baseMs.value))
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone

// 初始非空默认态（demo 用固定示例，正常态用当前时间）
tsInput.value = demo.value ? String(Math.floor(DEMO_MS / 1000)) : String(Math.floor(Date.now() / 1000))
resetDateInput()

// 深链/搜索框剩余输入直达：纯数字填②，日期时间填③
watch(
  () => props.query,
  (q) => {
    const s = q.trim()
    if (s === '') return
    if (parseTimestamp(s) !== null) tsInput.value = s
    else if (parseLocalDateTime(s) !== null) dateInput.value = s.replace(' ', 'T')
  },
  { immediate: true }
)
</script>

<template>
  <div class="time-toolbox">
    <div v-if="demo" class="demo-banner">示例模式：以下均为固定示例数据，仅供展示</div>

    <section class="card">
      <header class="card-head">
        <span class="idx">1</span>
        <h3 class="card-title">当前时间</h3>
        <span v-if="demo" class="chip">示例</span>
        <span class="spacer"></span>
        <span class="hint">点击行复制</span>
      </header>
      <div class="fmt-list">
        <button
          v-for="r in nowRows"
          :key="r.key"
          type="button"
          class="fmt-row"
          @click="copy(r.value, `now-${r.key}`)"
        >
          <span class="fmt-label">{{ r.label }}</span>
          <span class="fmt-value mono">{{ r.value }}</span>
          <span class="fmt-state">{{ stateOf(`now-${r.key}`) }}</span>
        </button>
      </div>
    </section>

    <div class="grid-2">
      <section class="card">
        <header class="card-head">
          <span class="idx">2</span>
          <h3 class="card-title">时间戳 → 日期</h3>
          <span v-if="parsed" class="chip">识别为{{ parsed.unit === 'ms' ? '毫秒' : '秒' }}</span>
        </header>
        <input
          v-model="tsInput"
          class="input mono"
          type="text"
          placeholder="如 1699999999 或 1699999999999"
          spellcheck="false"
        />
        <p v-if="tsInvalid" class="error">无法识别：仅支持数字时间戳（秒 / 毫秒）</p>
        <p v-else-if="parsed === null" class="hint-inline">输入时间戳，自动识别秒 / 毫秒并转换</p>
        <div v-else class="fmt-list">
          <button type="button" class="fmt-row" @click="copy(formatZoned(parsed.ts), 'ts-local')">
            <span class="fmt-label">本地时间</span>
            <span class="fmt-value mono">{{ formatZoned(parsed.ts) }}</span>
            <span class="fmt-state">{{ stateOf('ts-local') }}</span>
          </button>
          <button type="button" class="fmt-row" @click="copy(formatZoned(parsed.ts, 'UTC'), 'ts-utc')">
            <span class="fmt-label">UTC 时间</span>
            <span class="fmt-value mono">{{ formatZoned(parsed.ts, 'UTC') }}</span>
            <span class="fmt-state">{{ stateOf('ts-utc') }}</span>
          </button>
          <button type="button" class="fmt-row" @click="copy(toIso(parsed.ts), 'ts-iso')">
            <span class="fmt-label">ISO 8601</span>
            <span class="fmt-value mono">{{ toIso(parsed.ts) }}</span>
            <span class="fmt-state">{{ stateOf('ts-iso') }}</span>
          </button>
          <button type="button" class="fmt-row" @click="copy(String(parsed.ts), 'ts-ms')">
            <span class="fmt-label">Unix 毫秒</span>
            <span class="fmt-value mono">{{ parsed.ts }}</span>
            <span class="fmt-state">{{ stateOf('ts-ms') }}</span>
          </button>
          <p class="hint-inline">相对现在：{{ humanizeDistance(parsed.ts, baseMs) }}</p>
        </div>
      </section>

      <section class="card">
        <header class="card-head">
          <span class="idx">3</span>
          <h3 class="card-title">日期 → 时间戳</h3>
          <span v-if="demo" class="chip">示例</span>
        </header>
        <div class="controls">
          <input v-model="dateInput" class="input grow" type="datetime-local" />
          <button type="button" class="btn" @click="resetDateInput">现在</button>
        </div>
        <p v-if="dateTs === null" class="error">日期时间不完整或非法</p>
        <div v-else class="fmt-list">
          <button type="button" class="fmt-row" @click="copy(String(Math.floor(dateTs / 1000)), 'date-s')">
            <span class="fmt-label">Unix 秒</span>
            <span class="fmt-value mono">{{ Math.floor(dateTs / 1000) }}</span>
            <span class="fmt-state">{{ stateOf('date-s') }}</span>
          </button>
          <button type="button" class="fmt-row" @click="copy(String(dateTs), 'date-ms')">
            <span class="fmt-label">Unix 毫秒</span>
            <span class="fmt-value mono">{{ dateTs }}</span>
            <span class="fmt-state">{{ stateOf('date-ms') }}</span>
          </button>
          <button type="button" class="fmt-row" @click="copy(formatZoned(dateTs), 'date-local')">
            <span class="fmt-label">本地时间</span>
            <span class="fmt-value mono">{{ formatZoned(dateTs) }}</span>
            <span class="fmt-state">{{ stateOf('date-local') }}</span>
          </button>
        </div>
        <p class="hint-inline">按本机时区（{{ localZone }}）解析</p>
      </section>
    </div>

    <section class="card">
      <header class="card-head">
        <span class="idx">4</span>
        <h3 class="card-title">相对时间计算</h3>
        <span v-if="demo" class="chip">示例</span>
        <span class="spacer"></span>
        <span v-if="relFormula !== ''" class="hint">基准 {{ relFormula }}</span>
      </header>
      <div class="controls">
        <select v-model="relDir" class="input select">
          <option value="later">之后</option>
          <option value="ago">之前</option>
        </select>
        <input v-model="relAmountText" class="input num mono" type="number" min="0" step="1" placeholder="N" />
        <select v-model="relUnit" class="input select">
          <option value="minute">分钟</option>
          <option value="hour">小时</option>
          <option value="day">天</option>
          <option value="week">周</option>
        </select>
      </div>
      <p v-if="relAmount === null" class="error">请输入不小于 0 的数字</p>
      <div v-else-if="relResult !== null" class="fmt-list">
        <button type="button" class="fmt-row" @click="copy(formatZoned(relResult), 'rel-time')">
          <span class="fmt-label">目标时间</span>
          <span class="fmt-value mono">{{ formatZoned(relResult) }}</span>
          <span class="fmt-state">{{ stateOf('rel-time') }}</span>
        </button>
        <button type="button" class="fmt-row" @click="copy(String(Math.floor(relResult / 1000)), 'rel-s')">
          <span class="fmt-label">Unix 秒</span>
          <span class="fmt-value mono">{{ Math.floor(relResult / 1000) }}</span>
          <span class="fmt-state">{{ stateOf('rel-s') }}</span>
        </button>
      </div>
    </section>

    <section class="card">
      <header class="card-head">
        <span class="idx">5</span>
        <h3 class="card-title">常用时区对照</h3>
        <span v-if="demo" class="chip">示例</span>
        <span class="spacer"></span>
        <span class="hint">当前时刻 · 每秒刷新 · 点击行复制</span>
      </header>
      <div class="zone-grid">
        <div class="zone-row zone-head">
          <span>城市</span>
          <span>日期</span>
          <span>时间</span>
          <span>星期</span>
          <span>UTC 偏移</span>
          <span>对北京</span>
        </div>
        <button
          v-for="z in zoneTable"
          :key="z.id"
          type="button"
          class="zone-row"
          @click="copy(`${z.label} ${z.date} ${z.time} (UTC${z.offset})`, `zone-${z.id}`)"
        >
          <span class="zone-city">{{ z.label }}</span>
          <span class="mono">{{ z.date }}</span>
          <span class="mono">{{ z.time }}</span>
          <span>{{ z.weekday }}</span>
          <span class="mono">{{ z.offset }}</span>
          <span class="zone-delta">
            {{ z.delta }}
            <em v-if="stateOf(`zone-${z.id}`) !== ''">{{ stateOf(`zone-${z.id}`) }}</em>
          </span>
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.time-toolbox {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  color: var(--fg);
  font-size: var(--fs-title);
}
.demo-banner {
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: var(--r-md);
  padding: 6px var(--sp-3);
  font-size: var(--fs-sub);
}
/* 层级用底色差表达（§1.1）：卡片 raised、控件回退 --bg */
.card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  background: var(--bg-raised);
  border-radius: var(--r-lg);
  padding: var(--sp-3) var(--sp-4);
}
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--sp-3);
}
.card-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.idx {
  flex: none;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  background: var(--accent-dim);
  color: var(--accent);
  font-size: var(--fs-foot);
}
.card-title {
  margin: 0;
  font-size: var(--fs-title);
  font-weight: 600;
}
.spacer {
  flex: 1;
}
.hint {
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.chip {
  flex: none;
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: var(--r-sm);
  padding: 1px 6px;
  font-size: var(--fs-foot);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
.grow {
  flex: 1;
  min-width: 0;
}
.num {
  width: 88px;
  text-align: center;
}
.select {
  width: auto;
  font-size: var(--fs-sub);
  cursor: pointer;
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
.btn:hover {
  background: var(--hover);
}
.controls {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.fmt-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.fmt-row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  height: 34px;
  padding: 0 var(--sp-2);
  background: none;
  border: none;
  border-radius: var(--r-sm);
  color: inherit;
  font-size: inherit;
  text-align: left;
  cursor: pointer;
}
.fmt-row:hover {
  background: var(--hover);
}
.fmt-label {
  flex: none;
  width: 72px;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.fmt-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fmt-state {
  flex: none;
  min-width: 44px;
  text-align: right;
  color: var(--accent);
  font-size: var(--fs-foot);
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: var(--fs-sub);
}
.hint-inline {
  margin: 2px 0 0;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.zone-grid {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.zone-row {
  display: grid;
  grid-template-columns: 56px 1.2fr 1.2fr 44px 72px 88px;
  align-items: center;
  gap: var(--sp-2);
  width: 100%;
  height: 34px;
  padding: 0 var(--sp-2);
  background: none;
  border: none;
  border-radius: var(--r-sm);
  color: inherit;
  font-size: var(--fs-sub);
  text-align: left;
  cursor: pointer;
}
button.zone-row:hover {
  background: var(--hover);
}
.zone-head {
  height: 26px;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  cursor: default;
}
.zone-city {
  color: var(--fg);
  font-size: var(--fs-title);
}
.zone-delta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-1);
  color: var(--fg-dim);
}
.zone-delta em {
  font-style: normal;
  color: var(--accent);
}
</style>
