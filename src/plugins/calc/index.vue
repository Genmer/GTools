<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import { formatDisplay, formatNumber } from './logic/parser'
import { BUILTIN_CONSTANTS, HISTORY_LIMIT, evaluateScratch, makeHistoryEntry, parseHistory, type HistoryEntry } from './logic/scratch'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

// demo 态只做展示与本地交互，不读写 storage，避免污染真实稿纸
const isDemo = props.initialCommand === 'demo'
const DRAFT_KEY = 'draft'
const HISTORY_KEY = 'history'
const SAVE_DEBOUNCE_MS = 400
// demo 数值挑成带千分位的量级，末行留空呈现参考图的「计算公式」占位行
const DEMO_ROWS = ['单价 = 12.5', '数量 = 543', '小计 = 单价 * 数量', '折扣 = 小计 * 20%', '实付 = 小计 - 折扣 + sqrt(64)', '']

const rows = ref<string[]>([''])
const focusedIndex = ref(0)
const history = ref<HistoryEntry[]>([])
const showHistory = ref(false)
const copiedIndex = ref(-1)
const tip = ref('')
const confirmingClear = ref(false)
const restoredFlag = ref(false)

const rowsEl = ref<HTMLElement | null>(null)
const historyRef = ref<HTMLElement | null>(null)

const evaluated = computed(() => evaluateScratch(rows.value.join('\n')))
const lines = computed(() => evaluated.value.lines)
const okCount = computed(() => lines.value.filter((l) => l.kind === 'ok').length)
const sum = computed(() => lines.value.reduce((acc, l) => (l.kind === 'ok' && l.value !== undefined ? acc + l.value : acc), 0))
const sumDisplay = computed(() => (okCount.value > 0 ? formatDisplay(sum.value) : ''))
const contentCount = computed(() => rows.value.filter((r) => r.trim() !== '').length)
const isPaperEmpty = computed(() => contentCount.value === 0)

// 内置量不算「已用变量」，否则提示恒含 ans/pi
const BUILTIN_NAMES = new Set<string>([...Object.keys(BUILTIN_CONSTANTS), 'ans'])

const hint = computed(() => {
  const vars = [...evaluated.value.vars.keys()].filter((k) => !BUILTIN_NAMES.has(k))
  return vars.length === 0
    ? '支持变量赋值 a=12 · ans 上一行结果 · pi/e 常量 · % 百分比 · ^ 幂 · sqrt/sin/round 等函数'
    : `已用变量：${vars.join('、')}`
})

let saveTimer: ReturnType<typeof setTimeout> | undefined
let tipTimer: ReturnType<typeof setTimeout> | undefined
let copiedTimer: ReturnType<typeof setTimeout> | undefined
let confirmTimer: ReturnType<typeof setTimeout> | undefined

function flashTip(msg: string): void {
  tip.value = msg
  if (tipTimer !== undefined) clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 1800)
}

function focusRow(i: number, caret: 'start' | 'end' = 'end'): void {
  const idx = Math.max(0, Math.min(i, rows.value.length - 1))
  focusedIndex.value = idx
  void nextTick(() => {
    const el = rowsEl.value?.querySelector<HTMLInputElement>(`input[data-i="${idx}"]`) ?? null
    if (el === null) return
    el.focus()
    const pos = caret === 'end' ? el.value.length : 0
    el.setSelectionRange(pos, pos)
  })
}

function commitRow(i: number): void {
  if (rows.value[i]?.trim() === '') {
    if (i < rows.value.length - 1) focusRow(i + 1, 'start')
    return
  }
  rows.value.splice(i + 1, 0, '')
  focusRow(i + 1)
}

function deleteRow(i: number): void {
  if (rows.value.length <= 1) return
  rows.value.splice(i, 1)
  focusRow(Math.min(i, rows.value.length - 1))
}

function onKeydown(e: KeyboardEvent, i: number): void {
  // 输入法组合期间的按键（含回车选词）不拦截
  if (e.isComposing) return
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    void archive()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    commitRow(i)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    focusRow(i - 1, 'end')
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    focusRow(i + 1, 'start')
    return
  }
  if (e.key === 'Backspace' && rows.value[i] === '' && rows.value.length > 1) {
    e.preventDefault()
    rows.value.splice(i, 1)
    focusRow(Math.max(0, i - 1))
  }
}

function onPaste(e: ClipboardEvent, i: number): void {
  const text = e.clipboardData?.getData('text') ?? ''
  if (!/\r|\n/.test(text)) return
  // 多行粘贴拆成多行（从表格/日志粘贴一列数字是高频场景）
  e.preventDefault()
  const parts = text.replace(/\r\n?/g, '\n').split('\n')
  rows.value.splice(i, 1, ...parts)
  focusRow(i + parts.length - 1)
}

async function saveDraft(): Promise<void> {
  if (isDemo) return
  try {
    await props.ctx.host.storage.set(DRAFT_KEY, rows.value.join('\n'))
  } catch {
    // 写入失败不阻塞编辑，下次保存再试
  }
}

async function persistHistory(): Promise<void> {
  if (isDemo) return
  try {
    await props.ctx.host.storage.set(HISTORY_KEY, history.value)
  } catch {
    flashTip('历史保存失败')
  }
}

onMounted(async () => {
  document.addEventListener('mousedown', onDocMousedown)
  if (isDemo) {
    rows.value = [...DEMO_ROWS]
  } else {    try {
      const d = await props.ctx.host.storage.get<unknown>(DRAFT_KEY)
      if (typeof d === 'string' && d !== '') rows.value = d.split(/\r?\n/)
    } catch {
      // 首次使用无稿纸，保持一行空白
    }
  }
  try {
    history.value = parseHistory(await props.ctx.host.storage.get(HISTORY_KEY))
  } catch {
    history.value = []
  }
  restoredFlag.value = true
  // 外壳 keyword 后的剩余输入追加为末行（calc 1+2*3 直达）
  const q = props.query.trim()
  if (!isDemo && q !== '') rows.value = [...rows.value, ...q.split(/\r?\n/)]
  focusRow(rows.value.length - 1)
})

watch(
  rows,
  () => {
    if (!restoredFlag.value || isDemo) return
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void saveDraft(), SAVE_DEBOUNCE_MS)
  },
  { deep: true }
)

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocMousedown)
  for (const t of [saveTimer, tipTimer, copiedTimer, confirmTimer]) if (t !== undefined) clearTimeout(t)
  void saveDraft()
})

function onDocMousedown(e: MouseEvent): void {
  if (showHistory.value && historyRef.value !== null && !historyRef.value.contains(e.target as Node)) {
    showHistory.value = false
  }
}

async function copyLine(i: number): Promise<void> {
  const l = lines.value[i]
  if (l === undefined || l.kind !== 'ok' || l.value === undefined) return
  focusedIndex.value = i
  try {
    await props.ctx.host.clipboard.writeText(formatNumber(l.value))
    copiedIndex.value = i
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copiedIndex.value = -1), 1200)
  } catch {
    flashTip('复制失败')
  }
}

async function copyAll(): Promise<void> {
  if (okCount.value === 0) {
    flashTip('没有可复制的结果')
    return
  }
  // 复制内容不带千分位逗号，保证粘贴到别处可直接参与计算
  const body = lines.value.map((l) => (l.kind === 'ok' && l.value !== undefined ? `${l.raw} = ${formatNumber(l.value)}` : l.raw)).join('\n')
  try {
    await props.ctx.host.clipboard.writeText(`${body}\nΣ = ${formatNumber(sum.value)}`)
    flashTip(`已复制 ${okCount.value} 行结果与合计`)
  } catch {
    flashTip('复制失败')
  }
}

async function archive(): Promise<void> {
  if (isPaperEmpty.value) {
    flashTip('稿纸是空的，没有可归档内容')
    return
  }
  history.value = [makeHistoryEntry(rows.value.join('\n')), ...history.value].slice(0, HISTORY_LIMIT)
  await persistHistory()
  flashTip(`已归档（共 ${history.value.length} 张）`)
}

function restore(h: HistoryEntry): void {
  rows.value = h.text === '' ? [''] : h.text.split(/\r?\n/)
  showHistory.value = false
  focusRow(rows.value.length - 1)
  flashTip(isDemo ? '已载入示例（示例态不保存）' : '已恢复到稿纸')
}

async function removeHistory(h: HistoryEntry): Promise<void> {
  history.value = history.value.filter((x) => x.id !== h.id)
  await persistHistory()
}

async function clearHistory(): Promise<void> {
  history.value = []
  await persistHistory()
  flashTip('历史已清空')
}

function startConfirmClear(): void {
  confirmingClear.value = true
  if (confirmTimer !== undefined) clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => (confirmingClear.value = false), 3500)
}

function doClear(): void {
  if (confirmTimer !== undefined) clearTimeout(confirmTimer)
  confirmingClear.value = false
  rows.value = ['']
  focusRow(0)
  flashTip('已清空')
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function countEffective(text: string): number {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').length
}

// 结果列文本：ok/error 行用展示值；末尾空行给一个灰 = 占位（对齐参考图）
function resultText(i: number): string {
  const l = lines.value[i]
  if (l !== undefined && (l.kind === 'ok' || l.kind === 'error')) return l.display
  return i === rows.value.length - 1 ? '=' : ''
}

function isPlaceholderEq(i: number): boolean {
  const l = lines.value[i]
  return (l === undefined || l.kind === 'skip') && i === rows.value.length - 1
}
</script>

<template>
  <div class="calc">
    <div class="toolbar">
      <button class="tbtn" :disabled="isPaperEmpty" title="归档当前稿纸到历史（⌘/Ctrl+Enter）" @click="archive">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <polyline points="21 8 21 21 3 21 3 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <rect x="1" y="3" width="22" height="5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
          <line x1="10" y1="12" x2="14" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        归档
      </button>
      <button class="tbtn" :disabled="okCount === 0" title="复制全部行与合计" @click="copyAll">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <rect x="9" y="9" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        复制结果
      </button>
      <div ref="historyRef" class="history-wrap">
        <button class="tbtn" :class="{ active: showHistory }" title="历史稿纸" @click="showHistory = !showHistory">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
            <polyline points="12 7 12 12 15.5 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          历史<span class="hcount">{{ history.length }}</span>
        </button>
        <div v-if="showHistory" class="history-panel">
          <p v-if="history.length === 0" class="hempty">还没有历史；点「归档」可把当前稿纸存入历史（最多 {{ HISTORY_LIMIT }} 张）</p>
          <div v-for="h in history" :key="h.id" class="hitem">
            <div class="hmain">
              <p class="htitle" :title="h.title">{{ h.title }}</p>
              <p class="hmeta">{{ fmtTime(h.ts) }} · {{ countEffective(h.text) }} 行</p>
            </div>
            <button class="hact" @click="restore(h)">恢复</button>
            <button class="hact danger" @click="removeHistory(h)">删除</button>
          </div>
          <div v-if="history.length > 0" class="hfoot">
            <button class="hact danger" @click="clearHistory">清空全部历史</button>
          </div>
        </div>
      </div>

      <span class="tip" :title="tip !== '' ? tip : hint">{{ tip !== '' ? tip : hint }}</span>
      <span v-if="isDemo" class="demo-badge">示例 · 不落盘</span>

      <template v-if="confirmingClear">
        <span class="confirm-label">清空全部 {{ contentCount }} 行？</span>
        <button class="tbtn danger solid" @click="doClear">清空</button>
        <button class="tbtn" @click="confirmingClear = false">取消</button>
      </template>
      <button v-else class="tbtn danger" :disabled="isPaperEmpty" title="清空稿纸" @click="startConfirmClear">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <polyline points="3 6 5 6 21 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        清空
      </button>
    </div>

    <div class="sheet">
      <div ref="rowsEl" class="rows">
        <div
          v-for="(_, i) in rows"
          :key="i"
          class="row"
          :class="{ focused: i === focusedIndex }"
        >
          <span class="no">{{ i + 1 }}</span>
          <input
            v-model="rows[i]"
            :data-i="i"
            class="expr"
            type="text"
            spellcheck="false"
            autocomplete="off"
            :placeholder="i === rows.length - 1 ? '计算公式' : ''"
            :aria-label="`第 ${i + 1} 行算式`"
            @focus="focusedIndex = i"
            @keydown="onKeydown($event, i)"
            @paste="onPaste($event, i)"
          />
          <span
            class="result"
            :class="[lines[i]?.kind, { 'dim-eq': isPlaceholderEq(i) }]"
            :title="lines[i]?.kind === 'error' ? lines[i]?.display : lines[i]?.kind === 'ok' ? '点击复制结果' : undefined"
            @mousedown.prevent
            @click="copyLine(i)"
          >{{ resultText(i) }}</span>
          <span v-if="copiedIndex === i" class="copied-pill">已复制</span>
          <button v-if="rows.length > 1" class="del" title="删除此行" aria-label="删除此行" @click="deleteRow(i)">×</button>
        </div>
      </div>
      <div class="sum" title="Σ = 全部结果行之和">
        <span class="sum-label">Σ</span>
        <span class="sum-value">{{ sumDisplay }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calc {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  font-size: var(--fs-title);
}

/* §2 工具栏：透明底、28px 图标按钮 */
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  height: 40px;
  margin-bottom: var(--sp-1);
}
.tbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 8px;
  border: none;
  background: transparent;
  border-radius: var(--r-sm);
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  cursor: pointer;
  white-space: nowrap;
}
.tbtn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg);
}
.tbtn:disabled {
  opacity: 0.45;
  cursor: default;
}
.tbtn.active {
  background: var(--hover);
  color: var(--fg);
}
.tbtn.danger:hover:not(:disabled) {
  color: var(--danger);
}
.tbtn.danger.solid {
  color: var(--danger);
  box-shadow: inset 0 0 0 1px var(--danger);
}
.tbtn.danger.solid:hover {
  background: var(--danger);
  color: var(--on-accent);
}
.hcount {
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.tip {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  text-align: right;
  padding: 0 var(--sp-2);
}
.demo-badge {
  flex: none;
  margin-right: var(--sp-2);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: var(--fs-foot);
}
.confirm-label {
  color: var(--danger);
  font-size: var(--fs-sub);
  margin: 0 var(--sp-1);
  white-space: nowrap;
}

.sheet {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.rows {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--sp-1) 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.rows::-webkit-scrollbar {
  width: 6px;
}
.rows::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}

/* §3 行结构：行号 24px + 表达式 + 右对齐结果，行高 ~34px */
.row {
  position: relative;
  display: flex;
  align-items: center;
  height: 34px;
  padding-right: 28px;
  border-radius: var(--r-sm);
}
.row.focused {
  background: var(--hover);
}
.no {
  flex: none;
  width: 24px;
  text-align: right;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  user-select: none;
}
.row.focused .no {
  color: var(--accent);
  font-weight: 600;
}
.expr {
  flex: 1;
  min-width: 0;
  margin-left: 10px;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-size: var(--fs-title);
  caret-color: var(--accent);
}
.expr::placeholder {
  color: var(--fg-dim);
  opacity: 0.7;
}
.result {
  flex: none;
  max-width: 42%;
  margin-left: var(--sp-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  color: var(--fg);
  font-size: var(--fs-title);
  user-select: none;
}
.result.ok {
  cursor: pointer;
}
.result.error {
  color: var(--danger);
}
.result.dim-eq {
  color: var(--fg-dim);
  opacity: 0.5;
}
.del {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  border-radius: var(--r-sm);
  color: var(--fg-dim);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
}
.row:hover .del,
.del:focus-visible {
  opacity: 1;
}
.del:hover {
  color: var(--danger);
  background: var(--hover);
}
.copied-pill {
  position: absolute;
  right: 30px;
  top: 50%;
  transform: translateY(-50%);
  padding: 1px 6px;
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  pointer-events: none;
}

/* 合计行：分隔线下方与结果列对齐 */
.sum {
  flex: none;
  display: flex;
  align-items: center;
  height: 36px;
  margin-top: var(--sp-1);
  padding-right: 28px;
  border-top: 1px solid var(--border);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 700;
}
.sum-label {
  margin-left: 34px;
  color: var(--fg);
}
.sum-value {
  margin-left: auto;
  color: var(--fg);
  font-size: var(--fs-title);
}

.history-wrap {
  position: relative;
}
.history-panel {
  position: absolute;
  top: 34px;
  right: 0;
  z-index: 10;
  width: 360px;
  max-height: 320px;
  overflow-y: auto;
  padding: var(--sp-2);
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-pop);
}
.hempty {
  margin: 0;
  padding: var(--sp-2);
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.hitem {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2);
  border-radius: var(--r-sm);
}
.hitem:hover {
  background: var(--hover);
}
.hmain {
  flex: 1;
  min-width: 0;
}
.htitle {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-size: var(--fs-title);
}
.hmeta {
  margin: 2px 0 0;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.hact {
  flex: none;
  height: 24px;
  padding: 0 8px;
  border: none;
  background: transparent;
  border-radius: var(--r-sm);
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.hact:hover {
  background: var(--hover);
  color: var(--fg);
}
.hact.danger:hover {
  color: var(--danger);
}
.hfoot {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--sp-1);
  margin-top: var(--sp-1);
  border-top: 1px solid var(--border);
}
</style>
