<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import { DEFAULT_FIELD_IDS, FIELD_DEFS, clampCount, generateBatch } from './logic/fields'
import { FORMAT_OPTIONS, formatOutput, type OutputFormat } from './logic/format'
import {
  LAST_STORAGE_KEY,
  TEMPLATES_STORAGE_KEY,
  normalizeTemplates,
  removeTemplate as removeTpl,
  sanitizeFields,
  sanitizeFormat,
  upsertTemplate,
  type FieldTemplate
} from './logic/templates'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const selected = ref<string[]>([...DEFAULT_FIELD_IDS])
const count = ref(10)
const format = ref<OutputFormat>('json')
const records = ref<Record<string, string>[]>([])
const copied = ref(false)
const templates = ref<FieldTemplate[]>([])
const tplName = ref('')

// Windows 用 CRLF 换行（TSV 直贴 Excel 兼容）；win32 分支未实测，按方案处理
const isWin = computed(() => props.ctx.host.app.platform === 'win32')
const eol = computed(() => (isWin.value ? '\r\n' : '\n'))

const selectedDefs = computed(() => FIELD_DEFS.filter((f) => selected.value.includes(f.id)))
const output = computed(() => formatOutput(records.value, selectedDefs.value, format.value, eol.value))

function regen(): void {
  records.value = generateBatch(selected.value, count.value, Math.random)
}

function toggle(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((v) => v !== id)
    : [...selected.value, id]
}

async function copyOut(): Promise<void> {
  const text = output.value
  if (text === '') return
  try {
    await props.ctx.host.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // 剪贴板偶发失败（权限/焦点丢失），不打断界面
  }
}

async function persistLast(): Promise<void> {
  try {
    await props.ctx.host.storage.set(LAST_STORAGE_KEY, {
      fields: selected.value,
      count: count.value,
      format: format.value
    })
  } catch {
    // 存储不可用时静默降级为会话内记忆
  }
}

async function loadTemplates(): Promise<void> {
  try {
    templates.value = normalizeTemplates(await props.ctx.host.storage.get(TEMPLATES_STORAGE_KEY))
  } catch {
    templates.value = []
  }
}

async function saveTemplate(): Promise<void> {
  const draft: FieldTemplate = {
    name: tplName.value.trim(),
    fields: sanitizeFields(selected.value),
    count: clampCount(count.value),
    format: sanitizeFormat(format.value)
  }
  if (draft.name === '' || draft.fields.length === 0) return
  templates.value = upsertTemplate(templates.value, draft)
  tplName.value = ''
  try {
    await props.ctx.host.storage.set(TEMPLATES_STORAGE_KEY, templates.value)
  } catch {
    // 保存失败仅影响下次启动恢复，本次会话仍可用
  }
}

function applyTemplate(t: FieldTemplate): void {
  selected.value = sanitizeFields(t.fields)
  count.value = clampCount(t.count)
  format.value = sanitizeFormat(t.format)
  regen()
  void persistLast()
}

async function deleteTemplate(name: string): Promise<void> {
  templates.value = removeTpl(templates.value, name)
  try {
    await props.ctx.host.storage.set(TEMPLATES_STORAGE_KEY, templates.value)
  } catch {
    // 同上，静默
  }
}

function fmtLabel(f: OutputFormat): string {
  return FORMAT_OPTIONS.find((o) => o.value === f)?.label ?? f
}

function onTplEnter(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter 只上屏
  void saveTemplate()
}

onMounted(async () => {
  try {
    const last = await props.ctx.host.storage.get<{
      fields: unknown
      count: unknown
      format: unknown
    }>(LAST_STORAGE_KEY)
    if (last !== null) {
      const fields = sanitizeFields(last.fields)
      if (fields.length > 0) selected.value = fields
      count.value = clampCount(Number(last.count))
      format.value = sanitizeFormat(last.format)
    }
  } catch {
    // 读不到就用默认
  }
  await loadTemplates()
  regen()
})

// 外壳搜索框数字直达条数：fake-data 20 → 20 条
watch(
  () => props.query,
  (q) => {
    const m = /^\s*(\d{1,3})\s*$/.exec(q)
    if (m) {
      count.value = clampCount(Number(m[1]))
      regen()
      void persistLast()
    }
  }
)

// 勾选变化即重生成，保证新勾字段每行都有值
watch(selected, () => {
  regen()
  void persistLast()
})
watch([count, format], () => void persistLast())

// 生成快捷键：macOS ⌘+Enter / Windows Ctrl+Enter（win 分支未实测）
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    regen()
  }
}
</script>

<template>
  <div class="fake-data" tabindex="0" @keydown="onKeydown">
    <aside class="side">
      <div class="side-title">字段</div>
      <div class="fields">
        <label v-for="f in FIELD_DEFS" :key="f.id" class="field" :class="{ on: selected.includes(f.id) }">
          <input type="checkbox" :checked="selected.includes(f.id)" @change="toggle(f.id)" />
          <span>{{ f.label }}</span>
        </label>
      </div>

      <div class="side-title">模板</div>
      <div v-if="templates.length" class="tpls">
        <div v-for="t in templates" :key="t.name" class="tpl">
          <button class="tpl-btn" :title="`${t.fields.length} 字段 · ${t.count} 条 · ${fmtLabel(t.format)}`" @click="applyTemplate(t)">
            {{ t.name }}
          </button>
          <button class="tpl-del" title="删除模板" @click="deleteTemplate(t.name)">✕</button>
        </div>
      </div>
      <div v-else class="muted">暂无保存的模板</div>
      <div class="tpl-save">
        <input v-model="tplName" type="text" placeholder="模板名" maxlength="30" @keydown.enter.prevent="onTplEnter" />
        <button class="btn" :disabled="tplName.trim() === '' || selected.length === 0" @click="saveTemplate">保存</button>
      </div>
    </aside>

    <section class="main">
      <div class="bar">
        <label>条数</label>
        <input
          v-model.number="count"
          type="number"
          min="1"
          max="100"
          style="width: 72px"
          @change="count = clampCount(count); regen()"
        />
        <label>格式</label>
        <select v-model="format">
          <option v-for="o in FORMAT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <button class="btn primary" :disabled="selected.length === 0" @click="regen">生成</button>
        <button class="btn" :disabled="output === ''" @click="copyOut">{{ copied ? '已复制' : '复制' }}</button>
        <span class="muted">{{ isWin ? 'Ctrl+Enter 重新生成' : '⌘+Enter 重新生成' }}</span>
      </div>
      <div v-if="selected.length === 0" class="muted empty">先在左侧勾选至少一个字段</div>
      <pre v-else class="out">{{ output }}</pre>
    </section>
  </div>
</template>

<style scoped>
.fake-data {
  height: 100%;
  display: flex;
  outline: none;
  font-size: 13px;
  color: var(--fg);
}
.side {
  flex: none;
  width: 168px;
  border-right: 1px solid var(--border);
  padding: 10px 8px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.side-title {
  color: var(--fg-dim);
  font-size: 12px;
  padding: 2px 4px;
}
.fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2px;
}
.field {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--fg-dim);
}
.field.on {
  background: var(--accent-dim);
  color: var(--accent);
}
.tpls {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.tpl {
  display: flex;
  align-items: center;
  gap: 2px;
}
.tpl-btn {
  flex: 1;
  min-width: 0;
  text-align: left;
  border: 1px solid var(--border);
  background: var(--bg-raised);
  color: var(--fg);
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tpl-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.tpl-del {
  flex: none;
  border: none;
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
  padding: 4px 4px;
  font-size: 12px;
}
.tpl-del:hover {
  color: var(--danger);
}
.tpl-save {
  display: flex;
  gap: 4px;
}
.tpl-save input {
  flex: 1;
  min-width: 0;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: none;
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn.primary {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}
input[type='text'],
input[type='number'],
select {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 13px;
  outline: none;
}
.empty {
  padding: 20px;
}
.out {
  flex: 1;
  min-height: 0;
  margin: 0;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  overflow: auto;
  font-size: 12px;
  font-family: ui-monospace, monospace;
  white-space: pre;
  user-select: text;
}
.muted {
  color: var(--fg-dim);
  font-size: 12px;
}
</style>
