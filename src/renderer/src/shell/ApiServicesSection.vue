<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'

// 与主进程 api-center 脱敏视图同构的类型（HostInitResult 同款本地镜像模式）
interface ApiProviderView {
  id: string
  type: 'mymemory' | 'http-template'
  name: string
  enabled: boolean
  endpoint?: string
  method?: 'GET' | 'POST'
  bodyTemplate?: string
  resultPath?: string
  hasKey: boolean
}
interface ApiServicesView {
  services: { translate: { activeProviderId: string; providers: ApiProviderView[] } }
}
interface ProviderDraft {
  id?: string
  type: 'mymemory' | 'http-template'
  name: string
  endpoint: string
  method: 'GET' | 'POST'
  bodyTemplate: string
  resultPath: string
  newApiKey: string
}

const view = ref<ApiServicesView | null>(null)
const expanded = ref(false)
const opError = ref('')
const editing = ref(false)
const editingId = ref<string | undefined>(undefined)
const testing = ref(false)
const testMsg = ref('')
const testOk = ref(false)
const draft = reactive<ProviderDraft>(emptyDraft())

function emptyDraft(): ProviderDraft {
  return { type: 'http-template', name: '', endpoint: '', method: 'GET', bodyTemplate: '', resultPath: '', newApiKey: '' }
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

async function host(api: string, payload?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  return window.gtools.host(api, payload)
}

function applyView(data: unknown): void {
  view.value = data as ApiServicesView
}

async function refresh(): Promise<void> {
  const r = await host('api-services:get')
  if (r.ok) applyView(r.data)
  else opError.value = r.error ?? '读取 API 服务配置失败'
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
    newApiKey: draft.newApiKey
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
  if (!window.confirm(`删除服务商「${p.name}」？其密钥将一并删除。`)) return
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
            newApiKey: draft.newApiKey
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
    testMsg.value = d.ok ? `测试通过：${d.resultText ?? ''}` : (d.error ?? '测试失败')
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <section>
    <h3>API 服务</h3>
    <div class="row">
      <span class="dot" :class="dotClass" title="状态"></span>
      <span class="name">翻译</span>
      <span class="dim">{{ activeLabel }}</span>
      <span class="spacer"></span>
      <button class="btn" @click="expanded = !expanded">{{ expanded ? '收起' : '配置' }}</button>
    </div>

    <div v-if="expanded" class="panel">
      <div v-for="p in translate.providers" :key="p.id" class="row provider-row">
        <input
          type="radio"
          name="translate-active"
          :checked="translate.activeProviderId === p.id"
          :title="translate.activeProviderId === p.id ? '当前生效' : '设为当前'"
          @change="setActive(p.id)"
        />
        <span class="name">{{ p.name }}</span>
        <span class="dim">{{ p.type === 'mymemory' ? 'MyMemory 免 Key' : '自定义 HTTP' }}{{ p.hasKey ? ' · 密钥已保存' : '' }}</span>
        <span class="spacer"></span>
        <label class="switch">
          <input type="checkbox" :checked="p.enabled" @change="toggleEnabled(p, ($event.target as HTMLInputElement).checked)" />
          <span>{{ p.enabled ? '已启用' : '已禁用' }}</span>
        </label>
        <button class="btn" @click="test(p)">测试</button>
        <button class="btn" @click="startEdit(p)">编辑</button>
        <button class="btn" @click="remove(p)">删除</button>
      </div>
      <p v-if="translate.providers.length === 0" class="dim">未配置服务商，当前使用默认 MyMemory（免 Key，有匿名每日配额）。</p>

      <div class="row">
        <button class="btn" @click="startAdd">添加服务商</button>
        <button v-if="translate.activeProviderId !== ''" class="btn" @click="useDefault">回到默认 MyMemory</button>
        <span v-if="testMsg" class="testmsg" :class="{ ok: testOk }">{{ testMsg }}</span>
      </div>

      <div v-if="editing" class="form">
        <div class="field">
          <label>类型</label>
          <select v-model="draft.type">
            <option value="http-template">自定义 HTTP 接口（DeepL / 百度 / 彩云等）</option>
            <option value="mymemory">MyMemory（免 Key，匿名有每日配额）</option>
          </select>
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
              v-model="draft.newApiKey"
              type="password"
              :placeholder="editingId && view?.services.translate.providers.find((p) => p.id === editingId)?.hasKey ? '●●●●●（已保存，留空不修改）' : '模板含 {key} 时必填'"
              autocomplete="off"
            />
          </div>
        </template>
        <p v-else class="dim">MyMemory 为公共接口，无需配置字段；保存后会出现在服务商列表。</p>

        <div class="actions">
          <button class="btn primary" @click="save">保存</button>
          <button class="btn" :disabled="testing" @click="test()">测试（hello → 你好）</button>
          <button class="btn" @click="cancelEdit">取消</button>
        </div>
        <span v-if="testMsg && editing" class="testmsg" :class="{ ok: testOk }">{{ testMsg }}</span>
      </div>

      <p class="dim">通用 API（翻译等）全项目只在此配置一次；密钥只保存在本机，插件经宿主代理调用，不会拿到明文。</p>
    </div>
    <p v-if="opError" class="error">{{ opError }}</p>
  </section>
</template>

<style scoped>
section {
  width: 100%;
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
  font-size: 13px;
}
.dim {
  color: var(--fg-dim);
  font-size: 12px;
}
.panel {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
}
.provider-row input[type='radio'] {
  accent-color: var(--accent);
}
.switch {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg-dim);
  cursor: pointer;
  white-space: nowrap;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
  margin-top: 4px;
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
input,
select {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
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
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 13px;
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
.testmsg {
  font-size: 12px;
  color: var(--danger);
  word-break: break-all;
}
.testmsg.ok {
  color: var(--ok);
}
.error {
  color: var(--danger);
  font-size: 13px;
}
</style>
