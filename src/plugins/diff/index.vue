<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import { computeLineDiff, formatUnified, type DiffOptions } from './logic/diff'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const OPTIONS_KEY = 'diff:options'
const leftText = ref('')
const rightText = ref('')
const ignoreCase = ref(false)
const ignoreWhitespace = ref(false)
const copied = ref(false)
const error = ref('')
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const options = computed<DiffOptions>(() => ({
  ignoreCase: ignoreCase.value,
  ignoreWhitespace: ignoreWhitespace.value
}))
const result = computed(() => computeLineDiff(leftText.value, rightText.value, options.value))
const stats = computed(() => result.value.stats)
const hasInput = computed(() => leftText.value !== '' || rightText.value !== '')
const hasDiff = computed(() => stats.value.added + stats.value.removed + stats.value.modified > 0)
const identical = computed(() => hasInput.value && !hasDiff.value)

onMounted(async () => {
  try {
    const saved = await props.ctx.host.storage.get<DiffOptions>(OPTIONS_KEY)
    if (saved !== null && typeof saved === 'object') {
      ignoreCase.value = saved.ignoreCase === true
      ignoreWhitespace.value = saved.ignoreWhitespace === true
    }
  } catch {
    // 读不到就维持默认
  }
})

watch(options, (o) => {
  props.ctx.host.storage.set(OPTIONS_KEY, o).catch(() => {})
})

// 外壳 keyword 后剩余输入预填左栏（diff xxx → 左栏为 xxx）
watch(
  () => props.query,
  (q) => {
    const t = q.trim()
    if (t !== '') leftText.value = t
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})

// 双栏同步滚动；rAF 复位防滚动事件互相反馈
const leftPane = ref<HTMLElement | null>(null)
const rightPane = ref<HTMLElement | null>(null)
let syncingScroll = false

function syncScroll(from: 'left' | 'right'): void {
  if (syncingScroll) return
  const src = from === 'left' ? leftPane.value : rightPane.value
  const dst = from === 'left' ? rightPane.value : leftPane.value
  if (src === null || dst === null) return
  syncingScroll = true
  dst.scrollTop = src.scrollTop
  dst.scrollLeft = src.scrollLeft
  requestAnimationFrame(() => {
    syncingScroll = false
  })
}

function swapSides(): void {
  const t = leftText.value
  leftText.value = rightText.value
  rightText.value = t
}

function clearAll(): void {
  leftText.value = ''
  rightText.value = ''
  error.value = ''
}

async function readClipboard(side: 'left' | 'right'): Promise<void> {
  error.value = ''
  try {
    const t = await props.ctx.host.clipboard.readText()
    if (t === '') {
      error.value = '剪贴板中没有文本内容'
      return
    }
    if (side === 'left') leftText.value = t
    else rightText.value = t
  } catch (err) {
    error.value = err instanceof Error ? err.message : '读取剪贴板失败'
  }
}

async function copyResult(): Promise<void> {
  const text = formatUnified(result.value, 'left', 'right')
  if (text === '') return
  try {
    await props.ctx.host.clipboard.writeText(text)
    copied.value = true
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '复制失败'
  }
}
</script>

<template>
  <div class="diff">
    <div class="bar">
      <label class="opt"><input v-model="ignoreWhitespace" type="checkbox" /> 忽略空白</label>
      <label class="opt"><input v-model="ignoreCase" type="checkbox" /> 忽略大小写</label>
      <button class="btn" @click="readClipboard('left')">剪贴板→左</button>
      <button class="btn" @click="readClipboard('right')">剪贴板→右</button>
      <button class="btn" title="交换左右内容" @click="swapSides">⇄ 交换</button>
      <button class="btn" @click="clearAll">清空</button>
      <span class="spacer"></span>
      <span class="stats" title="新增 / 删除 / 修改行数">
        <span class="chip add">+{{ stats.added }}</span>
        <span class="chip del">-{{ stats.removed }}</span>
        <span class="chip mod">~{{ stats.modified }}</span>
      </span>
      <button class="btn" :disabled="!hasDiff" @click="copyResult">{{ copied ? '已复制' : '复制结果' }}</button>
    </div>
    <p v-if="error !== ''" class="err">{{ error }}</p>

    <div class="inputs">
      <textarea v-model="leftText" class="src" placeholder="左侧 / 原文本（可粘贴代码）" spellcheck="false"></textarea>
      <textarea v-model="rightText" class="src" placeholder="右侧 / 新文本（可粘贴代码）" spellcheck="false"></textarea>
    </div>

    <div class="output">
      <div v-if="!hasInput" class="empty">粘贴或读入两侧文本，自动对比</div>
      <div v-else-if="identical" class="empty">✓ 两边内容一致</div>
      <template v-else>
        <div ref="leftPane" class="pane is-left" @scroll="syncScroll('left')">
          <div v-for="(row, i) in result.rows" :key="'l' + i" class="row" :class="'t-' + row.type">
            <span class="ln">{{ row.left !== null ? row.left.lineNo : '' }}</span>
            <code v-if="row.left !== null" class="code">
              <span v-for="(seg, j) in row.left.segments" :key="j" :class="{ hl: seg.changed }">{{ seg.text }}</span>
            </code>
            <code v-else class="code"></code>
          </div>
        </div>
        <div ref="rightPane" class="pane is-right" @scroll="syncScroll('right')">
          <div v-for="(row, i) in result.rows" :key="'r' + i" class="row" :class="'t-' + row.type">
            <span class="ln">{{ row.right !== null ? row.right.lineNo : '' }}</span>
            <code v-if="row.right !== null" class="code">
              <span v-for="(seg, j) in row.right.segments" :key="j" :class="{ hl: seg.changed }">{{ seg.text }}</span>
            </code>
            <code v-else class="code"></code>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.diff {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  flex-wrap: wrap;
}
.opt {
  color: var(--fg);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.btn:disabled {
  color: var(--fg-dim);
  cursor: default;
  opacity: 0.6;
}
.spacer {
  flex: 1;
}
.stats {
  display: inline-flex;
  gap: 6px;
}
.chip {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  border-radius: 6px;
  padding: 2px 8px;
}
.chip.add {
  color: var(--accent);
  background: var(--accent-dim);
}
.chip.del {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}
.chip.mod {
  color: var(--fg-dim);
  background: var(--bg-raised);
}
.err {
  color: var(--danger);
  margin: 0;
  flex: none;
}
.inputs {
  flex: 2;
  min-height: 80px;
  display: flex;
  gap: 8px;
}
.src {
  flex: 1;
  min-width: 0;
  resize: none;
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px;
  font-size: 12px;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  outline: none;
}
.output {
  flex: 3;
  min-height: 120px;
  display: flex;
  gap: 8px;
}
.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-dim);
  border: 1px dashed var(--border);
  border-radius: 6px;
}
.pane {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 0;
}
.row {
  display: flex;
  align-items: stretch;
  line-height: 1.5;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  white-space: pre;
}
.ln {
  flex: none;
  width: 3.5em;
  text-align: right;
  padding: 0 8px;
  color: var(--fg-dim);
  user-select: none;
}
.code {
  flex: 1;
  color: var(--fg);
  user-select: text;
}
/* themes.css 无语义增删色，以下色调均由主题变量 color-mix 派生，随三主题联动 */
.is-left .t-delete,
.is-left .t-modify {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.is-right .t-insert,
.is-right .t-modify {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.is-left .hl {
  background: color-mix(in srgb, var(--danger) 32%, transparent);
  border-radius: 2px;
}
.is-right .hl {
  background: color-mix(in srgb, var(--accent) 34%, transparent);
  border-radius: 2px;
}
</style>
