<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MatchFile, PluginContext } from '@sdk/api'
import {
  composeIncomingPayload,
  countLines,
  decodeUnicodeEscapes,
  escapeJsonString,
  expandIfJson,
  parseJson,
  parseJsonInfo,
  pathAt,
  posToLineCol,
  reformat,
  stripJsonc,
  unescapeJsonString,
  type JsonError
} from './logic/json'
import { highlightJson } from './logic/highlight'
import { decodeDraft, encodeDraft } from './logic/draft-codec'
import { findMatches, type SearchMatch } from './logic/search'
import { windowRange } from './logic/window'
import { SAMPLE_JSON } from './logic/sample'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string; initialPayload?: MatchFile[]; initialText?: string }>()

const DRAFT_KEY = 'draft'
const PARSE_DEBOUNCE_MS = 250
const SAVE_DEBOUNCE_MS = 500
/** 超过 1MB 跳过自动格式化（防粘贴大文件时全量重排卡顿），仍可手动格式化 */
const AUTO_FORMAT_MAX = 1_048_576
/** JSONPath 预览超过高亮逃逸阈值不再解析（每次光标移动全量走位的成本护栏） */
const PATH_MAX_LEN = 200_000
const SEARCH_DEBOUNCE_MS = 150
const LINE_HEIGHT = 22
const PAD_TOP = 8
/** 编辑器内容左内边距（与 .editor-input 的 padding 对齐），列偏移换算像素用 */
const PAD_LEFT = 12

// demo 态（deep-link demo=1 → initialCommand='demo'）：预填稳定示例且不落盘，避免覆盖用户草稿
const demoMode = props.initialCommand === 'demo'

const text = ref('')
type Status =
  | { state: 'idle' }
  | { state: 'ok'; ignored: number; dupKeys: number }
  | { state: 'error'; error: JsonError }
const status = ref<Status>({ state: 'idle' })
const tip = ref('')

const editorEl = ref<HTMLTextAreaElement | null>(null)
const hlEl = ref<HTMLElement | null>(null)
const searchInputEl = ref<HTMLInputElement | null>(null)

// 滚动位置与视口高度驱动行号槽虚拟窗口
const editScroll = ref(0)
const editViewportH = ref(0)

// 搜索条状态机：open/keyword/case/current；命中数组由防抖重算，标记经 highlightJson 叠加
const searchOpen = ref(false)
const searchKeyword = ref('')
const searchCase = ref(false)
const matches = ref<SearchMatch[]>([])
const matchesTruncated = ref(false)
const currentMatch = ref(-1)

// JSONPath 光标定位：strictOk/lenientSrc 随 applyParse 缓存，光标移动只重走 pathAt
const cursorOffset = ref(0)
const strictOk = ref(false)
const lenientSrc = ref<string | null>(null)

const highlightedText = computed(() =>
  highlightJson(text.value, searchOpen.value ? matches.value : [], currentMatch.value)
)

let parseTimer: ReturnType<typeof setTimeout> | undefined
let saveTimer: ReturnType<typeof setTimeout> | undefined
let tipTimer: ReturnType<typeof setTimeout> | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
let resizeObserver: ResizeObserver | undefined

const lineCount = computed(() => countLines(text.value))
const errLine = computed(() => (status.value.state === 'error' ? status.value.error.line : null))

const gutterWindow = computed(() => windowRange(lineCount.value, editScroll.value, editViewportH.value, LINE_HEIGHT))
const visibleLineNumbers = computed(() => {
  const { start, end } = gutterWindow.value
  const arr: number[] = []
  for (let i = start; i < end; i++) arr.push(i + 1)
  return arr
})

const matchCountLabel = computed(() => {
  if (searchKeyword.value === '') return ''
  const total = matchesTruncated.value ? `${matches.value.length}+` : `${matches.value.length}`
  return currentMatch.value >= 0 ? `${currentMatch.value + 1}/${total}` : `0/${total}`
})

const cursorPath = computed(() => {
  const t = text.value
  if (t.trim() === '' || t.length > PATH_MAX_LEN) return null
  const src = strictOk.value ? t : lenientSrc.value
  return src === null ? null : pathAt(src, cursorOffset.value)
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
    strictOk.value = false
    lenientSrc.value = null
    return
  }
  const strict = parseJsonInfo(t)
  if (strict.ok) {
    strictOk.value = true
    lenientSrc.value = null
    status.value = { state: 'ok', ignored: 0, dupKeys: strict.dupKeys }
    return
  }
  // 严格失败先试宽松（注释/尾逗号剥除）：宽松才合法不算错误，状态栏知情提示
  const s = stripJsonc(t)
  const lenient = s.ignored > 0 ? parseJsonInfo(s.text) : null
  if (lenient !== null && lenient.ok) {
    strictOk.value = false
    lenientSrc.value = s.text
    status.value = { state: 'ok', ignored: s.ignored, dupKeys: lenient.dupKeys }
  } else {
    strictOk.value = false
    lenientSrc.value = null
    status.value = { state: 'error', error: strict.error }
  }
}

function loadSample(): void {
  text.value = SAMPLE_JSON
  applyParse()
  autoFormat()
}

/** 自动格式化：优先走 expandIfJson（严格合法重排 + Mongo 导出等宽松 JSON 归一化展开，
 *  危险数字形状与不可解析文本原样）；1MB 上限防大文本同步 parse 卡顿 */
function autoFormat(): void {
  const t = text.value
  if (t.trim() === '') return
  if (t.length > AUTO_FORMAT_MAX) {
    flash('内容较大，未自动格式化')
    return
  }
  const expanded = expandIfJson(t)
  if (expanded !== t) {
    text.value = expanded
    applyParse()
    void nextTick(() => editorEl.value?.setSelectionRange(0, 0))
  }
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

// 截断只提示一次：每击键防抖都弹会刷屏；完整压缩保存时不弹
let draftTruncationWarned = false

async function persist(): Promise<void> {
  if (demoMode) return
  try {
    const { stored, truncated } = await encodeDraft(text.value)
    await props.ctx.host.storage.set(DRAFT_KEY, stored)
    if (truncated && !draftTruncationWarned) {
      draftTruncationWarned = true
      flash('草稿过大，未能完整保存')
    }
  } catch {
    // 存储失败不打断编辑，下次防抖再试
  }
}

// detached 两阶段关窗：宿主派发本事件，挂起的保存防抖立即冲刷落盘；detail.track 上报 persist promise，
// 宿主等落盘真完成才 ACK；主窗挂载时无人派发本事件，监听无害
function onFlushDrafts(e: Event): void {
  if (saveTimer === undefined) return
  clearTimeout(saveTimer)
  saveTimer = undefined
  const p = persist()
  ;(e as CustomEvent<{ track?(p: Promise<unknown>): void }>).detail?.track?.(p)
}

function onDocSelectionChange(): void {
  const ta = editorEl.value
  if (ta === null || document.activeElement !== ta) return
  cursorOffset.value = ta.selectionStart
}

onMounted(async () => {
  observeSizes()
  document.addEventListener('selectionchange', onDocSelectionChange)
  // 主窗挂载也无害：主窗不发 flush 事件，监听只在 detached 关窗冲刷时生效
  window.addEventListener('gtools:flush-drafts', onFlushDrafts)
  if (demoMode) {
    loadSample()
    return
  }
  // 深链 query 与拖入文件内容仅当自身是合法 JSON 才整体替换草稿（文件优先）；非 JSON 残留不动旧草稿；
  // 无草稿无输入给空编辑器（placeholder 引导 + 工具栏「载入示例」），不预填示例避免被当草稿落盘
  let base = ''
  try {
    const d = await props.ctx.host.storage.get<unknown>(DRAFT_KEY)
    base = await decodeDraft(d)
  } catch {
    base = ''
  }
  const q = [props.query.trim(), (props.initialText ?? '').trim()].filter((s) => s !== '').join('\n')
  const fileText = await loadPayloadFiles()
  text.value = composeIncomingPayload(base, q, fileText)
  applyParse()
  autoFormat()
  void nextTick(() => editorEl.value?.focus())
})

onBeforeUnmount(() => {
  if (parseTimer !== undefined) clearTimeout(parseTimer)
  if (tipTimer !== undefined) clearTimeout(tipTimer)
  if (searchTimer !== undefined) clearTimeout(searchTimer)
  document.removeEventListener('selectionchange', onDocSelectionChange)
  window.removeEventListener('gtools:flush-drafts', onFlushDrafts)
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer)
    void persist()
  }
  resizeObserver?.disconnect()
})

// 实时校验防抖 + 草稿防抖落盘；nextTick 同步高亮层尺寸（滚动条出现只改 clientWidth，ResizeObserver 不触发）
watch(text, () => {
  if (parseTimer !== undefined) clearTimeout(parseTimer)
  parseTimer = setTimeout(applyParse, PARSE_DEBOUNCE_MS)
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    void persist()
  }, SAVE_DEBOUNCE_MS)
  void nextTick(syncEditorMetrics)
})

watch([text, searchKeyword, searchCase], () => {
  if (!searchOpen.value) return
  if (searchTimer !== undefined) clearTimeout(searchTimer)
  searchTimer = setTimeout(recomputeMatches, SEARCH_DEBOUNCE_MS)
})

function syncEditorMetrics(): void {
  const ta = editorEl.value
  const hl = hlEl.value
  if (ta !== null) editViewportH.value = ta.clientHeight
  // 高亮层盒显式钉在 textarea 内容盒上：全局 10px 滚动条槽出现会让内容盒各窄 10px，
  // 恒 100% 宽的高亮层就会与正文横向错开/右缘空带；width 同步顺带消掉 scrollLeft 上限差
  if (ta !== null && hl !== null) {
    hl.style.width = `${ta.clientWidth}px`
    hl.style.height = `${ta.clientHeight}px`
  }
}

function observeSizes(): void {
  syncEditorMetrics()
  const ta = editorEl.value
  if (typeof ResizeObserver === 'undefined' || ta === null) return
  resizeObserver = new ResizeObserver(() => syncEditorMetrics())
  resizeObserver.observe(ta)
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

// 等宽字符宽只测一次（隐藏探针挂在已带编辑器字体的高亮层里），列偏移估算像素用
let cachedCharWidth = 0
function measureCharWidth(): number {
  if (cachedCharWidth > 0) return cachedCharWidth
  const host = hlEl.value
  if (host === null) return 0
  const span = document.createElement('span')
  span.style.position = 'absolute'
  span.style.visibility = 'hidden'
  span.style.whiteSpace = 'pre'
  span.textContent = '0'.repeat(20)
  host.appendChild(span)
  cachedCharWidth = span.getBoundingClientRect().width / 20
  span.remove()
  return cachedCharWidth
}

/** 光标 offset 垂直居中 + 横向 scrollLeft 居中（wrap="off" 下长行命中不滚出视口） */
function centerOffset(offset: number): void {
  const ta = editorEl.value
  if (ta === null) return
  const { line, column } = posToLineCol(text.value, offset)
  ta.scrollTop = Math.max(0, (line - 1) * LINE_HEIGHT - Math.max(0, ta.clientHeight / 2 - LINE_HEIGHT))
  const w = measureCharWidth()
  if (w > 0) ta.scrollLeft = Math.max(0, (column - 1) * w + PAD_LEFT - ta.clientWidth / 2)
  onEditorScroll()
}

function jumpToError(): void {
  if (status.value.state !== 'error') return
  const { offset } = status.value.error
  const ta = editorEl.value
  if (ta === null) return
  ta.focus()
  ta.setSelectionRange(offset, Math.min(offset + 1, text.value.length))
  cursorOffset.value = offset
  centerOffset(offset)
}

// 搜索条 -------------------------------------------------------------------

function recomputeMatches(): void {
  searchTimer = undefined
  const { matches: ms, truncated } = findMatches(text.value, searchKeyword.value, searchCase.value)
  matches.value = ms
  matchesTruncated.value = truncated
  currentMatch.value = ms.length > 0 ? 0 : -1
  if (currentMatch.value >= 0) revealMatch()
}

function openSearch(): void {
  searchOpen.value = true
  const ta = editorEl.value
  const sel = ta !== null ? text.value.slice(ta.selectionStart, ta.selectionEnd) : ''
  if (sel !== '') searchKeyword.value = sel
  recomputeMatches()
  void nextTick(() => {
    searchInputEl.value?.focus()
    searchInputEl.value?.select()
  })
}

// Esc 关搜索条必须 preventDefault：宿主窗口级 Esc 会退出插件但尊重 defaultPrevented（App.vue），
// 不阻断就是「关搜索条 + 退出插件」双动作；搜索条已关时 Esc 才冒泡给宿主逐级退出
function closeSearch(): void {
  searchOpen.value = false
  matches.value = []
  matchesTruncated.value = false
  currentMatch.value = -1
  void nextTick(() => editorEl.value?.focus())
}

function stepMatch(dir: 1 | -1): void {
  const len = matches.value.length
  if (len === 0) return
  const cur = currentMatch.value
  currentMatch.value = cur < 0 ? 0 : (cur + dir + len) % len
  revealMatch()
}

// 不抢焦点：命中呈现靠高亮层 mark（textarea 文本本就透明），焦点留在搜索框才能连续 Enter 跳转
function revealMatch(): void {
  const ta = editorEl.value
  const idx = currentMatch.value
  if (ta === null || idx < 0 || idx >= matches.value.length) return
  const m = matches.value[idx]
  ta.setSelectionRange(m.start, m.end)
  cursorOffset.value = m.start
  centerOffset(m.start)
}

function onSearchKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  if (e.key === 'Enter') {
    e.preventDefault()
    stepMatch(e.shiftKey ? -1 : 1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    closeSearch()
  }
}

function toggleSearchCase(): void {
  searchCase.value = !searchCase.value
  if (searchOpen.value) {
    if (searchTimer !== undefined) clearTimeout(searchTimer)
    recomputeMatches()
  }
}

function onEditorKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return
  if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    openSearch()
    return
  }
  if (e.key === 'F3') {
    e.preventDefault()
    if (searchOpen.value) stepMatch(1)
    else openSearch()
    return
  }
  if (e.key === 'Escape' && searchOpen.value) {
    e.preventDefault()
    closeSearch()
  }
}

// 工具动作 -------------------------------------------------------------------

// 粘贴前编辑器为空/纯空白才自动格式化：已有内容时拼接结果多半非法，交回状态栏提示
async function onPaste(): Promise<void> {
  const before = text.value
  await nextTick()
  if (before.trim() === '') autoFormat()
}

/** 手动格式化/压缩允许预剥（宽松才合法时先 stripJsonc）；程序化设 value 会清空 textarea 撤销栈、
 *  剥掉的注释不可恢复，flash 必须明示丢弃处数 */
function applyReformat(indent: number): void {
  const src = text.value
  let body = src
  let ignored = 0
  if (!parseJson(src).ok) {
    const s = stripJsonc(src)
    if (s.ignored > 0 && parseJson(s.text).ok) {
      body = s.text
      ignored = s.ignored
    }
  }
  const r = reformat(body, indent)
  if (!r.ok) {
    applyParse()
    jumpToError()
    flash(`格式化失败：第 ${r.error.line} 行 ${r.error.message}`)
    return
  }
  text.value = r.text
  applyParse()
  flash(
    ignored > 0
      ? `已${indent === 0 ? '压缩' : '格式化'}（丢弃 ${ignored} 处注释/尾逗号，撤销栈已清空）`
      : indent === 0
        ? '已压缩'
        : '已格式化（2 空格缩进）'
  )
  void nextTick(() => editorEl.value?.setSelectionRange(0, 0))
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
    flash(status.value.ignored > 0 ? `✓ JSON 有效（已忽略 ${status.value.ignored} 处注释/尾逗号）` : '✓ JSON 有效')
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

function onEscapeJson(): void {
  if (text.value === '') {
    flash('内容为空')
    return
  }
  text.value = escapeJsonString(text.value)
  flash('已转义为 JSON 字符串字面量')
}

function onUnescapeJson(): void {
  const out = unescapeJsonString(text.value)
  if (out === null) {
    flash('不是单个 JSON 字符串字面量，未改写')
    return
  }
  text.value = out
  flash('已还原字符串内容')
}

function onDecodeUnicode(): void {
  const out = decodeUnicodeEscapes(text.value)
  if (out === text.value) {
    flash('未发现 \\uXXXX 转义')
    return
  }
  text.value = out
  flash('已把 \\uXXXX 转为字符')
}

async function onCopyPath(): Promise<void> {
  const p = cursorPath.value
  if (p === null) {
    flash('光标处未定位到 JSON 路径')
    return
  }
  try {
    await props.ctx.host.clipboard.writeText(p)
    flash(`已复制 ${p}`)
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
      <button class="btn primary" title="以 2 空格缩进重新排版（含注释/尾逗号时剥除并明示）" @click="onFormat">
        格式化
      </button>
      <button class="btn" title="去掉所有多余空白（含注释/尾逗号时剥除并明示）" @click="onMinify">压缩</button>
      <button class="btn" title="立即校验并定位错误" @click="onValidate">校验</button>
      <button class="btn" title="整文转为带引号的 JSON 字符串字面量" @click="onEscapeJson">转义</button>
      <button class="btn" title="整文恰为单个 JSON 字符串字面量时还原其内容" @click="onUnescapeJson">去转义</button>
      <button class="btn" title="把 \uXXXX 转义还原为字符（代理对合并）" @click="onDecodeUnicode">U→中</button>
      <button class="btn" title="查找（Ctrl+F，Enter/Shift+Enter 跳转，Esc 关闭）" @click="openSearch">搜索</button>
      <button class="btn" @click="onClear">清空</button>
      <span class="spacer"></span>
      <span class="tip" :title="tip">{{ tip }}</span>
      <button class="btn" :disabled="text === ''" @click="onCopy">复制</button>
      <button class="btn" @click="loadSample">载入示例</button>
    </div>

    <div v-if="searchOpen" class="searchbar">
      <input
        ref="searchInputEl"
        v-model="searchKeyword"
        class="search-input"
        type="text"
        spellcheck="false"
        placeholder="查找…"
        @keydown="onSearchKeydown"
      />
      <span class="search-count" :title="matchesTruncated ? `命中过多，仅标记前 ${matches.length} 处` : ''">
        {{ matchCountLabel }}
      </span>
      <button class="btn sm" :class="{ active: searchCase }" title="区分大小写" @click="toggleSearchCase">
        Aa
      </button>
      <button class="btn sm" title="上一个（Shift+Enter）" :disabled="matches.length === 0" @click="stepMatch(-1)">
        ↑
      </button>
      <button class="btn sm" title="下一个（Enter / F3）" :disabled="matches.length === 0" @click="stepMatch(1)">
        ↓
      </button>
      <button class="btn sm" title="关闭（Esc，还焦编辑器）" @click="closeSearch">×</button>
    </div>

    <section class="editor-pane">
      <div class="gutter" aria-hidden="true">
        <div
          class="gutter-move"
          :style="{ transform: `translateY(${-editScroll}px)`, height: `${lineCount * LINE_HEIGHT + PAD_TOP * 2}px` }"
        >
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
          placeholder="输入或粘贴 JSON，自动格式化；Ctrl+F 搜索"
          @scroll="onEditorScroll"
          @keydown="onEditorKeydown"
          @keydown.tab="onTab"
          @paste="onPaste"
        ></textarea>
      </div>
    </section>

    <footer class="statusbar" :class="status.state">
      <button
        v-if="status.state === 'error'"
        class="err-msg"
        title="点击定位到出错位置"
        @click="jumpToError"
      >
        ✗ 第 {{ status.error.line }} 行 第 {{ status.error.column }} 列：{{ status.error.message }}
      </button>
      <span v-else-if="status.state === 'ok'" class="ok-msg">
        ✓ JSON 有效<template v-if="status.ignored > 0"> · 已忽略 {{ status.ignored }} 处注释/尾逗号</template
        ><template v-if="status.dupKeys > 0"> · 重复键 {{ status.dupKeys }} 处（格式化保留最后值）</template>
      </span>
      <span v-else class="idle-msg">输入或粘贴 JSON，自动格式化；Ctrl+F 搜索</span>
      <span class="spacer"></span>
      <button
        v-if="cursorPath !== null"
        class="path-btn"
        :title="`复制光标处路径 ${cursorPath}`"
        @click="onCopyPath"
      >
        {{ cursorPath }}
      </button>
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
/* 插件态 minWidth 520（App.vue）而按钮全 flex:none：溢出靠换行兜底，不许顶穿面板边框 */
.toolbar {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  row-gap: var(--sp-1);
  min-height: 40px;
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
.btn.sm {
  height: 26px;
  padding: 0 8px;
}
.btn:hover:not(:disabled) {
  background: var(--hover);
}
.btn.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.btn.active {
  border-color: var(--accent);
  background: var(--accent-dim);
  color: var(--accent);
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
.searchbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 32px;
}
.search-input {
  flex: 0 1 220px;
  min-width: 120px;
  height: 28px;
  padding: 0 var(--sp-2);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--fill-well);
  color: var(--fg);
  font-size: var(--fs-sub);
  outline: none;
}
.search-input:focus {
  border-color: var(--accent);
}
.search-count {
  flex: none;
  min-width: 48px;
  text-align: center;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
/* 单 pane 单底色：透明/玻璃主题下 --border 是半透明色，多层半透明底叠加会让 1px 边框视觉重影，
   gutter 不再要独立底色，只以一条 border-right 分区 */
.editor-pane {
  flex: 1;
  min-height: 0;
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
}
.editor-hl,
.editor-input {
  position: absolute;
  top: 0;
  left: 0;
  /* 缺尺寸时 absolute textarea 按默认 rows=2/cols=20 渲染，视口塌陷成约 2 行高（v0.0.29 回归根因） */
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
  background: var(--active-row);
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
/* 显式覆盖 <mark> 的 UA 黄底黑字：普通命中主题弱底、当前命中主题强调色 */
.editor-hl :deep(mark.hl-hit) {
  background: var(--accent-dim);
  color: inherit;
}
.editor-hl :deep(mark.hl-hit-cur) {
  background: var(--accent);
  color: var(--on-accent);
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.idle-msg {
  color: var(--fg-dim);
}
.path-btn {
  flex: none;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: none;
  padding: 2px var(--sp-2);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fs-foot);
  cursor: copy;
}
.path-btn:hover {
  background: var(--hover);
}
.meta {
  flex: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
