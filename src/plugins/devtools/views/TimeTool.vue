<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { dateToTs, formatDate, tsToDate } from './logic/time'
import { useCopyFeedback } from './copy'

const nowTs = ref('')
let timer: ReturnType<typeof setInterval> | null = null

const tsInput = ref(String(Math.floor(Date.now() / 1000)))
const unit = ref<'s' | 'ms'>('s')
const dateResult = ref('')
const dateErr = ref(false)

const dateInput = ref(formatDate(new Date()))
const dateError = ref('')
const tsResult = ref<{ s: number; ms: number } | null>(null)
const { msg: copyMsg, copy } = useCopyFeedback()

function tick(): void {
  nowTs.value = `${Math.floor(Date.now() / 1000)} s / ${Date.now()} ms`
}
onMounted(() => {
  tick()
  timer = setInterval(tick, 1000) // 窗口隐藏被节流无碍，可见时立即校准
})
onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function convertTs(): void {
  const n = Number(tsInput.value.trim())
  if (!Number.isFinite(n)) {
    dateResult.value = '请输入合法数字'
    dateErr.value = true
    return
  }
  const d = tsToDate(n, unit.value)
  if (d === null) {
    dateResult.value = '时间戳超出可表示范围'
    dateErr.value = true
    return
  }
  dateResult.value = formatDate(d)
  dateErr.value = false
}

function convertDate(): void {
  const d = new Date(dateInput.value.replace(' ', 'T'))
  if (isNaN(d.getTime())) {
    tsResult.value = null
    dateError.value = '请输入合法日期时间'
    return
  }
  dateError.value = ''
  tsResult.value = dateToTs(d)
}

function onEnter(e: KeyboardEvent, run: () => void): void {
  if (e.isComposing) return // 输入法组合态的 Enter 只上屏
  run()
}
</script>

<template>
  <div class="tool">
    <p class="muted">当前时间戳：{{ nowTs }}</p>
    <div class="bar">
      <input v-model="tsInput" type="text" placeholder="时间戳" @keydown.enter="onEnter($event, convertTs)" />
      <select v-model="unit">
        <option value="s">秒</option>
        <option value="ms">毫秒</option>
      </select>
      <button class="btn" @click="convertTs">转日期</button>
      <span v-if="dateResult" :class="dateErr ? 'err' : 'ok'">{{ dateResult }}</span>
    </div>
    <div class="bar">
      <input v-model="dateInput" type="text" placeholder="2026-01-01 12:00:00" @keydown.enter="onEnter($event, convertDate)" />
      <button class="btn" @click="convertDate">转时间戳</button>
      <span v-if="dateError !== ''" class="err">✗ {{ dateError }}</span>
      <template v-else-if="tsResult">
        <span class="ok">s: {{ tsResult.s }}</span>
        <span class="ok">ms: {{ tsResult.ms }}</span>
        <button class="btn" @click="copy(String(tsResult.s))">复制秒</button>
        <span v-if="copyMsg !== ''" :class="copyMsg === '复制失败' ? 'err' : 'ok'">{{ copyMsg }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
@import './tool.css';
</style>
