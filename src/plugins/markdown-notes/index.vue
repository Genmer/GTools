<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import { renderMarkdown } from './logic/render'
import { buildClipboardHtml, sanitizeFilename, withMdExtension } from './logic/richtext'
import { demoNotesState } from './logic/demo'
import {
  NOTES_STORAGE_KEY,
  WELCOME_CONTENT,
  createNote,
  deleteNote,
  deriveSummary,
  displayTitle,
  emptyNotesState,
  filterNotes,
  normalizeNotesState,
  renameNote,
  selectNote,
  updateNoteContent
} from './logic/notes'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

// demo 态（截图/新手引导）：固定示例数据，一切写盘操作跳过
const isDemo = props.initialCommand === 'demo'

type ViewMode = 'edit' | 'preview'

const state = ref(emptyNotesState())
const currentId = ref<string | null>(null)
const content = ref('')
const search = ref('')
const viewMode = ref<ViewMode>('edit')
const statusMsg = ref('')
const statusKind = ref<'ok' | 'error'>('ok')
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const confirmingId = ref<string | null>(null)
const menuOpen = ref(false)

const editorRef = ref<HTMLTextAreaElement | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | undefined
let statusTimer: ReturnType<typeof setTimeout> | undefined

const currentNote = computed(() => state.value.notes.find((n) => n.id === currentId.value) ?? null)
const visibleNotes = computed(() => filterNotes(state.value.notes, search.value))
const rendered = computed(() => renderMarkdown(content.value))

// 外壳搜索框 keyword 后的剩余输入直达标题搜索（md 关键词 → 过滤笔记）
watch(
  () => props.query,
  (q) => {
    search.value = q.trim()
  },
  { immediate: true }
)

onMounted(async () => {
  if (isDemo) {
    state.value = demoNotesState()
    currentId.value = state.value.lastNoteId
    content.value = currentNote.value?.content ?? ''
    return
  }
  try {
    state.value = normalizeNotesState(await props.ctx.host.storage.get(NOTES_STORAGE_KEY))
  } catch {
    state.value = emptyNotesState()
  }
  currentId.value = state.value.lastNoteId ?? state.value.notes[0]?.id ?? null
  content.value = currentNote.value?.content ?? ''
})

onBeforeUnmount(() => {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer)
    saveTimer = undefined
    void persist()
  }
  if (statusTimer !== undefined) clearTimeout(statusTimer)
})

async function persist(): Promise<void> {
  if (isDemo) return
  try {
    await props.ctx.host.storage.set(NOTES_STORAGE_KEY, state.value)
  } catch {
    showStatus('保存失败（本地存储不可用）', 'error')
  }
}

function scheduleSave(): void {
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    void persist()
  }, 400)
}

function showStatus(msg: string, kind: 'ok' | 'error' = 'ok'): void {
  statusMsg.value = msg
  statusKind.value = kind
  if (statusTimer !== undefined) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => (statusMsg.value = ''), 2000)
}

function onInput(): void {
  if (currentId.value === null) return
  state.value = updateNoteContent(state.value, currentId.value, content.value, Date.now())
  scheduleSave()
}

function onPick(id: string): void {
  if (id === currentId.value) return
  // 切换前先落盘旧笔记（content 已实时进 state，这里只负责把防抖中的写盘立即兑现）
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }
  state.value = selectNote(state.value, id)
  currentId.value = id
  content.value = currentNote.value?.content ?? ''
  void persist()
  if (viewMode.value === 'edit') void nextTick(() => editorRef.value?.focus())
}

function onNew(welcome = false): void {
  const { state: s, note } = createNote(state.value, Date.now(), welcome ? WELCOME_CONTENT : '')
  state.value = s
  currentId.value = note.id
  content.value = note.content
  viewMode.value = 'edit'
  confirmingId.value = null
  void persist()
  void nextTick(() => editorRef.value?.focus())
}

function startRename(id: string): void {
  const note = state.value.notes.find((n) => n.id === id)
  if (note === undefined) return
  confirmingId.value = null
  renamingId.value = id
  renameDraft.value = note.title
}

function confirmRename(): void {
  const id = renamingId.value
  if (id === null) return
  renamingId.value = null
  const next = renameNote(state.value, id, renameDraft.value)
  if (next !== state.value) {
    state.value = next
    void persist()
  }
}

function cancelRename(): void {
  renamingId.value = null
}

function onRenameEnter(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter 只上屏，不确认重命名
  confirmRename()
}

function askDelete(id: string): void {
  confirmingId.value = id
  renamingId.value = null
  menuOpen.value = false
}

function askDeleteCurrent(): void {
  if (currentId.value !== null) askDelete(currentId.value)
}

function cancelDelete(): void {
  confirmingId.value = null
}

function doDelete(id: string): void {
  confirmingId.value = null
  state.value = deleteNote(state.value, id)
  if (currentId.value === id) {
    currentId.value = state.value.notes[0]?.id ?? null
    content.value = currentNote.value?.content ?? ''
  }
  void persist()
}

async function onExport(): Promise<void> {
  const note = currentNote.value
  if (note === null) return
  try {
    const target = await props.ctx.host.dialog.saveFile({
      title: '导出笔记',
      defaultPath: withMdExtension(sanitizeFilename(displayTitle(note))),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (target === null) return
    await props.ctx.host.fs.write(target, note.content)
    showStatus('已导出 .md')
  } catch (err) {
    showStatus(err instanceof Error ? `导出失败：${err.message}` : '导出失败', 'error')
  }
}

async function onCopyRich(): Promise<void> {
  const note = currentNote.value
  if (note === null || note.content.trim() === '') return
  const html = buildClipboardHtml(renderMarkdown(note.content))
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard !== undefined) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([note.content], { type: 'text/plain' })
        })
      ])
      showStatus('已复制富文本')
      return
    }
  } catch {
    // 窗口失焦等场景 Clipboard API 会拒绝，走选中复制降级
  }
  if (copyViaSelection(html)) {
    showStatus('已复制富文本')
    return
  }
  try {
    await props.ctx.host.clipboard.writeText(note.content)
    showStatus('已复制 Markdown 源码')
  } catch {
    showStatus('复制失败', 'error')
  }
}

function copyViaSelection(html: string): boolean {
  const host = document.createElement('div')
  host.innerHTML = html
  host.style.position = 'fixed'
  host.style.left = '-9999px'
  host.style.opacity = '0'
  document.body.appendChild(host)
  const range = document.createRange()
  range.selectNodeContents(host)
  const sel = window.getSelection()
  if (sel === null) {
    host.remove()
    return false
  }
  sel.removeAllRanges()
  sel.addRange(range)
  const ok = document.execCommand('copy')
  sel.removeAllRanges()
  host.remove()
  return ok
}

async function onCopySource(): Promise<void> {
  const note = currentNote.value
  if (note === null || note.content === '') return
  try {
    await props.ctx.host.clipboard.writeText(note.content)
    showStatus('已复制源码')
  } catch {
    showStatus('复制失败', 'error')
  }
}

function runMenu(action: () => void | Promise<void>): void {
  menuOpen.value = false
  void action()
}

// 编辑器内 Tab 缩进两格（Markdown 嵌套列表需要）
function onTab(e: KeyboardEvent): void {
  const el = e.target as HTMLTextAreaElement
  const { selectionStart: s, selectionEnd: end } = el
  e.preventDefault()
  content.value = `${content.value.slice(0, s)}  ${content.value.slice(end)}`
  onInput()
  void nextTick(() => el.setSelectionRange(s + 2, s + 2))
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
</script>

<template>
  <div class="markdown-notes">
    <div class="toolbar">
      <span v-if="isDemo" class="demo-badge" title="demo 模式：展示用示例数据，操作不保存">示例数据</span>
      <button class="btn primary" @click="onNew()">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
        新建笔记
      </button>
      <template v-if="currentNote !== null && confirmingId === currentNote.id">
        <span class="confirm-hint" :title="`删除「${displayTitle(currentNote)}」？`">
          删除「{{ displayTitle(currentNote) }}」？
        </span>
        <button class="btn danger" @click="doDelete(currentNote.id)">确认删除</button>
        <button class="btn" @click="cancelDelete">取消</button>
      </template>
      <button v-else class="btn danger-ghost" :disabled="currentNote === null" @click="askDeleteCurrent">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        删除
      </button>

      <span class="spacer"></span>
      <span v-if="statusMsg !== ''" class="status" :class="statusKind">{{ statusMsg }}</span>

      <div class="seg" role="tablist" aria-label="视图切换">
        <button type="button" role="tab" :aria-selected="viewMode === 'edit'" :class="{ on: viewMode === 'edit' }" :disabled="currentNote === null" @click="viewMode = 'edit'">编辑</button>
        <button type="button" role="tab" :aria-selected="viewMode === 'preview'" :class="{ on: viewMode === 'preview' }" :disabled="currentNote === null" @click="viewMode = 'preview'">预览</button>
      </div>
      <button class="btn" :disabled="currentNote === null" title="导出为 .md 文件" @click="onExport">导出 .md</button>
      <div class="menu-anchor">
        <button
          class="icon-btn"
          title="更多操作"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <circle cx="12" cy="5" r="1.6" fill="currentColor" />
            <circle cx="12" cy="12" r="1.6" fill="currentColor" />
            <circle cx="12" cy="19" r="1.6" fill="currentColor" />
          </svg>
        </button>
        <div v-if="menuOpen" class="menu" role="menu">
          <button
            class="menu-item"
            role="menuitem"
            :disabled="currentNote === null || content.trim() === ''"
            @click="runMenu(onCopyRich)"
          >
            复制富文本
          </button>
          <button
            class="menu-item"
            role="menuitem"
            :disabled="currentNote === null || content === ''"
            @click="runMenu(onCopySource)"
          >
            复制源码
          </button>
        </div>
        <div v-if="menuOpen" class="menu-mask" @click="menuOpen = false"></div>
      </div>
    </div>

    <div class="body">
      <aside class="sidebar">
        <div class="side-head">
          <input v-model="search" class="search" type="text" placeholder="搜索标题…" spellcheck="false" />
          <button class="icon-btn" title="新建笔记" @click="onNew()">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </div>
        <div class="list">
          <div
            v-for="n in visibleNotes"
            :key="n.id"
            class="note-item"
            :class="{ active: n.id === currentId }"
            @click="onPick(n.id)"
            @dblclick="startRename(n.id)"
          >
            <input
              v-if="renamingId === n.id"
              v-model="renameDraft"
              class="rename"
              type="text"
              placeholder="笔记标题"
              spellcheck="false"
              @click.stop
              @keydown.enter.stop.prevent="onRenameEnter"
              @keydown.esc.stop.prevent="cancelRename"
              @blur="confirmRename"
            />
            <template v-else>
              <div class="note-row">
                <span class="note-title" :title="displayTitle(n)">{{ displayTitle(n) }}</span>
                <span v-if="confirmingId !== n.id" class="ops" @click.stop>
                  <button class="mini" title="重命名（或双击标题）" @click="startRename(n.id)">
                    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                      <path
                        d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17l-1 3zM14 7l3 3"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>
                  <button class="mini danger" title="删除" @click="askDelete(n.id)">
                    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                      <path
                        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.8"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                  </button>
                </span>
              </div>
              <p class="note-summary">{{ deriveSummary(n) }}</p>
              <div class="note-time-row">
                <span class="note-time">{{ formatTime(n.updatedAt) }}</span>
                <span v-if="confirmingId === n.id" class="confirm" @click.stop>
                  <button class="mini danger" @click="doDelete(n.id)">确认删除</button>
                  <button class="mini" @click="cancelDelete">取消</button>
                </span>
              </div>
            </template>
          </div>
          <p v-if="state.notes.length > 0 && visibleNotes.length === 0" class="list-empty">没有匹配的笔记</p>
        </div>
      </aside>

      <div class="main">
        <div v-if="state.notes.length === 0" class="empty">
          <svg class="empty-icon" viewBox="0 0 24 24" width="44" height="44" aria-hidden="true">
            <path
              d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM15 3v4h4M9 12h6M9 16h4"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <p class="empty-title">还没有笔记</p>
          <p class="empty-sub">第一篇从这里开始，编辑自动保存到本地</p>
          <div class="empty-actions">
            <button class="btn primary" @click="onNew()">＋ 新建笔记</button>
            <button class="btn" @click="onNew(true)">填充语法示例</button>
          </div>
        </div>
        <template v-else-if="currentNote !== null">
          <textarea
            v-if="viewMode === 'edit'"
            ref="editorRef"
            v-model="content"
            class="editor"
            placeholder="输入 Markdown…（# 标题 / - 列表 / ``` 代码 / | 表格 |，自动保存）"
            spellcheck="false"
            @input="onInput"
            @keydown.tab="onTab"
          ></textarea>
          <div v-else class="preview">
            <div v-if="rendered === ''" class="preview-empty">空笔记，切到「编辑」开始书写</div>
            <!-- 内容经 render.ts 白名单渲染，源文本 HTML 已全转义 -->
            <div v-else class="preview-body" v-html="rendered"></div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.markdown-notes {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  font-size: var(--fs-sub);
  color: var(--fg);
}

/* ---- 工具栏（§2：高 40px 透明底，图标按钮 28×28）---- */
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 40px;
  padding: 0 var(--sp-2);
}
.demo-badge {
  flex: none;
  padding: 2px 8px;
  border-radius: var(--r-sm);
  background: var(--accent-dim);
  color: var(--accent);
  font-size: var(--fs-foot);
  cursor: default;
}
.btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
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
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}
.btn.primary:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(1.08);
}
.btn.danger {
  border-color: var(--danger);
  background: var(--danger);
  color: var(--on-accent);
}
.btn.danger:hover:not(:disabled) {
  background: var(--danger);
  filter: brightness(1.08);
}
.btn.danger-ghost {
  border-color: var(--border);
  color: var(--danger);
}
.btn.danger-ghost:hover:not(:disabled) {
  background: var(--hover);
}
.confirm-hint {
  flex: none;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--danger);
  font-size: var(--fs-sub);
}
.spacer {
  flex: 1;
}
.status {
  flex: none;
  font-size: var(--fs-foot);
  color: var(--fg-dim);
}
.status.ok {
  color: var(--ok);
}
.status.error {
  color: var(--danger);
}
.seg {
  flex: none;
  display: inline-flex;
  gap: 2px;
  height: 32px;
  padding: 2px;
  border-radius: var(--r-md);
  background: var(--bg-raised);
}
.seg button {
  border: none;
  padding: 0 12px;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.seg button:hover:not(:disabled):not(.on) {
  color: var(--fg);
}
.seg button.on {
  background: var(--accent-dim);
  color: var(--accent);
  font-weight: 600;
}
.seg button:disabled {
  opacity: 0.45;
  cursor: default;
}
.icon-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}
.icon-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg);
}
.menu-anchor {
  position: relative;
  flex: none;
}
.menu-mask {
  position: fixed;
  inset: 0;
  z-index: 10;
}
.menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 11;
  min-width: 132px;
  padding: var(--sp-1);
  border-radius: var(--r-md);
  background: var(--bg-raised);
  box-shadow: var(--shadow-pop);
}
.menu-item {
  display: block;
  width: 100%;
  padding: 6px 12px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-sub);
  text-align: left;
  cursor: pointer;
}
.menu-item:hover:not(:disabled) {
  background: var(--hover);
}
.menu-item:disabled {
  opacity: 0.45;
  cursor: default;
}

/* ---- 左列表：以 --bg-raised 拉开层级（§1.1 用底色差不用边框）---- */
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.sidebar {
  flex: none;
  width: 248px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-raised);
}
.side-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2);
}
.search {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: none;
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--fg);
  font-size: var(--fs-sub);
  outline: none;
}
.search:focus {
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.search::placeholder {
  color: var(--fg-dim);
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--sp-2) var(--sp-2);
}
.note-item {
  padding: var(--sp-2) 10px;
  margin-bottom: 2px;
  border-radius: var(--r-md);
  cursor: pointer;
}
.note-item:hover {
  background: var(--hover);
}
.note-item.active {
  background: var(--active-row);
}
.note-row {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}
.note-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-title);
}
.note-item.active .note-title {
  color: var(--accent);
  font-weight: 600;
}
.note-summary {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.note-summary:empty {
  display: none;
}
.note-time-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-1);
  margin-top: 2px;
}
.note-time {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.ops {
  flex: none;
  display: inline-flex;
  gap: 2px;
  opacity: 0;
}
.note-item:hover .ops,
.note-item.active .ops {
  opacity: 1;
}
.confirm {
  flex: none;
  display: inline-flex;
  gap: var(--sp-1);
}
.mini {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  height: 20px;
  padding: 0 3px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  cursor: pointer;
}
.note-item:hover .mini:hover {
  background: var(--hover);
  color: var(--fg);
}
.mini.danger,
.note-item:hover .mini.danger:hover {
  color: var(--danger);
}
.rename {
  width: 100%;
  box-sizing: border-box;
  padding: 2px var(--sp-1);
  border: none;
  border-radius: var(--r-sm);
  background: var(--bg);
  color: var(--fg);
  font-size: var(--fs-title);
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.rename::placeholder {
  color: var(--fg-dim);
}
.list-empty {
  margin: var(--sp-4) 0;
  text-align: center;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}

/* ---- 右侧编辑/预览 ---- */
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.editor {
  flex: 1;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
  padding: var(--sp-4);
  border: none;
  outline: none;
  resize: none;
  background: var(--bg);
  color: var(--fg);
  caret-color: var(--accent);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  line-height: 1.65;
}
.editor::placeholder {
  color: var(--fg-dim);
}
.preview {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-4) var(--sp-5);
  line-height: 1.65;
  user-select: text;
}
.preview-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.preview-body {
  max-width: 720px;
  margin: 0 auto;
}
.preview-body :deep(h1),
.preview-body :deep(h2),
.preview-body :deep(h3),
.preview-body :deep(h4),
.preview-body :deep(h5),
.preview-body :deep(h6) {
  margin: 0.6em 0 0.35em;
  line-height: 1.3;
}
.preview-body :deep(h1:first-child),
.preview-body :deep(h2:first-child),
.preview-body :deep(h3:first-child) {
  margin-top: 0;
}
.preview-body :deep(h1),
.preview-body :deep(h2) {
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.25em;
}
.preview-body :deep(p) {
  margin: 0.4em 0;
}
.preview-body :deep(ul),
.preview-body :deep(ol) {
  margin: 0.4em 0;
  padding-left: 1.6em;
}
.preview-body :deep(li) {
  margin: 0.15em 0;
}
.preview-body :deep(li.task) {
  list-style: none;
  margin-left: -1.2em;
}
.preview-body :deep(a) {
  color: var(--accent);
}
.preview-body :deep(code) {
  background: var(--bg-raised);
  border-radius: var(--r-sm);
  padding: 0.1em 0.35em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
}
.preview-body :deep(pre) {
  background: var(--bg-raised);
  border-radius: var(--r-md);
  padding: 10px 12px;
  overflow-x: auto;
  margin: 0.5em 0;
}
.preview-body :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.92em;
}
.preview-body :deep(blockquote) {
  margin: 0.5em 0;
  padding: 0.1em 0 0.1em 0.9em;
  border-left: 3px solid var(--border);
  color: var(--fg-dim);
}
.preview-body :deep(table) {
  border-collapse: collapse;
  margin: 0.5em 0;
}
.preview-body :deep(th),
.preview-body :deep(td) {
  border: 1px solid var(--border);
  padding: 4px 10px;
}
.preview-body :deep(th) {
  background: var(--bg-raised);
}
.preview-body :deep(img) {
  max-width: 100%;
}
.preview-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 0.8em 0;
}

/* ---- 空态（§2：图标 + 一句话 + 主按钮）---- */
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  padding: var(--sp-5);
}
.empty-icon {
  color: var(--fg-dim);
  margin-bottom: var(--sp-2);
}
.empty-title {
  color: var(--fg);
  font-size: var(--fs-title);
  font-weight: 600;
}
.empty-sub {
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.empty-actions {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

/* 细滚动条（§1.7：6px 半透明观感，用 --border 色适配三主题） */
.list::-webkit-scrollbar,
.editor::-webkit-scrollbar,
.preview::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
.list::-webkit-scrollbar-thumb,
.editor::-webkit-scrollbar-thumb,
.preview::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: var(--border);
}
.list::-webkit-scrollbar-track,
.editor::-webkit-scrollbar-track,
.preview::-webkit-scrollbar-track {
  background: transparent;
}
</style>
