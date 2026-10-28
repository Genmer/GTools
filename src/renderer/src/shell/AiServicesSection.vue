<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref } from 'vue'
import { host } from '../core/host-bridge'

// 与主进程 api-center ai 段脱敏视图同构（HostInitResult 同款本地镜像模式）；通道载荷带 service:'ai'
interface AiProviderView {
  id: string
  type: 'ai-chat'
  name: string
  enabled: boolean
  baseUrl?: string
  model?: string
  hasKey: boolean
}
interface AiServicesView {
  services: { ai: { activeProviderId: string; providers: AiProviderView[] } }
}
interface ProviderDraft {
  id?: string
  name: string
  baseUrl: string
  model: string
  newApiKey: string
}

const view = ref<AiServicesView | null>(null)
const expanded = ref(false)
const opError = ref('')
const editing = ref(false)
const editingId = ref<string | undefined>(undefined)
const testing = ref(false)
const testMsg = ref('')
const testOk = ref(false)
const draft = reactive<ProviderDraft>(emptyDraft())

function emptyDraft(): ProviderDraft {
  return { name: '', baseUrl: '', model: '', newApiKey: '' }
}

const ai = computed(() => view.value?.services.ai ?? { activeProviderId: '', providers: [] as AiProviderView[] })
const activeProvider = computed(() => ai.value.providers.find((p) => p.id === ai.value.activeProviderId) ?? null)
// ai 无内置默认：activeProviderId 为空即未配置（SERVICE_UNCONFIGURED），故空态打灰点而非绿点
const dotClass = computed(() => {
  if (!activeProvider.value) return 'gray'
  return activeProvider.value.enabled ? 'ok' : 'warn'
})
const activeLabel = computed(() => activeProvider.value?.name ?? '未配置（插件将提示服务未配置）')

function applyView(data: unknown): void {
  view.value = data as AiServicesView
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

function startEdit(p: AiProviderView): void {
  editingId.value = p.id
  Object.assign(draft, emptyDraft())
  draft.name = p.name
  draft.baseUrl = p.baseUrl ?? ''
  draft.model = p.model ?? ''
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
    service: 'ai',
    id: editingId.value,
    type: 'ai-chat',
    name: draft.name,
    enabled: true,
    baseUrl: draft.baseUrl,
    model: draft.model,
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

async function remove(p: AiProviderView): Promise<void> {
  opError.value = ''
  if (!window.confirm(`删除供应商「${p.name}」？其密钥将一并删除。`)) return
  const r = await host('api-services:remove-provider', { service: 'ai', id: p.id })
  if (!r.ok) opError.value = r.error ?? '删除失败'
  else applyView(r.data)
}

async function setActive(id: string): Promise<void> {
  opError.value = ''
  const r = await host('api-services:set-active', { service: 'ai', id })
  if (!r.ok) opError.value = r.error ?? '设置失败'
  else applyView(r.data)
}

async function toggleEnabled(p: AiProviderView, enabled: boolean): Promise<void> {
  opError.value = ''
  const r = await host('api-services:upsert-provider', {
    service: 'ai',
    id: p.id,
    type: 'ai-chat',
    name: p.name,
    enabled,
    baseUrl: p.baseUrl,
    model: p.model
  })
  if (!r.ok) opError.value = r.error ?? '操作失败'
  else applyView(r.data)
}

async function test(p?: AiProviderView): Promise<void> {
  opError.value = ''
  testMsg.value = ''
  testing.value = true
  try {
    const payload = p
      ? { service: 'ai', id: p.id }
      : {
          service: 'ai',
          id: editingId.value,
          draft: {
            id: editingId.value,
            type: 'ai-chat',
            name: draft.name === '' ? '（草稿）' : draft.name,
            enabled: true,
            baseUrl: draft.baseUrl,
            model: draft.model,
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
    <h3>AI 对话（大模型）</h3>
    <div class="row">
      <span class="dot" :class="dotClass" title="状态"></span>
      <span class="name">AI 对话</span>
      <span class="dim">{{ activeLabel }}</span>
      <span class="spacer"></span>
      <button class="btn" @click="expanded = !expanded">{{ expanded ? '收起' : '配置' }}</button>
    </div>

    <div v-if="expanded" class="panel">
      <div v-for="p in ai.providers" :key="p.id" class="row provider-row">
        <input
          type="radio"
          name="ai-active"
          :checked="ai.activeProviderId === p.id"
          :title="ai.activeProviderId === p.id ? '当前生效' : '设为当前'"
          @change="setActive(p.id)"
        />
        <span class="name">{{ p.name }}</span>
        <span class="dim">{{ p.model }}{{ p.hasKey ? ' · 密钥已保存' : ' · 未设密钥' }}</span>
        <span class="spacer"></span>
        <label class="switch">
          <input type="checkbox" :checked="p.enabled" @change="toggleEnabled(p, ($event.target as HTMLInputElement).checked)" />
          <span>{{ p.enabled ? '已启用' : '已禁用' }}</span>
        </label>
        <button class="btn" @click="test(p)">测试</button>
        <button class="btn" @click="startEdit(p)">编辑</button>
        <button class="btn" @click="remove(p)">删除</button>
      </div>
      <p v-if="ai.providers.length === 0" class="dim">
        未配置供应商。AI 对话没有内置免 Key 默认，未配置时相关插件（如 AI翻译）会提示服务未配置。
      </p>

      <div class="row">
        <button class="btn" @click="startAdd">添加供应商</button>
        <span v-if="testMsg" class="testmsg" :class="{ ok: testOk }">{{ testMsg }}</span>
      </div>

      <div v-if="editing" class="form">
        <div class="field">
          <label>名称</label>
          <input v-model="draft.name" placeholder="如：DeepSeek / OpenAI" />
        </div>
        <div class="field">
          <label>接口地址（OpenAI 兼容根地址，自动拼接 /chat/completions）</label>
          <input v-model="draft.baseUrl" placeholder="https://api.openai.com/v1" spellcheck="false" />
        </div>
        <div class="field">
          <label>模型名</label>
          <input v-model="draft.model" placeholder="如 gpt-4o-mini / deepseek-chat" spellcheck="false" />
        </div>
        <div class="field">
          <label>API 密钥（仅存本机 userData，不上传不下发渲染层）</label>
          <input
            v-model="draft.newApiKey"
            type="password"
            :placeholder="editingId && ai.providers.find((p) => p.id === editingId)?.hasKey ? '●●●●●（已保存，留空不修改）' : 'sk-…'"
            autocomplete="off"
          />
        </div>

        <div class="actions">
          <button class="btn primary" @click="save">保存</button>
          <button class="btn" :disabled="testing" @click="test()">测试（hello）</button>
          <button class="btn" @click="cancelEdit">取消</button>
        </div>
        <span v-if="testMsg && editing" class="testmsg" :class="{ ok: testOk }">{{ testMsg }}</span>
      </div>

      <p class="dim">供应商供 AI翻译等插件选用；密钥只在主进程使用，插件经宿主代理调用，不会拿到明文。</p>
    </div>
    <p v-if="opError" class="error">{{ opError }}</p>
  </section>
</template>

<style scoped>
/* 与 SettingsPage 的 .group 分组卡同款（含 h3/row/btn 系列同款）：三处样式手工同步，改视觉要一起改 */
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
.field label {
  color: var(--fg-dim);
  font-size: 12px;
}
input {
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
