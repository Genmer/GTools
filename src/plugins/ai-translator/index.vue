<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ApiServiceStatus, PluginContext } from '@sdk/api'
import { HostApiError } from '@sdk/api'
import { DEFAULT_PREFS, PROVIDER_STORAGE_KEY, normalizeProviderPrefs } from './logic'
import type { ProviderPrefs } from './logic'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const DEFAULT_PROVIDER_TAB = '默认供应商'

const input = ref('')
const result = ref('')
// 实际产出当前译文的供应商（页脚署名用；providerId 只是用户选择，跟随全局 active 时两者可不同）
const servedBy = ref('')
const loading = ref(false)
const error = ref('')
const copied = ref(false)
// 未配置（status.configured=false 或调用返回 SERVICE_UNCONFIGURED）→ 双栏换引导卡
const unconfigured = ref(false)

const statusData = ref<ApiServiceStatus | null>(null)
// '' = 默认供应商（不指定 providerId，主进程按全局 active 调用）
const providerId = ref('')
const providerChosen = ref(false)

const inputEl = ref<HTMLTextAreaElement | null>(null)

// 请求序号守卫：防抖期间新请求先返回时不让旧结果覆盖新状态
let requestSeq = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let copiedTimer: ReturnType<typeof setTimeout> | undefined

interface ProviderTab {
  id: string
  name: string
}

const providers = computed<ProviderTab[]>(() => {
  const st = statusData.value
  if (st === null) return [{ id: '', name: DEFAULT_PROVIDER_TAB }]
  const tabs = st.providers.filter((p) => p.enabled).map((p) => ({ id: p.id, name: p.name }))
  // active 为空或未启用：保留默认 tab（providerId 空 = 全局 active）
  if (!st.providers.some((p) => p.id === st.activeProviderId && p.enabled)) {
    tabs.unshift({ id: '', name: DEFAULT_PROVIDER_TAB })
  }
  return tabs.length > 0 ? tabs : [{ id: '', name: DEFAULT_PROVIDER_TAB }]
})

const charCount = computed(() => input.value.length)

const statusLine = computed(() => '输入即译 · Enter 立即翻译 · Shift+Enter 换行')

const resultMeta = computed(() => {
  if (result.value === '') return ''
  return providerName(servedBy.value)
})

function providerName(id: string): string {
  if (id === '') return DEFAULT_PROVIDER_TAB
  return statusData.value?.providers.find((p) => p.id === id)?.name ?? id
}

async function refreshStatus(): Promise<void> {
  try {
    const st = await props.ctx.host.apis.status('ai')
    statusData.value = st
    unconfigured.value = !st.configured
    const activeEnabled = st.providers.some((p) => p.id === st.activeProviderId && p.enabled)
    const fallback = activeEnabled ? st.activeProviderId : ''
    // 用户没手动选过（或所选供应商已被删/禁用）→ 跟随全局 active
    if (!providerChosen.value || !providers.value.some((p) => p.id === providerId.value)) providerId.value = fallback
  } catch {
    // status 取不到时保持现状，不打断输入
  }
}

async function persistPrefs(): Promise<void> {
  try {
    await props.ctx.host.storage.set(PROVIDER_STORAGE_KEY, { providerId: providerId.value } satisfies ProviderPrefs)
  } catch {
    // 偏好保存失败不阻塞翻译
  }
}

onMounted(async () => {
  try {
    const saved = normalizeProviderPrefs(await props.ctx.host.storage.get(PROVIDER_STORAGE_KEY)).providerId
    if (saved !== '') {
      providerId.value = saved
      providerChosen.value = true
    }
  } catch {
    providerId.value = DEFAULT_PREFS.providerId
  }
  void refreshStatus()
})

// 供应商在全局 API 中心改动时刷新 tab 与引导卡
const offApiServicesChanged = props.ctx.host.events.on('api-services-changed', () => void refreshStatus())

// 输入即译：450ms 防抖，清空输入即清结果。须先于 query watch 注册：深链立即回填 input 的那次
// 变化发生在 query watch 的 immediate 回调里，晚注册的 watch 收不到（缺失时 aitr 你好 不自动翻译）
watch(input, (v) => {
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

// 外壳搜索框的 keyword 后剩余输入直达输入区（aitr 你好 → 直接翻译「你好」）
watch(
  () => props.query,
  (q) => {
    const t = q.trim()
    if (t !== '' && t !== input.value) input.value = t
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer)
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
  requestSeq++
  offApiServicesChanged()
})

async function doTranslate(): Promise<void> {
  const text = input.value.trim()
  if (text === '') return
  const seq = ++requestSeq
  loading.value = true
  error.value = ''
  try {
    const out = await props.ctx.host.apis.invoke('ai', { text, providerId: providerId.value || undefined })
    if (seq !== requestSeq) return
    result.value = out.resultText
    servedBy.value = out.providerId
  } catch (err) {
    if (seq !== requestSeq) return
    result.value = ''
    servedBy.value = ''
    if (err instanceof HostApiError && err.code === 'SERVICE_UNCONFIGURED') {
      // 供应商被删/禁用：切引导卡而非报错
      unconfigured.value = true
    } else {
      error.value = err instanceof Error && err.message !== '' ? err.message : '翻译失败，请稍后重试'
    }
  } finally {
    if (seq === requestSeq) loading.value = false
  }
}

function onEnter(e: KeyboardEvent): void {
  // 输入法组合态的 Enter 只上屏不翻译；Shift+Enter 保留换行
  if (e.isComposing || e.shiftKey) return
  e.preventDefault()
  void doTranslate()
}

function selectProvider(id: string): void {
  if (providerId.value === id) return
  providerId.value = id
  providerChosen.value = true
  void persistPrefs()
  if (input.value.trim() !== '') void doTranslate()
}

function clearInput(): void {
  input.value = ''
  inputEl.value?.focus()
}

async function copyResult(): Promise<void> {
  if (result.value === '') return
  try {
    await props.ctx.host.clipboard.writeText(result.value)
    copied.value = true
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1200)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '复制失败'
  }
}
</script>

<template>
  <div class="ai-translator">
    <div class="provider-bar" role="tablist" aria-label="AI 供应商">
      <button
        v-for="p in providers"
        :key="p.id"
        class="provider-tab"
        :class="{ active: p.id === providerId }"
        role="tab"
        :aria-selected="p.id === providerId"
        :title="p.id === '' ? '未另选供应商时走 设置 → AI 服务 的默认供应商' : p.name"
        @click="selectProvider(p.id)"
      >
        {{ p.name }}
      </button>
      <span class="spacer"></span>
    </div>

    <div v-if="unconfigured" class="guide" role="status">
      <p class="guide-title">尚未配置 AI 供应商</p>
      <p class="guide-desc">到 设置 → AI 服务 添加 OpenAI 兼容供应商（接口地址、模型名、API 密钥）后即可翻译。</p>
      <button class="retry" @click="refreshStatus">重新检测</button>
    </div>

    <div v-else class="panes">
      <section class="pane" aria-label="原文">
        <textarea
          ref="inputEl"
          v-model="input"
          class="source"
          spellcheck="false"
          placeholder="输入要翻译的文本&#10;Enter 立即翻译 · Shift+Enter 换行"
          @keydown.enter="onEnter"
        ></textarea>
        <footer class="pane-foot">
          <span v-if="charCount > 0" class="count">{{ charCount }} 字</span>
          <span class="spacer"></span>
          <button class="ghost" :disabled="input === ''" @click="clearInput">清空</button>
        </footer>
      </section>

      <section class="pane" aria-label="译文">
        <span v-if="loading" class="loading-flag"><span class="spin" aria-hidden="true"></span>翻译中…</span>
        <div
          class="result-body"
          :class="{ placeholder: result === '' && !loading && error === '', stale: loading && result !== '' }"
        >
          <div v-if="error !== ''" class="err">
            <p class="err-msg">{{ error }}</p>
            <button class="retry" @click="doTranslate">重试</button>
          </div>
          <div v-else-if="loading && result === ''" class="loading-empty">
            <span class="spin" aria-hidden="true"></span>翻译中…
          </div>
          <template v-else-if="result !== ''">{{ result }}</template>
          <template v-else>译文将显示在这里</template>
        </div>
        <footer class="pane-foot">
          <span class="foot-hint">{{ resultMeta }}</span>
          <span class="spacer"></span>
          <button class="ghost" :disabled="result === ''" @click="copyResult">{{ copied ? '已复制' : '复制' }}</button>
        </footer>
      </section>
    </div>

    <div class="status" role="status">{{ statusLine }}</div>
  </div>
</template>

<style scoped>
.ai-translator {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-height: 0;
}

.provider-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  height: 40px;
  overflow-x: auto;
}
.provider-tab {
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
.provider-tab:hover {
  background: var(--hover);
  color: var(--fg);
}
.provider-tab.active {
  background: var(--accent-dim);
  color: var(--accent);
  font-weight: 600;
}

/* 未配置引导卡：ai 品类无内置免 Key 默认 */
.guide {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  background: var(--bg-raised);
  border-radius: var(--r-lg);
  text-align: center;
  padding: var(--sp-4);
}
.guide-title {
  margin: 0;
  color: var(--fg);
  font-size: var(--fs-title);
  font-weight: 600;
}
.guide-desc {
  margin: 0;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  line-height: 1.7;
  max-width: 460px;
}

.panes {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
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

/* 右上角翻译中指示 */
.loading-flag {
  position: absolute;
  top: var(--sp-2);
  right: var(--sp-2);
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px var(--sp-2);
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--bg);
  color: var(--accent);
  font-size: var(--fs-foot);
  pointer-events: none;
}

/* 失败行内展示：错误信息 + 可重试，不弹窗 */
.err {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--sp-2);
  color: var(--danger);
}
.err-msg {
  margin: 0;
  font-size: var(--fs-sub);
  line-height: 1.6;
  word-break: break-word;
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
