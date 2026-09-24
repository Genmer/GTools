<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import {
  BUILTIN_SITES,
  CATEGORY_LABELS,
  CUSTOM_SITES_STORAGE_KEY,
  parseCustomSites,
  validateSiteForm,
  type SiteEntry
} from './sites'
import { buildOpenUrl, hostOf, looksLikeUrl, normalizeUserUrl } from './open-url'
import { filterSites, resolvePin } from './match'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

interface Row {
  key: string
  kind: 'site' | 'search' | 'url'
  site: SiteEntry | null
  title: string
  subtitle: string
  openUrl: string
}

const customSites = ref<SiteEntry[]>([])
const loadError = ref('')
const selected = ref(0)
const listRef = ref<HTMLElement | null>(null)
const opening = ref(false)

const showForm = ref(false)
const editingId = ref<string | null>(null)
const form = ref({ name: '', url: '', searchUrl: '', aliases: '' })
const formErrors = ref<string[]>([])
const confirmDeleteId = ref<string | null>(null)

const allSites = computed<SiteEntry[]>(() => [...BUILTIN_SITES, ...customSites.value])

// 图标降级说明：渲染层 CSP img-src 'self' data: 禁远程图，宿主 net.fetch 响应体仅 UTF-8 文本（二进制 favicon 取不回），
// 故用首字母色块（同 launcher 图标降级路径），待宿主放开二进制响应/图源后可升级
const rows = computed<Row[]>(() => {
  const q = props.query.trim()
  const pin = resolvePin(q, allSites.value)
  if (pin) {
    const openUrl = buildOpenUrl(pin.site, pin.term)
    const searching = pin.term !== '' && pin.site.searchUrl !== undefined && openUrl !== pin.site.url
    return [
      {
        key: `pin:${pin.site.id}`,
        kind: searching ? 'search' : 'site',
        site: pin.site,
        title: searching ? `在${pin.site.name}搜索「${pin.term}」` : `打开 ${pin.site.name}`,
        subtitle: openUrl,
        openUrl
      }
    ]
  }
  const out: Row[] = []
  if (looksLikeUrl(q)) {
    const u = normalizeUserUrl(q)
    if (u !== null) out.push({ key: `url:${u}`, kind: 'url', site: null, title: '打开网址', subtitle: u, openUrl: u })
  }
  for (const { site } of filterSites(q, allSites.value)) {
    out.push({ key: site.id, kind: 'site', site, title: site.name, subtitle: hostOf(site.url), openUrl: buildOpenUrl(site) })
  }
  return out
})

const visible = computed(() => rows.value.slice(0, 50))

watch(
  () => props.query,
  () => {
    selected.value = 0
  }
)
watch(selected, async () => {
  await nextTick()
  listRef.value?.querySelector(`[data-i="${selected.value}"]`)?.scrollIntoView({ block: 'nearest' })
})

function badge(name: string): string {
  const ch = name.trim()[0] ?? '?'
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch
}

function move(dir: 1 | -1): void {
  const n = visible.value.length
  if (n === 0) return
  selected.value = (selected.value + dir + n) % n
}

// 插件模式下外壳 SearchBox 不转发 Enter/方向键（仅 global 模式），列表导航由插件自治监听
function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter/方向键用于选词
  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return // 表单聚焦时不劫持
  if (e.key === 'Enter') {
    e.preventDefault()
    const row = visible.value[selected.value]
    if (row) void open(row)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  }
}

async function open(row: Row): Promise<void> {
  if (opening.value) return
  opening.value = true
  loadError.value = ''
  try {
    await props.ctx.host.shell.openExternal(row.openUrl)
    await props.ctx.host.window.hide()
  } catch (err) {
    loadError.value = `打开失败：${err instanceof Error ? err.message : String(err)}`
  } finally {
    opening.value = false
  }
}

async function persist(): Promise<void> {
  await props.ctx.host.storage.set(CUSTOM_SITES_STORAGE_KEY, customSites.value)
}

function openAddForm(): void {
  editingId.value = null
  form.value = { name: '', url: '', searchUrl: '', aliases: '' }
  formErrors.value = []
  confirmDeleteId.value = null
  showForm.value = true
}

function openEditForm(site: SiteEntry): void {
  editingId.value = site.id
  form.value = {
    name: site.name,
    url: site.url,
    searchUrl: site.searchUrl ?? '',
    aliases: (site.aliases ?? []).join(' ')
  }
  formErrors.value = []
  confirmDeleteId.value = null
  showForm.value = true
}

function onFormEnter(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter 只上屏
  void saveForm()
}

async function saveForm(): Promise<void> {
  const r = validateSiteForm(form.value)
  if (!r.ok) {
    formErrors.value = r.errors
    return
  }
  const base = r.site
  if (editingId.value !== null) {
    const i = customSites.value.findIndex((s) => s.id === editingId.value)
    if (i >= 0) customSites.value[i] = { ...customSites.value[i], ...base }
  } else {
    customSites.value.push({
      id: `custom-${Date.now().toString(36)}`,
      category: 'custom',
      ...base
    })
  }
  formErrors.value = []
  showForm.value = false
  await persist()
}

async function removeSite(site: SiteEntry): Promise<void> {
  if (confirmDeleteId.value !== site.id) {
    confirmDeleteId.value = site.id // 两步确认，防误删
    return
  }
  customSites.value = customSites.value.filter((s) => s.id !== site.id)
  confirmDeleteId.value = null
  if (editingId.value === site.id) {
    editingId.value = null
    showForm.value = false
  }
  await persist()
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  void (async () => {
    try {
      customSites.value = parseCustomSites(await props.ctx.host.storage.get(CUSTOM_SITES_STORAGE_KEY))
    } catch (err) {
      loadError.value = `读取自定义站点失败：${err instanceof Error ? err.message : String(err)}`
    }
  })()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="wqo">
    <div class="statusbar">
      <span class="count">{{ allSites.length }} 个站点（内置 {{ BUILTIN_SITES.length }} / 自定义 {{ customSites.length }}）</span>
      <span class="hint">「缩写 关键词」直达搜索，如 bd 天气、gh vue</span>
      <span v-if="loadError !== ''" class="err">{{ loadError }}</span>
      <button class="add" :class="{ active: showForm }" @click="showForm ? (showForm = false) : openAddForm()">
        {{ showForm ? '收起' : '＋ 添加站点' }}
      </button>
    </div>

    <div v-if="showForm" class="form">
      <div class="form-row">
        <label>名称</label>
        <input v-model="form.name" type="text" placeholder="如 淘宝" @keydown.enter.prevent="onFormEnter" />
        <label>网址</label>
        <input v-model="form.url" type="text" placeholder="如 taobao.com 或 https://taobao.com" @keydown.enter.prevent="onFormEnter" />
      </div>
      <div class="form-row">
        <label>搜索链接</label>
        <input
          v-model="form.searchUrl"
          type="text"
          placeholder="可选，含 {} 占位符，如 https://s.taobao.com/search?q={}"
          @keydown.enter.prevent="onFormEnter"
        />
      </div>
      <div class="form-row">
        <label>缩写</label>
        <input v-model="form.aliases" type="text" placeholder="可选，空格或逗号分隔，如 tb 淘宝" @keydown.enter.prevent="onFormEnter" />
        <button class="save" @click="saveForm">{{ editingId !== null ? '保存修改' : '添加' }}</button>
        <button class="cancel" @click="showForm = false">取消</button>
      </div>
      <p v-for="(e, i) in formErrors" :key="i" class="form-err">{{ e }}</p>
    </div>

    <div ref="listRef" class="list">
      <div
        v-for="(row, i) in visible"
        :key="row.key"
        class="item"
        :class="{ active: i === selected }"
        :data-i="i"
        @click="open(row)"
        @mouseenter="selected = i"
      >
        <span class="badge" :class="{ search: row.kind === 'search' }">{{ row.site ? badge(row.site.name) : '🌐' }}</span>
        <span class="name">{{ row.title }}</span>
        <span v-if="row.site && row.site.searchUrl" class="searchable" title="支持「缩写 关键词」直达搜索">🔍</span>
        <span v-if="row.site" class="cat">{{ CATEGORY_LABELS[row.site.category] }}</span>
        <span class="url">{{ row.subtitle }}</span>
        <template v-if="row.site && row.site.category === 'custom'">
          <button class="op" title="编辑" @click.stop="openEditForm(row.site)">编辑</button>
          <button class="op danger" :class="{ arming: confirmDeleteId === row.site.id }" @click.stop="removeSite(row.site)">
            {{ confirmDeleteId === row.site.id ? '确认删除' : '删除' }}
          </button>
        </template>
      </div>
      <div v-if="visible.length === 0" class="empty">无匹配站点{{ showForm ? '' : '，可点右上「＋ 添加站点」' }}</div>
    </div>
  </div>
</template>

<style scoped>
.wqo {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.statusbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-dim);
  font-size: 12px;
  min-height: 30px;
}
.count {
  color: var(--fg);
  flex: none;
}
.hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.err {
  color: var(--danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.add {
  margin-left: auto;
  flex: none;
  border: none;
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: 6px;
  padding: 3px 12px;
  font-size: 12px;
  cursor: pointer;
}
.add.active {
  outline: 1px solid var(--accent);
}
.form {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-raised);
}
.form-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.form-row label {
  flex: none;
  width: 56px;
  color: var(--fg-dim);
  font-size: 12px;
  text-align: right;
}
.form-row input {
  flex: 1;
  min-width: 0;
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  outline: none;
}
.form-row input:focus {
  border-color: var(--accent);
}
.save,
.cancel {
  flex: none;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--fg);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
}
.save {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}
.form-err {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  user-select: none;
}
.item.active {
  background: var(--accent-dim);
}
.badge {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  color: var(--fg);
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.badge.search {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}
.name {
  flex: none;
  max-width: 46%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-size: 15px;
}
.searchable {
  flex: none;
  font-size: 11px;
  opacity: 0.85;
}
.cat {
  flex: none;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--border);
  color: var(--fg-dim);
}
.url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-dim);
  font-size: 12px;
  text-align: right;
}
.op {
  flex: none;
  border: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--fg-dim);
  border-radius: 6px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}
.op:hover {
  color: var(--fg);
  border-color: var(--fg-dim);
}
.op.danger {
  color: var(--danger);
}
.op.danger.arming {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--fg);
}
.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--fg-dim);
  font-size: 14px;
}
</style>
