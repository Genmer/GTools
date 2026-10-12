<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'

// 与主进程 api-center 脱敏视图/preset 元数据同构的类型（HostInitResult 同款本地镜像模式）
type ProviderType = 'mymemory' | 'http-template' | 'deepl' | 'baidu' | 'youdao' | 'iflytek' | 'hunyuan' | 'volcano'
interface ApiProviderView {
  id: string
  type: ProviderType
  name: string
  enabled: boolean
  endpoint?: string
  method?: 'GET' | 'POST'
  bodyTemplate?: string
  resultPath?: string
  hasSecrets: Record<string, boolean>
}
interface ApiServicesView {
  services: { translate: { activeProviderId: string; providers: ApiProviderView[] } }
}
interface CredentialFieldDef {
  key: string
  label: string
  placeholder: string
}
interface ProviderPresetMeta {
  type: ProviderType
  label: string
  description: string
  quotaNote?: string
  consoleUrl: string | null
  credentials: CredentialFieldDef[]
  hints?: string[]
}
interface ProviderDraft {
  id?: string
  type: ProviderType
  name: string
  endpoint: string
  method: 'GET' | 'POST'
  bodyTemplate: string
  resultPath: string
  newSecrets: Record<string, string>
}

const view = ref<ApiServicesView | null>(null)
const presets = ref<ProviderPresetMeta[]>([])
const expanded = ref(false)
const opError = ref('')
const editing = ref(false)
const editingId = ref<string | undefined>(undefined)
const testing = ref(false)
const testMsg = ref('')
const testOk = ref(false)
const draft = reactive<ProviderDraft>(emptyDraft())

function emptyDraft(): ProviderDraft {
  return { type: 'http-template', name: '', endpoint: '', method: 'GET', bodyTemplate: '', resultPath: '', newSecrets: {} }
}

const translate = computed(() => view.value?.services.translate ?? { activeProviderId: '', providers: [] as ApiProviderView[] })
const activeProvider = computed(() => translate.value.providers.find((p) => p.id === translate.value.activeProviderId) ?? null)
// 绿=默认或已配置可用 / 黄=当前 provider 被禁用 / 灰=当前 provider 已不存在（sanitize 后的防御态）
const dotClass = computed(() => {
  if (translate.value.activeProviderId === '') return 'ok'
  if (!activeProvider.value) return 'gray'
  return activeProvider.value.enabled ? 'ok' : 'warn'
})
const activeLabel = computed(() => activeProvider.value?.name ?? 'MyMemory（默认免 Key）')

// 当前草稿对应的厂商 preset（六家），mymemory/http-template 走各自的定制表单分支
const activePreset = computed(() => presets.value.find((p) => p.type === draft.type && p.type !== 'mymemory' && p.type !== 'http-template') ?? null)
const editingHasSecrets = computed<Record<string, boolean>>(() => {
  if (!editingId.value) return {}
  return view.value?.services.translate.providers.find((p) => p.id === editingId.value)?.hasSecrets ?? {}
})

// 切类型自动填 preset 名（仅六家厂商 preset；用户改过则不覆盖：旧值是另一 preset 的默认名或空才填）
watch(
  () => draft.type,
  (t, oldT) => {
    draft.newSecrets = {}
    const next = presets.value.find((p) => p.type === t)
    if (!next || next.type === 'mymemory' || next.type === 'http-template') return
    const prevLabel = presets.value.find((p) => p.type === oldT)?.label ?? ''
    if (draft.name === '' || draft.name === prevLabel) draft.name = next.label
  }
)

function presetLabel(type: ProviderType): string {
  return presets.value.find((p) => p.type === type)?.label ?? type
}

// 主进程错误带 kind 前缀（如 "config: DeepL 返回 HTTP 400..."），展示层换成用户能懂的分类词
const KIND_LABELS: Record<string, string> = {
  config: '配置有误',
  auth: '密钥无效',
  quota: '配额不足',
  network: '网络错误',
  timeout: '请求超时',
  http: '服务异常',
  parse: '响应异常'
}
function friendlyError(msg: string): string {
  const m = /^([a-z]+): (.+)$/s.exec(msg)
  return m && KIND_LABELS[m[1]] !== undefined ? `${KIND_LABELS[m[1]]}——${m[2]}` : msg
}

async function host(api: string, payload?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return window.gtools.host(api, payload)
}

function applyView(data: unknown): void {
  view.value = data as ApiServicesView
}

async function refresh(): Promise<void> {
  const r = await host('api-services:get')
  if (r.ok) {
    const d = r.data as { services: ApiServicesView; presets: ProviderPresetMeta[] }
    presets.value = d.presets
    applyView(d.services)
  } else {
    opError.value = r.error ?? '读取 API 服务配置失败'
  }
}

async function openConsole(): Promise<void> {
  if (!activePreset.value) return
  const r = await host('api-services:open-console', { type: activePreset.value.type })
  if (!r.ok) opError.value = r.error ?? '打开控制台失败'
}

let offChanged: (() => void) | undefined
onMounted(() => {
  void refresh()
  offChanged = window.gtools.on('api-services-changed', (p) => applyView(p))
})
onBeforeUnmount(() => offChanged?.())

function startAdd(): void {
  editingId.value = undefined
  Object.assign(draft, emptyDraft())
  testMsg.value = ''
  editing.value = true
}

function startEdit(p: ApiProviderView): void {
  editingId.value = p.id
  Object.assign(draft, emptyDraft())
  draft.type = p.type
  draft.name = p.name
  draft.endpoint = p.endpoint ?? ''
  draft.method = p.method === 'POST' ? 'POST' : 'GET'
  draft.bodyTemplate = p.bodyTemplate ?? ''
  draft.resultPath = p.resultPath ?? ''
  testMsg.value = ''
  editing.value = true
}

function cancelEdit(): void {
  editing.value = false
  editingId.value = undefined
}

async function save(): Promise<void> {
  opError.value = ''
  const r = await host('api-services:upsert-provider', {
    id: editingId.value,
    type: draft.type,
    name: draft.name,
    enabled: true,
    endpoint: draft.endpoint,
    method: draft.method,
    bodyTemplate: draft.bodyTemplate,
    resultPath: draft.resultPath,
    // reactive Proxy 不能过 IPC structuredClone，展开成普通对象
    newSecrets: { ...draft.newSecrets }
  })
  if (!r.ok) {
    opError.value = r.error ?? '保存失败'
    return
  }
  applyView(r.data)
  editing.value = false
  editingId.value = undefined
}

async function remove(p: ApiProviderView): Promise<void> {
  opError.value = ''
  if (!window.confirm(`删除服务商「${p.name}」？其凭证将一并删除。`)) return
  const r = await host('api-services:remove-provider', { id: p.id })
  if (!r.ok) opError.value = r.error ?? '删除失败'
  else applyView(r.data)
}

async function setActive(id: string): Promise<void> {
  opError.value = ''
  const r = await host('api-services:set-active', { id })
  if (!r.ok) opError.value = r.error ?? '设置失败'
  else applyView(r.data)
}

async function useDefault(): Promise<void> {
  await setActive('')
}

async function toggleEnabled(p: ApiProviderView, enabled: boolean): Promise<void> {
  opError.value = ''
  // 不带 newSecrets：主进程按已存值保留
  const r = await host('api-services:upsert-provider', {
    id: p.id,
    type: p.type,
    name: p.name,
    enabled,
    endpoint: p.endpoint,
    method: p.method,
    bodyTemplate: p.bodyTemplate,
    resultPath: p.resultPath
  })
  if (!r.ok) opError.value = r.error ?? '操作失败'
  else applyView(r.data)
}

async function test(p?: ApiProviderView): Promise<void> {
  opError.value = ''
  testMsg.value = ''
  testing.value = true
  try {
    const payload = p
      ? { id: p.id }
      : {
          id: editingId.value,
          draft: {
            id: editingId.value,
            type: draft.type,
            name: draft.name === '' ? '（草稿）' : draft.name,
            enabled: true,
            endpoint: draft.endpoint,
            method: draft.method,
            bodyTemplate: draft.bodyTemplate,
            resultPath: draft.resultPath,
            newSecrets: { ...draft.newSecrets }
          }
        }
    const r = await host('api-services:test', payload)
    if (!r.ok) {
      testOk.value = false
      testMsg.value = r.error ?? '测试失败'
      return
    }
    const d = r.data as { ok: boolean; resultText?: string; error?: string }
    testOk.value = d.ok
    testMsg.value = d.ok ? (d.resultText ?? '（无返回内容）') : (d.error ?? '测试失败')
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <section>
    <h3>API 服务</h3>
    <div class="row head">
      <span class="dot" :class="dotClass" title="当前翻译通道状态"></span>
      <span class="name">翻译</span>
      <span class="dim current">当前：{{ activeLabel }}</span>
      <span class="spacer"></span>
      <button class="btn" @click="expanded = !expanded">{{ expanded ? '收起' : '配置' }}</button>
    </div>

    <div v-if="expanded" class="panel">
      <div
        v-for="p in translate.providers"
        :key="p.id"
        class="provider-card"
        :class="{ active: translate.activeProviderId === p.id }"
      >
        <div class="provider-head">
          <div class="provider-id">
            <span class="provider-name">{{ p.name }}</span>
            <span v-if="translate.activeProviderId === p.id" class="badge">当前生效</span>
          </div>
          <label class="switch">
            <input type="checkbox" :checked="p.enabled" @change="toggleEnabled(p, ($event.target as HTMLInputElement).checked)" />
            <span>{{ p.enabled ? '已启用' : '已禁用' }}</span>
          </label>
        </div>
        <div class="provider-sub dim">
          {{ presetLabel(p.type) }}{{ Object.values(p.hasSecrets).some(Boolean) ? ' · 密钥已保存' : ' · 未保存密钥' }}
        </div>
        <div class="provider-ops">
          <button v-if="translate.activeProviderId !== p.id" class="btn" title="设为当前翻译引擎" @click="setActive(p.id)">设为当前</button>
          <button class="btn" @click="test(p)">测试</button>
          <button class="btn" @click="startEdit(p)">编辑</button>
          <button class="btn" @click="remove(p)">删除</button>
        </div>
      </div>
      <p v-if="translate.providers.length === 0" class="empty dim">
        未配置服务商，当前使用默认 MyMemory（免 Key，有匿名每日配额）
      </p>

      <div class="list-ops">
        <button class="btn primary" @click="startAdd">＋ 添加服务商</button>
        <button v-if="translate.activeProviderId !== ''" class="btn" @click="useDefault">回到默认 MyMemory</button>
      </div>

      <div v-if="testMsg && !editing" class="alert" :class="testOk ? 'ok' : 'err'">
        <span class="alert-tag">{{ testOk ? '✓ 测试通过' : '✕ 测试失败' }}</span>
        <span class="alert-text">{{ testOk ? testMsg : friendlyError(testMsg) }}</span>
      </div>

      <div v-if="editing" class="form">
        <div class="form-title">{{ editingId ? '编辑服务商' : '新增服务商' }}</div>
        <div class="field">
          <label>类型</label>
          <select v-model="draft.type">
            <option v-for="pre in presets" :key="pre.type" :value="pre.type">{{ pre.quotaNote ? `${pre.label}（${pre.quotaNote}）` : pre.label }}</option>
          </select>
          <span v-if="activePreset || draft.type === 'http-template' || draft.type === 'mymemory'" class="dim desc">
            {{ presets.find((p) => p.type === draft.type)?.description }}
          </span>
        </div>
        <div class="field">
          <label>名称</label>
          <input v-model="draft.name" placeholder="如：DeepL 免费接口" />
        </div>
        <template v-if="draft.type === 'http-template'">
          <div class="field">
            <label>接口地址模板（占位符 {text} {from} {to} {key}）</label>
            <input
              v-model="draft.endpoint"
              placeholder="https://api.example.com/translate?q={text}&amp;from={from}&amp;to={to}&amp;key={key}"
              spellcheck="false"
            />
          </div>
          <div class="field inline">
            <label>请求方式</label>
            <select v-model="draft.method">
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
          </div>
          <div v-if="draft.method === 'POST'" class="field">
            <label>请求体模板（JSON，占位符同上）</label>
            <input v-model="draft.bodyTemplate" placeholder='{"text":"{text}","target":"{to}"}' spellcheck="false" />
          </div>
          <div class="field">
            <label>结果字段路径（点分取值，数组用下标；留空取整个响应文本）</label>
            <input v-model="draft.resultPath" placeholder="translations.0.text" spellcheck="false" />
          </div>
          <div class="field">
            <label>API 密钥（仅存本机 userData，不上传不下发渲染层）</label>
            <input
              v-model="draft.newSecrets.apiKey"
              type="password"
              :placeholder="editingHasSecrets.apiKey ? '●●●●●（已保存，留空不修改）' : '模板含 {key} 时必填'"
              autocomplete="off"
            />
          </div>
        </template>
        <template v-else-if="activePreset">
          <div v-for="field in activePreset.credentials" :key="field.key" class="field">
            <label>{{ field.label }}（仅存本机 userData，不上传不下发渲染层）</label>
            <input
              v-model="draft.newSecrets[field.key]"
              type="password"
              :placeholder="editingHasSecrets[field.key] ? '●●●●●（已保存，留空不修改）' : field.placeholder"
              autocomplete="off"
            />
          </div>
          <div v-if="activePreset.hints?.length" class="field">
            <p v-for="hint in activePreset.hints" :key="hint" class="dim hint">{{ hint }}</p>
          </div>
          <button v-if="activePreset.consoleUrl" class="btn console-btn" @click="openConsole">获取 API Key ↗</button>
        </template>
        <p v-else class="dim">MyMemory 为公共接口，无需配置字段；保存后会出现在服务商列表。</p>

        <div class="actions">
          <button class="btn primary" @click="save">保存</button>
          <button class="btn" :disabled="testing" @click="test()">测试（hello → 你好）</button>
          <button class="btn" @click="cancelEdit">取消</button>
        </div>
        <div v-if="testMsg && editing" class="alert" :class="testOk ? 'ok' : 'err'">
          <span class="alert-tag">{{ testOk ? '✓ 测试通过' : '✕ 测试失败' }}</span>
          <span class="alert-text">{{ testOk ? testMsg : friendlyError(testMsg) }}</span>
        </div>
      </div>

      <p class="dim foot-note">通用 API（翻译等）全项目只在此配置一次；密钥只保存在本机，插件经宿主代理调用，不会拿到明文。</p>
    </div>
    <div v-if="opError" class="alert err op-error">
      <span class="alert-tag">✕ 操作失败</span>
      <span class="alert-text">{{ friendlyError(opError) }}</span>
    </div>
  </section>
</template>

<style scoped>
/* 与 SettingsPage 的 .group 分组卡同款（含 h3/row/btn 系列同款）：两处样式手工同步，改视觉要一起改 */
section {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-raised);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-4);
}
h3 {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-title);
  color: var(--fg-dim);
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.spacer {
  flex: 1;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: none;
}
.dot.ok {
  background: var(--ok);
}
.dot.warn {
  background: var(--warn);
}
.dot.gray {
  background: var(--fg-dim);
}
.name {
  font-size: var(--fs-title);
}
.dim {
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.panel {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  margin-bottom: 8px;
}

/* 服务商卡片三行：①名称+当前生效徽标 | 启停开关独占右上 ②类型/密钥副字 ③操作按钮组独立行 */
.provider-card {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  margin-bottom: var(--sp-2);
}
.provider-card.active {
  border-color: var(--accent);
}
.provider-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.provider-id {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}
.provider-name {
  font-size: var(--fs-title);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  flex: none;
  font-size: var(--fs-foot);
  color: var(--accent);
  background: var(--accent-dim);
  border-radius: var(--r-pill);
  padding: 1px 8px;
}
.provider-head .switch {
  margin-left: auto;
}
.provider-sub {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.provider-ops {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-1);
}

.empty {
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  text-align: center;
  margin: 0 0 var(--sp-2);
}
.list-ops {
  display: flex;
  gap: var(--sp-2);
  margin-bottom: var(--sp-3);
}

/* 测试结果/操作错误统一 alert 条：不与按钮同行，独立占行可折行 */
.alert {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  border-radius: var(--r-md);
  padding: var(--sp-2) var(--sp-3);
  font-size: var(--fs-sub);
  margin-bottom: var(--sp-2);
}
.alert-tag {
  flex: none;
  font-weight: 600;
}
.alert-text {
  min-width: 0;
  word-break: break-all;
}
.alert.err {
  background: var(--danger-dim);
  color: var(--danger);
}
.alert.ok {
  background: var(--ok-dim);
  color: var(--ok);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid var(--border);
  padding-top: var(--sp-3);
  margin-top: var(--sp-1);
}
.form-title {
  font-size: var(--fs-sub);
  color: var(--fg-dim);
  font-weight: 600;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field.inline {
  flex-direction: row;
  align-items: center;
  gap: 10px;
}
.field label {
  color: var(--fg-dim);
  font-size: 12px;
}
.desc {
  font-size: 12px;
}
.hint {
  margin: 0;
  font-size: 12px;
}
.console-btn {
  align-self: flex-start;
  color: var(--accent);
  background: transparent;
  border-color: transparent;
  text-decoration: underline;
  padding-left: 0;
}
input,
select {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 6px 10px;
  font-size: 13px;
  font-family: ui-monospace, monospace;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.field.inline select {
  width: auto;
}
.actions {
  display: flex;
  gap: 10px;
}
.btn {
  /* 卡内按钮取 --bg 与卡底 --bg-raised 拉开层次（与 SettingsPage 同款） */
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 5px 12px;
  font-size: var(--fs-title);
  cursor: pointer;
  white-space: nowrap;
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.form .alert {
  margin-bottom: 0;
}
.foot-note {
  margin: var(--sp-4) 0 0;
}
.op-error {
  margin: 8px 0 0;
}
</style>
