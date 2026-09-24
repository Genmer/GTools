<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import { ALL_PRESETS, GENERIC_PRESET } from './data/presets'
import { ABBR_LEVEL_LABEL, applyAbbrevs, contextualSuggestions, reverseLookup, type AbbrEntry } from './data/abbrev'
import { boolHints, generate, functionHints, type NamingCandidate } from './logic/engine'
import { LookupError, resolveWords, type ApisLike, type LookupOutcome } from './logic/lookup'
import {
  DEFAULT_PREFS,
  FAVORITES_KEY,
  HISTORY_KEY,
  HISTORY_LIMIT,
  PREFS_KEY,
  addFavorite,
  addHistory,
  normalizeFavorites,
  normalizeHistory,
  normalizePrefs,
  removeFavorite,
  removeHistory,
  updateFavoriteNote,
  type FavoriteEntry,
  type HistoryEntry,
  type VarNamePrefs,
  type VarNameTab
} from './logic/store'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const input = ref('')
const loading = ref(false)
const lookupError = ref('')
const providerName = ref('')
const resolved = ref<{ input: string; outcome: LookupOutcome } | null>(null)
const variantIdx = ref(0)
const abbrOverrides = ref<Record<string, string>>({})
const selection = ref(0)
const copiedIdx = ref(-1)
const copiedFavId = ref('')

const langId = ref(DEFAULT_PREFS.langId)
const useAbbreviations = ref(DEFAULT_PREFS.useAbbreviations)
const tab = ref<VarNameTab>(DEFAULT_PREFS.tab)
const history = ref<HistoryEntry[]>([])
const favorites = ref<FavoriteEntry[]>([])
const noteEditing = ref<{ id: string; text: string } | null>(null)

let seq = 0
let debounceTimer: ReturnType<typeof setTimeout> | undefined
let copiedTimer: ReturnType<typeof setTimeout> | undefined
const rowEls: HTMLElement[] = []

// 取词链注入：只暴露 invoke；api-services-changed 时刷新 provider 名
const apisAdapter: ApisLike | null = {
  invoke: async (service, payload) => {
    const out = await props.ctx.host.apis.invoke(service, payload)
    return { resultText: out.resultText }
  }
}
const offApiChanged = props.ctx.host.events.on('api-services-changed', () => void refreshProviderName())

async function refreshProviderName(): Promise<void> {
  try {
    providerName.value = (await props.ctx.host.apis.status('translate')).activeProviderName
  } catch {
    providerName.value = ''
  }
}

const preset = computed(() => ALL_PRESETS.find((p) => p.id === langId.value) ?? GENERIC_PRESET)
const variants = computed(() => resolved.value?.outcome.variants ?? [])
const activeVariant = computed(() => variants.value[variantIdx.value] ?? [])
const baseWords = computed(() => (useAbbreviations.value ? applyAbbrevs(activeVariant.value) : [...activeVariant.value]))
const words = computed(() => baseWords.value.map((w) => abbrOverrides.value[w] ?? w))

const mainCandidates = computed<NamingCandidate[]>(() => generate(words.value, preset.value))
const boolCandidates = computed<NamingCandidate[]>(() =>
  resolved.value ? boolHints(resolved.value.input, words.value, preset.value) : []
)
const funcCandidates = computed<NamingCandidate[]>(() =>
  resolved.value ? functionHints(resolved.value.input, words.value, preset.value) : []
)
const flatCandidates = computed<NamingCandidate[]>(() => [
  ...mainCandidates.value,
  ...boolCandidates.value,
  ...funcCandidates.value
])
const selectedCandidate = computed(() => flatCandidates.value[selection.value] ?? flatCandidates.value[0])

interface AbbrInfo {
  word: string
  entry: AbbrEntry
}
const abbrInfos = computed<AbbrInfo[]>(() => {
  const out: AbbrInfo[] = []
  const seen = new Set<string>()
  for (const w of words.value) {
    if (seen.has(w)) continue
    const entry = reverseLookup(w)
    if (entry) {
      seen.add(w)
      out.push({ word: w, entry })
    }
  }
  return out
})
const suggestions = computed(() => (activeVariant.value.length > 0 ? contextualSuggestions(activeVariant.value) : []))
const avoidHints = computed(() => resolved.value?.outcome.avoid ?? [])

const currentFav = computed(() =>
  favorites.value.find((f) => f.q === (resolved.value?.input ?? '') && f.words.join(' ') === words.value.join(' '))
)

onMounted(async () => {
  const host = props.ctx.host
  try {
    const p = normalizePrefs(await host.storage.get(PREFS_KEY))
    langId.value = p.langId
    useAbbreviations.value = p.useAbbreviations
    tab.value = p.tab
  } catch {
    /* 坏数据回落默认 */
  }
  try {
    history.value = normalizeHistory(await host.storage.get(HISTORY_KEY))
  } catch {
    history.value = []
  }
  try {
    favorites.value = normalizeFavorites(await host.storage.get(FAVORITES_KEY))
  } catch {
    favorites.value = []
  }
  void refreshProviderName()
})

watch(
  () => props.query,
  (q) => {
    const t = q.trim()
    if (t !== '' && t !== input.value) input.value = t
  },
  { immediate: true }
)

watch(input, () => {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => void runResolve(), 400)
})

watch([langId, useAbbreviations, tab], () => void savePrefs())
watch(selection, () => {
  rowEls.length = flatCandidates.value.length
  void nextTick(() => rowEls[selection.value]?.scrollIntoView({ block: 'nearest' }))
})

onBeforeUnmount(() => {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer)
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
  seq++
  offApiChanged()
})

async function savePrefs(): Promise<void> {
  const p: VarNamePrefs = { langId: langId.value, useAbbreviations: useAbbreviations.value, tab: tab.value }
  try {
    await props.ctx.host.storage.set(PREFS_KEY, p)
  } catch {
    /* 存储失败不阻塞 UI */
  }
}

async function runResolve(): Promise<void> {
  const text = input.value.trim()
  const cur = ++seq
  lookupError.value = ''
  if (text === '') {
    resolved.value = null
    loading.value = false
    return
  }
  loading.value = true
  try {
    const outcome = await resolveWords(text, apisAdapter)
    if (cur !== seq) return
    resolved.value = { input: text, outcome }
    variantIdx.value = 0
    abbrOverrides.value = {}
    selection.value = 0
  } catch (err) {
    if (cur !== seq) return
    resolved.value = null
    lookupError.value = err instanceof LookupError || err instanceof Error ? err.message : '取词失败'
  } finally {
    if (cur === seq) loading.value = false
  }
}

function onKeydown(e: KeyboardEvent): void {
  // 输入法组合态的 Enter 只上屏；项目已知坑
  if (e.isComposing) return
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (flatCandidates.value.length === 0) return
    e.preventDefault()
    const delta = e.key === 'ArrowDown' ? 1 : -1
    selection.value = (selection.value + delta + flatCandidates.value.length) % flatCandidates.value.length
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const ready = resolved.value !== null && resolved.value.input === input.value.trim() && flatCandidates.value.length > 0
    if (ready && selectedCandidate.value) void copyCandidate(selectedCandidate.value.value, selection.value)
    else void runResolve()
  }
}

async function copyCandidate(value: string, idx: number): Promise<void> {
  if (value === '') return
  try {
    await props.ctx.host.clipboard.writeText(value)
    copiedIdx.value = idx
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copiedIdx.value = -1), 1500)
    if (resolved.value !== null && words.value.length > 0) {
      history.value = addHistory(history.value, resolved.value.input, words.value)
      try {
        await props.ctx.host.storage.set(HISTORY_KEY, history.value)
      } catch {
        /* 忽略持久化失败 */
      }
    }
  } catch (err) {
    lookupError.value = err instanceof Error ? err.message : '复制失败'
  }
}

function setRowEl(i: number, el: unknown): void {
  if (el instanceof HTMLElement) rowEls[i] = el
}

function toggleFavorite(candidate: NamingCandidate): void {
  if (resolved.value === null || words.value.length === 0) return
  const existing = currentFav.value
  if (existing) favorites.value = removeFavorite(favorites.value, existing.id)
  // 备注默认记下选中的命名值，可在收藏页改成中文备注
  else favorites.value = addFavorite(favorites.value, resolved.value.input, words.value, candidate.value)
  void props.ctx.host.storage.set(FAVORITES_KEY, favorites.value).catch(() => {})
}

function applySuggestion(full: string, abbr: string): void {
  abbrOverrides.value = { ...abbrOverrides.value, [full]: abbr }
}

function pickVariant(i: number): void {
  variantIdx.value = i
  selection.value = 0
}

function loadEntry(q: string): void {
  tab.value = 'main'
  input.value = q
  void runResolve()
}

function deleteHistoryEntry(q: string): void {
  history.value = removeHistory(history.value, q)
  void props.ctx.host.storage.set(HISTORY_KEY, history.value).catch(() => {})
}

function deleteFavorite(id: string): void {
  favorites.value = removeFavorite(favorites.value, id)
  void props.ctx.host.storage.set(FAVORITES_KEY, favorites.value).catch(() => {})
}

function startEditNote(f: FavoriteEntry): void {
  noteEditing.value = { id: f.id, text: f.note ?? '' }
}

function onNoteEnter(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter 只上屏
  void commitNote()
}

async function commitNote(): Promise<void> {
  const editing = noteEditing.value
  if (editing === null) return
  noteEditing.value = null
  favorites.value = updateFavoriteNote(favorites.value, editing.id, editing.text)
  try {
    await props.ctx.host.storage.set(FAVORITES_KEY, favorites.value)
  } catch {
    /* 忽略持久化失败 */
  }
}

async function copyFavorite(f: FavoriteEntry): Promise<void> {
  const value = f.note ?? f.words.join(' ')
  try {
    await props.ctx.host.clipboard.writeText(value)
    copiedFavId.value = f.id
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copiedFavId.value = ''), 1500)
  } catch (err) {
    lookupError.value = err instanceof Error ? err.message : '复制失败'
  }
}

async function readClipboard(): Promise<void> {
  lookupError.value = ''
  try {
    const t = (await props.ctx.host.clipboard.readText()).trim()
    if (t === '') {
      lookupError.value = '剪贴板中没有文本内容'
      return
    }
    input.value = t
    void runResolve()
  } catch (err) {
    lookupError.value = err instanceof Error ? err.message : '读取剪贴板失败'
  }
}

function fmtTime(at: number): string {
  if (at <= 0) return ''
  return new Date(at).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function sourceLabel(s: string): string {
  if (s === 'dict') return '本地词典'
  if (s === 'translate') return '在线翻译'
  return '英文直通'
}
</script>

<template>
  <div class="varname">
    <div class="bar">
      <select v-model="langId" class="lang" title="语言预设">
        <option v-for="p in ALL_PRESETS" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
      <label class="toggle" title="开启后仅自动替换「推荐」级缩写（如 database→db）">
        <input v-model="useAbbreviations" type="checkbox" />
        缩写
      </label>
      <button class="btn" @click="readClipboard">读剪贴板</button>
      <span class="spacer"></span>
      <span class="provider" :title="providerName">{{ providerName }}</span>
      <div class="tabs">
        <button :class="{ active: tab === 'main' }" @click="tab = 'main'">命名</button>
        <button :class="{ active: tab === 'history' }" @click="tab = 'history'">历史</button>
        <button :class="{ active: tab === 'favorites' }" @click="tab = 'favorites'">收藏</button>
      </div>
    </div>

    <template v-if="tab === 'main'">
      <input
        v-model="input"
        class="input"
        placeholder="输入中/英文描述（如：用户配置 / user settings），↑↓ 选择，Enter 复制"
        spellcheck="false"
        @keydown="onKeydown"
      />

      <div v-if="variants.length > 1" class="chips">
        <button
          v-for="(v, i) in variants"
          :key="i"
          class="chip"
          :class="{ active: i === variantIdx }"
          @click="pickVariant(i)"
        >
          {{ v.join(' ') }}
        </button>
        <span class="chips-src">{{ sourceLabel(resolved?.outcome.source ?? '') }}</span>
      </div>

      <div v-if="suggestions.length > 0" class="chips">
        <span class="chips-label">缩写建议</span>
        <button
          v-for="s in suggestions"
          :key="s.full + s.abbr"
          class="chip"
          :class="{ active: abbrOverrides[s.full] === s.abbr }"
          :title="s.context"
          @click="applySuggestion(s.full, s.abbr)"
        >
          {{ s.full }} → {{ s.abbr }}
        </button>
      </div>

      <p v-if="avoidHints.length > 0" class="avoid">避免：{{ avoidHints.join('；') }}</p>

      <ul v-if="abbrInfos.length > 0" class="abbr-info">
        <li v-for="a in abbrInfos" :key="a.word">
          「{{ a.word }}」= {{ a.entry.full }} 的{{ ABBR_LEVEL_LABEL[a.entry.level] }}<template v-if="a.entry.context">（{{ a.entry.context }}）</template>
        </li>
      </ul>

      <div class="list">
        <p v-if="lookupError !== ''" class="err">{{ lookupError }}</p>
        <p v-else-if="loading" class="muted">取词中…</p>
        <p v-else-if="resolved === null" class="muted">候选将显示在这里</p>
        <p v-else-if="flatCandidates.length === 0" class="muted">未得到有效词组，换个说法试试</p>

        <template v-if="mainCandidates.length > 0">
          <p class="group">{{ preset.name }} · 命名候选</p>
          <div
            v-for="(c, i) in mainCandidates"
            :key="c.contextId"
            :ref="(el) => setRowEl(i, el)"
            class="row"
            :class="{ selected: i === selection }"
            @click="copyCandidate(c.value, i)"
          >
            <span class="label">{{ c.label }}</span>
            <code class="value">{{ c.value }}</code>
            <span v-if="c.note" class="note" :title="c.note">{{ c.note }}</span>
            <span class="flex-spacer"></span>
            <span class="copied" :class="{ show: i === copiedIdx }">已复制</span>
            <button class="star" :class="{ active: currentFav !== undefined }" title="收藏该描述" @click.stop="toggleFavorite(c)">★</button>
          </div>
        </template>

        <template v-if="boolCandidates.length > 0 || funcCandidates.length > 0">
          <p class="group">惯用前缀提示</p>
          <div
            v-for="(c, i) in boolCandidates"
            :key="c.contextId + c.value"
            :ref="(el) => setRowEl(mainCandidates.length + i, el)"
            class="row hint"
            :class="{ selected: mainCandidates.length + i === selection }"
            @click="copyCandidate(c.value, mainCandidates.length + i)"
          >
            <span class="label">{{ c.label }}</span>
            <code class="value">{{ c.value }}</code>
            <span v-if="c.note" class="note" :title="c.note">{{ c.note }}</span>
            <span class="flex-spacer"></span>
            <span class="copied" :class="{ show: mainCandidates.length + i === copiedIdx }">已复制</span>
          </div>
          <div
            v-for="(c, i) in funcCandidates"
            :key="c.contextId + c.value"
            :ref="(el) => setRowEl(mainCandidates.length + boolCandidates.length + i, el)"
            class="row hint"
            :class="{ selected: mainCandidates.length + boolCandidates.length + i === selection }"
            @click="copyCandidate(c.value, mainCandidates.length + boolCandidates.length + i)"
          >
            <span class="label">{{ c.label }}</span>
            <code class="value">{{ c.value }}</code>
            <span v-if="c.note" class="note" :title="c.note">{{ c.note }}</span>
            <span class="flex-spacer"></span>
            <span class="copied" :class="{ show: mainCandidates.length + boolCandidates.length + i === copiedIdx }">已复制</span>
          </div>
        </template>
      </div>
    </template>

    <template v-else-if="tab === 'history'">
      <div class="list">
        <p v-if="history.length === 0" class="muted">暂无历史（Enter 复制的查询会记录，容量 {{ HISTORY_LIMIT }} 条）</p>
        <div v-for="h in history" :key="h.q" class="row">
          <span class="label" :title="h.q">{{ h.q }}</span>
          <code class="value">{{ h.words.join(' ') }}</code>
          <span class="flex-spacer"></span>
          <span class="note">{{ fmtTime(h.at) }}</span>
          <button class="btn mini" @click="loadEntry(h.q)">命名</button>
          <button class="btn mini" @click="deleteHistoryEntry(h.q)">删</button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="list">
        <p v-if="favorites.length === 0" class="muted">暂无收藏（候选行尾 ★ 收藏，备注可写中文释义）</p>
        <div v-for="f in favorites" :key="f.id" class="row">
          <code class="value">{{ f.note || f.words.join(' ') }}</code>
          <span class="label" :title="f.q">{{ f.q }}</span>
          <span class="flex-spacer"></span>
          <input
            v-if="noteEditing !== null && noteEditing.id === f.id"
            v-model="noteEditing.text"
            class="note-input"
            placeholder="备注（可中文）"
            @keydown.enter.prevent="onNoteEnter"
            @blur="commitNote"
          />
          <span v-else class="note" :title="f.note ?? ''">{{ f.note ?? '' }}</span>
          <span class="copied" :class="{ show: f.id === copiedFavId }">已复制</span>
          <button class="btn mini" @click="copyFavorite(f)">{{ f.id === copiedFavId ? '已复制' : '复制' }}</button>
          <button class="btn mini" @click="loadEntry(f.q)">命名</button>
          <button class="btn mini" v-if="noteEditing === null || noteEditing.id !== f.id" @click="startEditNote(f)">注</button>
          <button class="btn mini" @click="deleteFavorite(f.id)">删</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.varname {
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
}
.lang {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 6px;
  font-size: 12px;
  outline: none;
  max-width: 130px;
}
.toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-dim);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  flex: none;
}
.btn.mini {
  padding: 2px 7px;
  font-size: 11px;
}
.spacer,
.flex-spacer {
  flex: 1;
}
.provider {
  color: var(--fg-dim);
  font-size: 12px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tabs {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.tabs button {
  border: none;
  background: var(--bg-raised);
  color: var(--fg-dim);
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.tabs button.active {
  background: var(--accent-dim);
  color: var(--accent);
}
.input {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  flex: none;
}
.input:focus {
  border-color: var(--accent);
}
.chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: none;
}
.chips-label {
  color: var(--fg-dim);
  font-size: 12px;
}
.chips-src {
  color: var(--fg-dim);
  font-size: 12px;
}
.chip {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
}
.chip.active {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-dim);
}
.avoid,
.abbr-info {
  color: var(--warn);
  margin: 0;
  font-size: 12px;
}
.abbr-info {
  padding-left: 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.group {
  color: var(--fg-dim);
  font-size: 12px;
  margin: 6px 0 2px;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  min-height: 28px;
  flex: none;
}
.row:hover {
  background: var(--bg-raised);
}
.row.selected {
  background: var(--accent-dim);
}
.row.hint .value {
  color: var(--fg-dim);
}
.label {
  color: var(--fg-dim);
  font-size: 12px;
  max-width: 130px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: none;
}
.value {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.note {
  color: var(--fg-dim);
  font-size: 12px;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: none;
}
.note-input {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 12px;
  outline: none;
  width: 160px;
  flex: none;
}
.copied {
  color: var(--ok);
  font-size: 12px;
  visibility: hidden;
  flex: none;
}
.copied.show {
  visibility: visible;
}
.star {
  border: none;
  background: none;
  color: var(--fg-dim);
  cursor: pointer;
  font-size: 14px;
  padding: 0 4px;
  flex: none;
}
.star.active {
  color: var(--warn);
}
.err {
  color: var(--danger);
  margin: 0;
}
.muted {
  color: var(--fg-dim);
  margin: 0;
}
</style>
