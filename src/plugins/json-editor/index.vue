<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MatchFile, PluginContext } from '@sdk/api'
import { countLines, parseJson, posToLineCol, reformat, windowRange, type JsonError } from './logic/json'
import { highlightJson } from './logic/highlight'
import {
  TREE_ROW_HEIGHT,
  collectExpandAll,
  defaultExpanded,
  flattenTree,
  valueAt,
  type TreeRow
} from './logic/tree'
import { SAMPLE_JSON } from './logic/sample'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string; initialPayload?: MatchFile[] }>()

const DRAFT_KEY = 'draft'
const TREE_ON_KEY = 'treeOn'
const PARSE_DEBOUNCE_MS = 250
const SAVE_DEBOUNCE_MS = 500
/** 草稿超过 256KB 不再走 IPC 持久化，避免每击键防抖序列化大字符串卡主进程 */
const DRAFT_MAX_SAVE = 262144
/** 全部展开的节点数上限：超过则保持现状并提示（百万级节点全展开是内存炸弹） */
const TREE_EXPAND_CAP = 50000
const LINE_HEIGHT = 22
const PAD_TOP = 8

// demo 态（deep-link demo=1 → initialCommand='demo'）：预填稳定示例且不落盘，避免覆盖用户草稿
const demoMode = props.initialCommand === 'demo'

const text = ref('')
const parsed = ref<unknown>(null)
const hasParsedOnce = ref(false)
type Status = { state: 'idle' } | { state: 'ok' } | { state: 'error'; error: JsonError }
const status = ref<Status>({ state: 'idle' })
const expanded = ref<ReadonlySet<string>>(new Set<string>())
const tip = ref('')
// 树视图改全页切换（不做左右分栏挤编辑器），开关态随草稿一起持久化
const treeOn = ref(false)

const editorEl = ref<HTMLTextAreaElement | null>(null)
const hlEl = ref<HTMLElement | null>(null)
const treeEl = ref<HTMLElement | null>(null)

const highlightedText = computed(() => highlightJson(text.value))

// 滚动位置与视口高度驱动虚拟窗口（行号槽 + 树）
const editScroll = ref(0)
const editViewportH = ref(0)
const treeScroll = ref(0)
const treeViewportH = ref(0)

let parseTimer: ReturnType<typeof setTimeout> | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
let tipTimer: ReturnType<typeof setTimeout> | undefined
let resizeObserver: ResizeObserver | undefined

const lineCount = computed(() => countLines(text.value))
const errLine = computed(() => (status.value.state === 'error' ? status.value.error.line : null))

const treeRows = computed(() => (hasParsedOnce.value ? flattenTree(parsed.value, expanded.value) : []))
const treeWindow = computed(() =>
  windowRange(treeRows.value.length, treeScroll.value, treeViewportH.value, TREE_ROW_HEIGHT)
)
const visibleTreeRows = computed(() => treeRows.value.slice(treeWindow.value.start, treeWindow.value.end))

const gutterWindow = computed(() => windowRange(lineCount.value, editScroll.value, editViewportH.value, LINE_HEIGHT))
const visibleLineNumbers = computed(() => {
  const { start, end } = gutterWindow.value
  const arr: number[] = []
  for (let i = start; i < end; i++) arr.push(i + 1)
  return arr
})

function flash(msg: string): void {
  tip.value = msg
  if (tipTimer !== undefined) clearTimeout(tipTimer)
  tipTimer = setTimeout(() => (tip.value = ''), 2000)
}

function applyParse(): void {
  if (parseTimer !== undefined) {
    clearTimeout(parseTimer)
    parseTimer = undefined
  }
  const t = text.value
  if (t.trim() === '') {
    status.value = { state: 'idle' }
    parsed.value = null
    hasParsedOnce.value = false
    return
  }
  const r = parseJson(t)
  if (r.ok) {
    parsed.value = r.value
    hasParsedOnce.value = true
    status.value = { state: 'ok' }
  } else {
    // 树视图保留最近一次有效结果，输入中途的非法态不清空树
    status.value = { state: 'error', error: r.error }
  }
}

function loadSample(): void {
  text.value = SAMPLE_JSON
  applyParse()
  expanded.value = defaultExpanded(parsed.value)
}

function toggleTree(): void {
  treeOn.value = !treeOn.value
  if (demoMode) return
  void props.ctx.host.storage.set(TREE_ON_KEY, treeOn.value)
}

function toggleNode(row: TreeRow): void {
  const next = new Set(expanded.value)
  if (next.has(row.id)) next.delete(row.id)
  else next.add(row.id)
  expanded.value = next
}

function onExpandAll(): void {
  const { ids, total, overCap } = collectExpandAll(parsed.value, TREE_EXPAND_CAP)
  if (overCap) {
    flash(`节点共 ${total} 个，超过 ${TREE_EXPAND_CAP} 上限，未全部展开`)
    return
  }
  expanded.value = ids
}

function onCollapseAll(): void {
  expanded.value = new Set<string>()
}

async function copyNode(row: TreeRow): Promise<void> {
  const s = JSON.stringify(valueAt(parsed.value, row.path)) ?? 'null'
  try {
    await props.ctx.host.clipboard.writeText(s)
    flash(`已复制节点 ${row.keyLabel}`)
  } catch {
    flash('复制失败')
  }
}

// ---- 内容查找：大小写不敏感，当前条目以选区呈现并滚动到视口中央 ----
const findOn = ref(false)
const findText = ref('')
const findIndex = ref(0)
const findEl = ref<HTMLInputElement | null>(null)

const findMatches = computed<number[]>(() => {
  const needle = findText.value.toLowerCase()
  if (needle === '') return []
  const hay = text.value.toLowerCase()
  const starts: number[] = []
  let i = hay.indexOf(needle)
  while (i !== -1) {
    starts.push(i)
    i = hay.indexOf(needle, i + needle.length)
  }
  return starts
})
const findCount = computed(() => findMatches.value.length)

function toggleFind(): void {
  if (findOn.value) closeFind()
  else openFind()
}

function openFind(): void {
  findOn.value = true
  void nextTick(() => {
    findEl.value?.focus()
    findEl.value?.select()
  })
}

function closeFind(): void {
  findOn.value = false
  void nextTick(() => editorEl.value?.focus())
}

// 查找文本变化时回到第一条并立即定位（无匹配不动）
watch(findText, () => {
  findIndex.value = 0
  if (findCount.value > 0) showFindCurrent()
})

function onFindStep(dir: 1 | -1): void {
  if (findCount.value === 0) return
  findIndex.value = (findIndex.value + dir + findCount.value) % findCount.value
  showFindCurrent()
}

function showFindCurrent(): void {
  const ta = editorEl.value
  if (ta === null) return
  const start = findMatches.value[findIndex.value]
  if (start === undefined) return
  const len = findText.value.length
  ta.focus()
  ta.setSelectionRange(start, start + len)
  const { line } = posToLineCol(text.value, start)
  ta.scrollTop = Math.max(0, (line - 1) * LINE_HEIGHT - Math.max(0, ta.clientHeight / 2 - LINE_HEIGHT))
  onEditorScroll()
}

// 拖 .json 入主窗经 files 匹配推荐进入：插件自行授权后读入内容预填（单文件失败不阻塞其余）
const payloadFiles = props.initialPayload ?? []

async function loadPayloadFiles(): Promise<string> {
  if (payloadFiles.length === 0) return ''
  try {
    await props.ctx.host.fs.grant(payloadFiles.map((f) => f.path))
  } catch (err) {
    flash(`文件授权失败：${err instanceof Error ? err.message : String(err)}`)
    return ''
  }
  const chunks: string[] = []
  const failed: string[] = []
  for (const f of payloadFiles) {
    try {
      chunks.push(await props.ctx.host.fs.read(f.path, { encoding: 'utf-8' }))
    } catch {
      failed.push(f.name)
    }
  }
  if (failed.length > 0) flash(`无法读取：${failed.join('、')}`)
  return chunks.join('\n')
}

async function persist(): Promise<void> {
  if (demoMode) return
  const t = text.value
  if (t.length > DRAFT_MAX_SAVE) return
  try {
    await props.ctx.host.storage.set(DRAFT_KEY, t)
  } catch {
    // 存储失败不打断编辑，下次防抖再试
  }
}

onMounted(async () => {
  observeSizes()
  if (demoMode) {
    loadSample()
    return
  }
  // query 深链内容与拖入文件内容追加到旧草稿之后（calc 同款语义），绝不覆盖既有草稿；
  // 无草稿无输入给空编辑器（placeholder 引导 + 工具栏「载入示例」），不预填示例避免被当草稿落盘
  let base = ''
  try {
    const d = await props.ctx.host.storage.get<unknown>(DRAFT_KEY)
    base = typeof d === 'string' ? d : ''
  } catch {
    base = ''
  }
  try {
    const t = await props.ctx.host.storage.get<unknown>(TREE_ON_KEY)
    treeOn.value = t === true
  } catch {
    treeOn.value = false
  }
  const q = props.query.trim()
  const fileText = await loadPayloadFiles()
  text.value = [base, q, fileText].filter((s) => s !== '').join('\n')
  applyParse()
  expanded.value = defaultExpanded(parsed.value)
  void nextTick(() => editorEl.value?.focus())
})

onBeforeUnmount(() => {
  if (parseTimer !== undefined) clearTimeout(parseTimer)
  if (tipTimer !== undefined) clearTimeout(tipTimer)
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer)
    void persist()
  }
  resizeObserver?.disconnect()
})

// 实时校验防抖 + 草稿防抖落盘
watch(text, () => {
  if (parseTimer !== undefined) clearTimeout(parseTimer)
  parseTimer = setTimeout(applyParse, PARSE_DEBOUNCE_MS)
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    void persist()
  }, SAVE_DEBOUNCE_MS)
})

// 回调读活 ref：树面板 v-if 挂载晚于 observer 创建，闭包捕获会在切换后量不到树视口
function observeSizes(): void {
  const ta = editorEl.value
  if (ta !== null) editViewportH.value = ta.clientHeight
  const tree = treeEl.value
  if (tree !== null) treeViewportH.value = tree.clientHeight
  if (typeof ResizeObserver === 'undefined') return
  if (resizeObserver === undefined) {
    resizeObserver = new ResizeObserver(() => {
      if (editorEl.value !== null) editViewportH.value = editorEl.value.clientHeight
      if (treeEl.value !== null) treeViewportH.value = treeEl.value.clientHeight
    })
  }
  if (ta !== null) resizeObserver.observe(ta)
  if (tree !== null) resizeObserver.observe(tree)
}

function onEditorScroll(): void {
  const ta = editorEl.value
  if (ta === null) return
  editScroll.value = ta.scrollTop
  editViewportH.value = ta.clientHeight
  if (hlEl.value !== null) {
    hlEl.value.scrollTop = ta.scrollTop
    hlEl.value.scrollLeft = ta.scrollLeft
  }
}

function onTreeScroll(): void {
  const el = treeEl.value
  if (el === null) return
  treeScroll.value = el.scrollTop
  treeViewportH.value = el.clientHeight
}

// 树面板 v-if 晚挂载：切换打开时补挂 observer 并量一次视口
watch(treeOn, async (on) => {
  if (!on) return
  await nextTick()
  const tree = treeEl.value
  if (tree === null) return
  treeViewportH.value = tree.clientHeight
  resizeObserver?.observe(tree)
})

function jumpToError(): void {
  if (status.value.state !== 'error') return
  const { offset, line } = status.value.error
  const ta = editorEl.value
  if (ta === null) return
  ta.focus()
  ta.setSelectionRange(offset, Math.min(offset + 1, text.value.length))
  // 程序设 scrollTop 不触发 scroll 事件，行号槽要手动同步
  ta.scrollTop = Math.max(0, (line - 1) * LINE_HEIGHT - Math.max(0, ta.clientHeight / 2 - LINE_HEIGHT))
  onEditorScroll()
}

function applyReformat(indent: number): void {
  const r = reformat(text.value, indent)
  if (!r.ok) {
    applyParse()
    jumpToError()
    flash(`格式化失败：第 ${r.error.line} 行 ${r.error.message}`)
    return
  }
  text.value = r.text
  applyParse()
  flash(indent === 0 ? '已压缩' : '已格式化（2 空格缩进）')
}

function onFormat(): void {
  applyReformat(2)
}

function onMinify(): void {
  applyReformat(0)
}

function onValidate(): void {
  applyParse()
  if (status.value.state === 'error') {
    jumpToError()
    flash('校验失败：已定位到出错位置')
  } else if (status.value.state === 'ok') {
    flash('✓ JSON 有效')
  } else {
    flash('内容为空')
  }
}

function onClear(): void {
  text.value = ''
  applyParse()
  void nextTick(() => editorEl.value?.focus())
}

async function onCopy(): Promise<void> {
  if (text.value === '') {
    flash('内容为空')
    return
  }
  try {
    await props.ctx.host.clipboard.writeText(text.value)
    flash(`已复制 ${text.value.length} 字符`)
  } catch {
    flash('复制失败')
  }
}

// 等宽编辑器里 Tab 缩进两格（与格式化缩进一致），不把焦点切走
function onTab(e: KeyboardEvent): void {
  const ta = e.target as HTMLTextAreaElement
  const { selectionStart: s, selectionEnd: end } = ta
  e.preventDefault()
  text.value = `${text.value.slice(0, s)}  ${text.value.slice(end)}`
  void nextTick(() => ta.setSelectionRange(s + 2, s + 2))
}
</script>

<template>
  <div class="json-editor">
    <div class="toolbar">
      <span class="name">{{ ctx.manifest.icon }} JSON 编辑器</span>
      <span v-if="demoMode" class="demo-badge" title="当前展示稳定示例数据（deep-link demo 态，编辑不落盘）">
        示例数据
      </span>
      <button class="btn primary" title="以 2 空格缩进重新排版" @click="onFormat">格式化</button>
      <button class="btn" title="去掉所有多余空白" @click="onMinify">压缩</button>
      <button class="btn" title="立即校验并定位错误" @click="onValidate">校验</button>
      <button class="btn" @click="onClear">清空</button>
      <button class="btn" :class="{ on: treeOn }" :title="treeOn ? '切回编辑视图' : '全页查看结构树'" @click="toggleTree">
        {{ treeOn ? '编辑' : '树视图' }}
      </button>
      <span class="spacer"></span>
      <span class="tip" :title="tip">{{ tip }}</span>
      <button class="btn" :class="{ on: findOn }" title="查找 (Ctrl+F)" @click="toggleFind">查找</button>
      <button class="btn" :disabled="text === ''" @click="onCopy">复制</button>
      <button class="btn" @click="loadSample">载入示例</button>
    </div>

    <div v-if="findOn" class="findbar">
      <input
        ref="findEl"
        v-model="findText"
        class="find-input"
        placeholder="查找内容…"
        spellcheck="false"
        @keydown.enter.prevent="onFindStep($event.shiftKey ? -1 : 1)"
        @keydown.esc.prevent="closeFind"
      />
      <span class="find-count">{{ findCount === 0 ? '无匹配' : `${findIndex + 1}/${findCount}` }}</span>
      <button class="btn mini-btn" title="上一个 (Shift+Enter)" :disabled="findCount === 0" @click="onFindStep(-1)">↑</button>
      <button class="btn mini-btn" title="下一个 (Enter)" :disabled="findCount === 0" @click="onFindStep(1)">↓</button>
      <button class="btn mini-btn" title="关闭 (Esc)" @click="closeFind">×</button>
    </div>

    <div class="main">
      <section v-if="!treeOn" class="editor-pane">
        <div class="gutter" aria-hidden="true">
          <div class="gutter-move" :style="{ transform: `translateY(${-editScroll}px)`, height: `${lineCount * LINE_HEIGHT}px` }">
            <div
              v-for="n in visibleLineNumbers"
              :key="n"
              class="ln"
              :class="{ err: n === errLine }"
              :style="{ top: `${PAD_TOP + (n - 1) * LINE_HEIGHT}px` }"
            >
              {{ n }}
            </div>
          </div>
        </div>
        <div class="editor-container">
          <pre ref="hlEl" class="editor-hl" aria-hidden="true"><code v-html="highlightedText"></code></pre>
          <textarea
            ref="editorEl"
            v-model="text"
            class="editor-input"
            wrap="off"
            spellcheck="false"
            placeholder='输入或粘贴 JSON&#10;支持格式化 / 压缩 / 校验 / 复制'
            @scroll="onEditorScroll"
            @keydown.tab="onTab"
            @keydown.ctrl.f.prevent="openFind"
            @keydown.meta.f.prevent="openFind"
          ></textarea>
        </div>
      </section>

      <section v-else class="tree-pane">
        <div class="tree-bar">
          <span class="tree-title">树视图</span>
          <span class="tree-meta">{{ treeRows.length }} 行</span>
          <span class="spacer"></span>
          <button class="mini" title="展开全部节点（超过 5 万节点时拒绝）" @click="onExpandAll">全部展开</button>
          <button class="mini" @click="onCollapseAll">全部折叠</button>
        </div>
        <div ref="treeEl" class="tree" @scroll="onTreeScroll">
          <div class="tree-space" :style="{ height: `${treeRows.length * TREE_ROW_HEIGHT}px` }">
            <p v-if="treeRows.length === 0" class="tree-empty">有效 JSON 解析后在此展示结构</p>
            <div
              v-for="(row, idx) in visibleTreeRows"
              :key="row.id"
              class="node"
              :style="{ top: `${(treeWindow.start + idx) * TREE_ROW_HEIGHT}px`, paddingLeft: `${8 + row.depth * 14}px` }"
              :title="row.id"
            >
              <button v-if="row.hasChildren" class="tw" @click="toggleNode(row)">
                {{ expanded.has(row.id) ? '▾' : '▸' }}
              </button>
              <span v-else class="tw leaf"></span>
              <span class="key">{{ row.keyLabel }}</span>
              <span v-if="row.text !== null" class="val" :class="row.kind" title="点击复制该节点值" @click="copyNode(row)">
                {{ row.text }}
              </span>
              <template v-else>
                <span v-if="!expanded.has(row.id)" class="preview">{{ row.preview }}</span>
                <span v-else class="brace">{{ row.kind === 'array' ? '[' : '{' }}</span>
                <span class="badge" :class="row.kind">{{ row.childCount }}{{ row.kind === 'array' ? ' 项' : ' 键' }}</span>
              </template>
            </div>
          </div>
        </div>
      </section>
    </div>

    <footer class="statusbar" :class="status.state">
      <button
        v-if="status.state === 'error'"
        class="err-msg"
        title="点击定位到出错位置"
        @click="jumpToError"
      >
        ✗ 第 {{ status.error.line }} 行 第 {{ status.error.column }} 列：{{ status.error.message }}
      </button>
      <span v-else-if="status.state === 'ok'" class="ok-msg">✓ JSON 有效</span>
      <span v-else class="idle-msg">输入 JSON，实时校验</span>
      <span class="spacer"></span>
      <span class="meta">{{ lineCount }} 行 · {{ text.length }} 字符</span>
    </footer>
  </div>
</template>

<style scoped>
.json-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  min-height: 0;
  font-size: var(--fs-title);
}
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 40px;
}
.name {
  color: var(--fg);
  font-size: var(--fs-title);
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: nowrap;
}
.demo-badge {
  flex: none;
  padding: 2px var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  color: var(--warn);
  font-size: var(--fs-foot);
  white-space: nowrap;
  cursor: default;
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
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.spacer {
  flex: 1;
  min-width: 0;
}
.tip {
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--sp-2);
}
.editor-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--bg);
}
.gutter {
  flex: none;
  width: 44px;
  overflow: hidden;
  position: relative;
  background: var(--bg-raised);
  border-right: 1px solid var(--border);
  user-select: none;
}
.gutter-move {
  position: relative;
}
/* 行号与 textarea 逐行对齐依赖：两侧 line-height/上边距均为 22px/8px（见 LINE_HEIGHT/PAD_TOP） */
.ln {
  position: absolute;
  right: 8px;
  height: 22px;
  line-height: 22px;
  font-size: var(--fs-foot);
  color: var(--fg-dim);
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.ln.err {
  color: var(--danger);
  font-weight: 700;
}
.editor-container {
  flex: 1;
  min-width: 0;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: var(--bg);
}
.editor-hl,
.editor-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 8px 12px;
  border: none;
  box-sizing: border-box;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 22px;
  white-space: pre;
  tab-size: 2;
}
.editor-hl {
  overflow: hidden;
  pointer-events: none;
  background: transparent;
  color: var(--fg);
}
.editor-hl code {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  white-space: pre;
}
.editor-input {
  resize: none;
  outline: none;
  background: transparent;
  color: transparent;
  caret-color: var(--accent);
  overflow: auto;
  z-index: 1;
}
.editor-input::placeholder {
  color: var(--fg-dim);
}
.editor-input::selection {
  background: var(--find-hit);
  color: transparent;
}
.editor-hl :deep(.hl-key),
.hl-key {
  color: var(--accent);
  font-weight: 500;
}
.editor-hl :deep(.hl-str),
.hl-str {
  color: var(--ok);
}
.editor-hl :deep(.hl-num),
.hl-num {
  color: var(--warn);
}
.editor-hl :deep(.hl-bool),
.hl-bool {
  color: var(--danger);
  font-weight: 500;
}
.editor-hl :deep(.hl-null),
.hl-null {
  color: var(--fg-dim);
  font-style: italic;
}
.editor-hl :deep(.hl-punct),
.hl-punct {
  color: var(--fg-dim);
  opacity: 0.8;
}
.btn.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}
.mini-btn {
  height: 26px;
  padding: 0 9px;
}
.findbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.find-input {
  flex: 0 1 260px;
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--fg);
  font-size: var(--fs-sub);
  outline: none;
}
.find-input:focus {
  border-color: var(--accent);
}
.find-count {
  flex: none;
  min-width: 52px;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.tree-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  overflow: hidden;
  background: var(--bg);
}
.tree-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 32px;
  padding: 0 var(--sp-2) 0 var(--sp-3);
  background: var(--bg-raised);
  border-bottom: 1px solid var(--border);
}
.tree-title {
  font-size: var(--fs-sub);
  color: var(--fg);
  font-weight: 600;
}
.tree-meta {
  font-size: var(--fs-foot);
  color: var(--fg-dim);
}
.mini {
  flex: none;
  height: 22px;
  padding: 0 var(--sp-2);
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  cursor: pointer;
}
.mini:hover {
  background: var(--hover);
  color: var(--fg);
}
.tree {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
}
.tree-space {
  position: relative;
}
.tree-empty {
  position: absolute;
  top: 40%;
  left: 0;
  right: 0;
  margin: 0;
  text-align: center;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.node {
  position: absolute;
  left: 0;
  right: 0;
  height: 24px;
  display: flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  padding-right: var(--sp-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-sub);
  overflow: hidden;
  white-space: nowrap;
}
.node:hover {
  background: var(--hover);
}
.tw {
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}
.tw:hover {
  background: var(--hover);
  color: var(--fg);
}
.tw.leaf {
  cursor: default;
}
.node .key {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--accent);
  font-weight: 500;
}
.val {
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: copy;
}
.val.string {
  color: var(--ok);
}
.val.number {
  color: var(--warn);
}
.val.boolean {
  color: var(--danger);
  font-weight: 500;
}
.val.null {
  color: var(--fg-dim);
  font-style: italic;
}
.preview {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--fg-dim);
}
.brace {
  flex: none;
  color: var(--fg-dim);
}
.badge {
  flex: none;
  margin-left: var(--sp-1);
  padding: 0 var(--sp-1);
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  line-height: 16px;
}
.badge.array {
  background: var(--accent-dim);
  color: var(--accent);
}
.statusbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 30px;
  font-size: var(--fs-foot);
  color: var(--fg-dim);
}
.err-msg {
  border: none;
  padding: 2px var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  color: var(--danger);
  font-size: var(--fs-foot);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.err-msg:hover {
  background: var(--hover);
}
.statusbar.error .meta {
  color: var(--danger);
}
.ok-msg {
  color: var(--ok);
}
.idle-msg {
  color: var(--fg-dim);
}
.meta {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
