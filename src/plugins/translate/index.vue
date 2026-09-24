<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ApiServiceStatus, PluginContext } from '@sdk/api'
import {
  DEFAULT_PREFS,
  DEMO_INPUT,
  DEMO_RESULT,
  DIRECTION_OPTIONS,
  PREFS_STORAGE_KEY,
  langLabel,
  normalizePrefs,
  resolveLangPair,
  swapDirection
} from './logic'
import type { TranslateDirection, TranslatePrefs } from './logic'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const DEFAULT_ENGINE_TAB = '默认引擎'
const BUILTIN_MYMEMORY_ID = 'builtin:mymemory'

// demo 态（initialCommand === 'demo'）：稳定示例、零网络请求，任何编辑动作即退出
const isDemo = ref(props.initialCommand === 'demo')
const input = ref(isDemo.value ? DEMO_INPUT : '')
const result = ref(isDemo.value ? DEMO_RESULT : '')
const direction = ref<TranslateDirection>('auto')
const lastPair = ref<{ from: string; to: string } | null>(isDemo.value ? resolveLangPair('auto', DEMO_INPUT) : null)
const loading = ref(false)
const error = ref('')
const copied = ref(false)
const tip = ref('')
// 实际产出当前译文的 provider（页脚署名用；engineId 只是用户选择，回退时两者不同）
const servedBy = ref('')

const statusData = ref<ApiServiceStatus | null>(null)
// '' = 默认引擎（不指定 providerId，主进程按全局 active 回退）
const engineId = ref('')
const engineChosen = ref(false)

const inputEl = ref<HTMLTextAreaElement | null>(null)

// 请求序号守卫：防抖期间新请求先返回时不让旧结果覆盖新状态
let requestSeq = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let tipTimer: ReturnType<typeof setTimeout> | undefined
let copiedTimer: ReturnType<typeof setTimeout> | undefined
let voicesTimer: ReturnType<typeof setTimeout> | undefined

// TTS 走渲染层 Web Speech（API 中心引擎只回文本，无语音能力）；无对应语种语音时隐藏按钮不做假按钮
const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
const ttsVoices = ref<SpeechSynthesisVoice[]>([])
const speaking = ref(false)

function refreshVoices(): void {
  if (!ttsSupported) return
  ttsVoices.value = window.speechSynthesis.getVoices()
}

const ttsLang = computed(() => lastPair.value?.to ?? 'zh-CN')
const ttsAvailable = computed(() => {
  if (!ttsSupported || ttsVoices.value.length === 0) return false
  const prefix = ttsLang.value.split('-')[0]?.toLowerCase() ?? ''
  return ttsVoices.value.some((v) => v.lang.toLowerCase().startsWith(prefix))
})

interface EngineTab {
  id: string
  name: string
}

const engines = computed<EngineTab[]>(() => {
  const st = statusData.value
  if (st === null) return [{ id: '', name: DEFAULT_ENGINE_TAB }]
  const tabs = st.providers.filter((p) => p.enabled).map((p) => ({ id: p.id, name: p.name }))
  // active 为空或未启用：保留默认回退 tab（providerId 空 = 内置 MyMemory）
  if (!st.providers.some((p) => p.id === st.activeProviderId && p.enabled)) {
    tabs.unshift({ id: '', name: DEFAULT_ENGINE_TAB })
  }
  return tabs.length > 0 ? tabs : [{ id: '', name: DEFAULT_ENGINE_TAB }]
})

const charCount = computed(() => input.value.length)

// 引擎栏右侧的实时语向预览（auto 会按当前输入内容落成具体方向）
const pairHint = computed(() => {
  const { from, to } = resolveLangPair(direction.value, input.value)
  return `${langLabel(from)} → ${langLabel(to)}`
})

function providerName(id: string): string {
  if (id === '') return DEFAULT_ENGINE_TAB
  const known = statusData.value?.providers.find((p) => p.id === id)
  if (known !== undefined) return known.name
  // 未配置任何 provider 时主进程回退内置 MyMemory，status 的 providers 里没有它
  return id === BUILTIN_MYMEMORY_ID ? 'MyMemory' : id
}

// 右栏页脚署名：谁译的 · 什么语向；demo 态给稳定示例文案
const resultMeta = computed(() => {
  if (isDemo.value) {
    const pair = lastPair.value ?? { from: 'en', to: 'zh-CN' }
    return `示例 · ${langLabel(pair.from)} → ${langLabel(pair.to)}`
  }
  if (result.value === '') return ''
  const engine = providerName(servedBy.value)
  return lastPair.value !== null ? `${engine} · ${langLabel(lastPair.value.from)} → ${langLabel(lastPair.value.to)}` : engine
})

const statusLine = computed(() => {
  if (tip.value !== '') return tip.value
  if (isDemo.value) return '示例数据 · 输入文本、粘贴或切换语向即开始真实翻译'
  return '输入即译 · Enter 立即翻译 · Shift+Enter 换行'
})

function flashTip(msg: string): void {
  tip.value = msg
  if (tipTimer !== undefined) clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 1800)
}

async function refreshStatus(): Promise<void> {
  try {
    const st = await props.ctx.host.apis.status('translate')
    statusData.value = st
    const activeEnabled = st.providers.some((p) => p.id === st.activeProviderId && p.enabled)
    const fallback = activeEnabled ? st.activeProviderId : ''
    // 用户没手动选过（或所选引擎已被删/禁用）→ 跟随全局 active
    if (!engineChosen.value || !engines.value.some((e) => e.id === engineId.value)) engineId.value = fallback
  } catch {
    // status 取不到时保持默认引擎 tab，翻译仍可用
  }
}

async function persistPrefs(): Promise<void> {
  if (isDemo.value) return
  try {
    await props.ctx.host.storage.set(PREFS_STORAGE_KEY, { direction: direction.value } satisfies TranslatePrefs)
  } catch {
    // 偏好保存失败不阻塞翻译
  }
}

onMounted(async () => {
  if (!isDemo.value) {
    try {
      direction.value = normalizePrefs(await props.ctx.host.storage.get(PREFS_STORAGE_KEY)).direction
    } catch {
      direction.value = DEFAULT_PREFS.direction
    }
  }
  void refreshStatus()
  if (ttsSupported) {
    refreshVoices()
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices)
    // Chromium 语音列表常延迟就绪，补一次兜底轮询
    voicesTimer = setTimeout(refreshVoices, 600)
  }
})

// provider 在全局 API 中心改动时刷新引擎 tab
const offApiServicesChanged = props.ctx.host.events.on('api-services-changed', () => void refreshStatus())

// 外壳搜索框的 keyword 后剩余输入直达输入区（fy 你好 → 直接翻译「你好」）
watch(
  () => props.query,
  (q) => {
    if (isDemo.value) return
    const t = q.trim()
    if (t !== '' && t !== input.value) input.value = t
  },
  { immediate: true }
)

// 输入即译：450ms 防抖，清空输入即清结果；任何编辑都视为离开 demo 态
watch(input, (v) => {
  if (isDemo.value) isDemo.value = false
  if (debounceTimer !== undefined) clearTimeout(debounceTimer)
  const text = v.trim()
  if (text === '') {
    result.value = ''
    error.value = ''
    loading.value = false
    requestSeq++
    return
  }
  debounceTimer = setTimeout(() => void doTranslate(), 450)
})

onBeforeUnmount(() => {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer)
  if (tipTimer !== undefined) clearTimeout(tipTimer)
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
  if (voicesTimer !== undefined) clearTimeout(voicesTimer)
  requestSeq++
  offApiServicesChanged()
  if (ttsSupported) {
    window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices)
    window.speechSynthesis.cancel()
  }
})

async function doTranslate(): Promise<void> {
  const text = input.value.trim()
  if (text === '') return
  const seq = ++requestSeq
  loading.value = true
  error.value = ''
  try {
    const { from, to } = resolveLangPair(direction.value, text)
    const out = await props.ctx.host.apis.invoke('translate', { text, from, to, providerId: engineId.value || undefined })
    if (seq !== requestSeq) return
    result.value = out.resultText
    lastPair.value = { from: out.detectedFrom ?? from, to }
    servedBy.value = out.providerId
  } catch (err) {
    if (seq !== requestSeq) return
    result.value = ''
    servedBy.value = ''
    error.value = err instanceof Error && err.message !== '' ? err.message : '翻译失败，请稍后重试'
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

function onEnter(e: KeyboardEvent): void {
  // 输入法组合态的 Enter 只上屏不翻译；Shift+Enter 保留换行
  if (e.isComposing || e.shiftKey) return
  e.preventDefault()
  isDemo.value = false
  void doTranslate()
}

function selectEngine(id: string): void {
  if (engineId.value === id) return
  engineId.value = id
  engineChosen.value = true
  // demo 态只切选择不发请求（示例结果与引擎无关）
  if (!isDemo.value && input.value.trim() !== '') void doTranslate()
}

function onDirectionChange(): void {
  isDemo.value = false
  void persistPrefs()
  if (input.value.trim() !== '') void doTranslate()
}

function onSwap(): void {
  isDemo.value = false
  const moved = result.value
  direction.value = swapDirection(direction.value, input.value)
  void persistPrefs()
  if (moved !== '') {
    // 搬移文本：旧译文成为新源文，input 变化触发防抖重译
    input.value = moved
    result.value = ''
    lastPair.value = null
    servedBy.value = ''
  } else if (input.value.trim() !== '') {
    void doTranslate()
  }
}

function clearInput(): void {
  isDemo.value = false
  input.value = ''
  inputEl.value?.focus()
}

async function readClipboard(): Promise<void> {
  isDemo.value = false
  error.value = ''
  try {
    const t = (await props.ctx.host.clipboard.readText()).trim()
    if (t === '') {
      flashTip('剪贴板中没有文本内容')
      return
    }
    input.value = t // 赋值即触发输入即译
  } catch (err) {
    flashTip(err instanceof Error ? err.message : '读取剪贴板失败')
  } finally {
    inputEl.value?.focus()
  }
}

async function copyResult(): Promise<void> {
  if (result.value === '') return
  try {
    await props.ctx.host.clipboard.writeText(result.value)
    copied.value = true
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1200)
  } catch (err) {
    flashTip(err instanceof Error ? err.message : '复制失败')
  }
}

function speak(): void {
  if (!ttsSupported || result.value === '') return
  const synth = window.speechSynthesis
  // 朗读中再点 = 停止
  if (speaking.value) {
    synth.cancel()
    speaking.value = false
    return
  }
  try {
    synth.cancel()
    const u = new SpeechSynthesisUtterance(result.value)
    u.lang = ttsLang.value
    const prefix = ttsLang.value.split('-')[0]?.toLowerCase() ?? ''
    const voice = ttsVoices.value.find((v) => v.lang.toLowerCase().startsWith(prefix))
    if (voice !== undefined) u.voice = voice
    speaking.value = true
    u.onend = () => (speaking.value = false)
    u.onerror = () => (speaking.value = false)
    synth.speak(u)
  } catch {
    speaking.value = false
    flashTip('发音不可用')
  }
}
</script>

<template>
  <div class="translate">
    <div class="engine-bar" role="tablist" aria-label="翻译引擎">
      <button
        v-for="e in engines"
        :key="e.id"
        class="engine-tab"
        :class="{ active: e.id === engineId }"
        role="tab"
        :aria-selected="e.id === engineId"
        :title="e.id === '' ? '未另选引擎时走 设置 → API 服务 的默认引擎' : e.name"
        @click="selectEngine(e.id)"
      >
        {{ e.name }}
      </button>
      <span class="spacer"></span>
      <span class="pair-hint">{{ pairHint }}</span>
    </div>

    <div class="panes">
      <section class="pane" aria-label="源文">
        <textarea
          ref="inputEl"
          v-model="input"
          class="source"
          spellcheck="false"
          placeholder="输入要翻译的文本&#10;Enter 立即翻译 · Shift+Enter 换行"
          @keydown.enter="onEnter"
        ></textarea>
        <footer class="pane-foot">
          <select v-model="direction" class="lang" aria-label="翻译方向" @change="onDirectionChange">
            <option v-for="o in DIRECTION_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <span class="spacer"></span>
          <span v-if="charCount > 0" class="count">{{ charCount }} 字</span>
          <button class="ghost" :disabled="input === ''" @click="clearInput">清空</button>
          <button class="ghost" @click="readClipboard">粘贴</button>
        </footer>
      </section>

      <div class="swap-col">
        <button class="swap" title="交换语种并搬移文本" aria-label="交换语种并搬移文本" @click="onSwap">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d="M7 4 3 8l4 4M3 8h13a4 4 0 0 1 4 4M17 20l4-4-4-4M21 16H8a4 4 0 0 1-4-4"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      <section class="pane" aria-label="译文">
        <span v-if="isDemo" class="demo-badge">示例</span>
        <span v-else-if="loading" class="loading-flag"><span class="spin" aria-hidden="true"></span>翻译中…</span>
        <div
          class="result-body"
          :class="{ placeholder: result === '' && !loading && error === '', stale: loading && result !== '' }"
        >
          <div v-if="error !== ''" class="err">
            <p class="err-msg">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path
                  d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                <line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
              <span>{{ error }}</span>
            </p>
            <button class="retry" @click="doTranslate">重试</button>
          </div>
          <div v-else-if="loading && result === ''" class="loading-empty">
            <span class="spin" aria-hidden="true"></span>翻译中…
          </div>
          <template v-else-if="result !== ''">{{ result }}</template>
          <template v-else>译文将显示在这里</template>
        </div>
        <footer class="pane-foot">
          <span class="foot-hint" :title="resultMeta">{{ resultMeta }}</span>
          <span class="spacer"></span>
          <button class="ghost" :disabled="result === ''" @click="copyResult">
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            {{ copied ? '已复制' : '复制' }}
          </button>
          <button
            v-if="ttsAvailable"
            class="ghost icon"
            :class="{ on: speaking }"
            :disabled="result === ''"
            :title="speaking ? '停止朗读' : '朗读译文'"
            :aria-label="speaking ? '停止朗读' : '朗读译文'"
            @click="speak"
          >
            <svg v-if="speaking" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
              <path
                d="M4 9v6h4l5 4V5L8 9H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        </footer>
      </section>
    </div>

    <div class="status" role="status">{{ statusLine }}</div>
  </div>
</template>

<style scoped>
.translate {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-height: 0;
}

/* §2 工具栏：40px 透明底，引擎 pill tab（配置中心已启用引擎） */
.engine-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  height: 40px;
  overflow-x: auto;
}
.engine-tab {
  flex: none;
  height: 28px;
  padding: 0 var(--sp-3);
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  white-space: nowrap;
  cursor: pointer;
}
.engine-tab:hover {
  background: var(--hover);
  color: var(--fg);
}
.engine-tab.active {
  background: var(--accent-dim);
  color: var(--accent);
  font-weight: 600;
}
.pair-hint {
  flex: none;
  padding-left: var(--sp-2);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}

/* 双栏各半 + 中列交换按钮 */
.panes {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: var(--sp-2);
}
.pane {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-raised);
  border-radius: var(--r-lg);
  overflow: hidden;
}

.source {
  flex: 1;
  min-height: 120px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: var(--fg);
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--fs-title);
  line-height: 1.7;
  font-family: inherit;
  caret-color: var(--accent);
}
.source::placeholder {
  color: var(--fg-dim);
  opacity: 0.7;
}

.pane-foot {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-2);
}
.lang {
  height: 28px;
  max-width: 160px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg);
  color: var(--fg);
  font-size: var(--fs-sub);
  padding: 0 var(--sp-2);
  outline: none;
  cursor: pointer;
}
.lang:focus-visible {
  outline: 2px solid var(--accent-dim);
}
.count {
  flex: none;
  padding: 0 var(--sp-1);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.foot-hint {
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ghost {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  height: 28px;
  padding: 0 var(--sp-2);
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  white-space: nowrap;
  cursor: pointer;
}
.ghost:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg);
}
.ghost:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.ghost.icon {
  width: 28px;
  justify-content: center;
  padding: 0;
}
.ghost.icon.on {
  color: var(--accent);
}

.swap-col {
  display: flex;
  align-items: center;
}
.swap {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg);
  color: var(--fg-dim);
  cursor: pointer;
}
.swap:hover {
  background: var(--hover);
  color: var(--accent);
  border-color: var(--accent);
}

.result-body {
  flex: 1;
  min-height: 120px;
  overflow-y: auto;
  padding: var(--sp-3) var(--sp-4);
  font-size: var(--fs-title);
  line-height: 1.7;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}
.result-body::-webkit-scrollbar {
  width: 6px;
}
.result-body::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
.result-body.placeholder {
  color: var(--fg-dim);
  user-select: none;
}
/* 翻译中新请求进行中：旧译文先压暗保留，成功后原位替换 */
.result-body.stale {
  opacity: 0.55;
}

/* 右上角状态位：示例徽标 / 翻译中指示二选一（demo 态永不发请求） */
.demo-badge,
.loading-flag {
  position: absolute;
  top: var(--sp-2);
  right: var(--sp-2);
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px var(--sp-2);
  border-radius: 999px;
  font-size: var(--fs-foot);
  pointer-events: none;
}
.demo-badge {
  background: var(--accent-dim);
  color: var(--accent);
}
.loading-flag {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--accent);
}

/* 失败行内展示：错误信息 + 可重试 */
.err {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-2);
  color: var(--danger);
}
.err-msg {
  margin: 0;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: var(--fs-sub);
  line-height: 1.6;
  word-break: break-word;
}
.err-msg svg {
  flex: none;
  margin-top: 2px;
}
.retry {
  height: 26px;
  padding: 0 var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.retry:hover {
  background: var(--hover);
  border-color: var(--danger);
  color: var(--danger);
}

.loading-empty {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--fg-dim);
}
.spin {
  flex: none;
  display: inline-block;
  width: 11px;
  height: 11px;
  border: 2px solid var(--accent-dim);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.status {
  flex: none;
  min-height: 22px;
  display: flex;
  align-items: center;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}

.spacer {
  flex: 1;
}
</style>
