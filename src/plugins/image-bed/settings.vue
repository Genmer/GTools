<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { PluginContext } from '@sdk/api'
import { FORMAT_LABELS } from './logic/formats'
import {
  DEFAULT_IMAGE_BED_SETTINGS,
  MAX_HISTORY_LIMIT,
  MIN_HISTORY_LIMIT,
  SETTINGS_STORAGE_KEY,
  isHttpUrl,
  normalizeImageBedSettings
} from './logic/settings'
import type { AuthScheme, ImageBedSettings, LinkFormat, ProviderId } from './logic/settings'

const props = defineProps<{ ctx: PluginContext; settings: ImageBedSettings }>()
const emit = defineEmits<{ saved: [settings: ImageBedSettings]; close: [] }>()

// normalize 会深拷贝，草稿编辑不影响父组件当前生效设置
const draft = reactive(normalizeImageBedSettings(props.settings))
const validationError = ref('')
const saving = ref(false)

const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: 'smms', name: 'sm.ms（默认）' },
  { id: 'lsky', name: '兰空 lsky' },
  { id: 'custom', name: '自定义接口' }
]
const SCHEMES: { id: AuthScheme; name: string }[] = [
  { id: 'bearer', name: 'Bearer（兰空等常见）' },
  { id: 'basic', name: 'Basic（sm.ms 等）' },
  { id: 'raw', name: '裸 Token' },
  { id: 'none', name: '无鉴权' }
]
const FORMATS: LinkFormat[] = ['url', 'markdown', 'html']

const isLsky = computed(() => draft.providerId === 'lsky')
const isCustom = computed(() => draft.providerId === 'custom')

function cloneDraft(): ImageBedSettings {
  return normalizeImageBedSettings(JSON.parse(JSON.stringify(draft)))
}

async function save(): Promise<void> {
  validationError.value = ''
  if (isLsky.value && !isHttpUrl(draft.lskyApiUrl)) {
    validationError.value = '兰空 API 地址必须以 http:// 或 https:// 开头'
    return
  }
  if (isLsky.value && draft.lskyToken === '') {
    validationError.value = '兰空接口需要 Token'
    return
  }
  if (isCustom.value && !isHttpUrl(draft.custom.apiUrl)) {
    validationError.value = '接口地址必须以 http:// 或 https:// 开头'
    return
  }
  saving.value = true
  try {
    const next = cloneDraft()
    await props.ctx.host.storage.set(SETTINGS_STORAGE_KEY, next)
    emit('saved', next)
    emit('close')
  } catch (err) {
    validationError.value = err instanceof Error ? err.message : '保存失败'
  } finally {
    saving.value = false
  }
}

function resetToDefault(): void {
  Object.assign(draft, normalizeImageBedSettings(DEFAULT_IMAGE_BED_SETTINGS))
}
</script>

<template>
  <div class="panel">
    <div class="field">
      <label>图床服务</label>
      <select v-model="draft.providerId">
        <option v-for="p in PROVIDERS" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>

    <template v-if="draft.providerId === 'smms'">
      <div class="field">
        <label>API Token（可选，匿名上传有额度限制）</label>
        <input v-model="draft.smmsToken" type="password" placeholder="在 sm.ms 个人中心 User → API Token 获取" autocomplete="off" />
      </div>
      <p class="muted">默认接口 https://sm.ms/api/v2/upload；免费账户单图 5MB，Token 只存本机。</p>
    </template>

    <template v-else-if="isLsky">
      <div class="field">
        <label>兰空站点地址</label>
        <input v-model="draft.lskyApiUrl" placeholder="https://lsky.example.com" spellcheck="false" />
      </div>
      <div class="field">
        <label>Token（Bearer）</label>
        <input v-model="draft.lskyToken" type="password" placeholder="POST /api/v1/tokens 用邮箱密码换取" autocomplete="off" />
      </div>
      <p class="muted">上传走 {站点}/api/v1/upload，字段名 file，链接取 data.links.url。</p>
    </template>

    <template v-else>
      <div class="field">
        <label>上传接口地址（完整 URL）</label>
        <input v-model="draft.custom.apiUrl" placeholder="https://api.example.com/upload" spellcheck="false" />
      </div>
      <div class="field inline">
        <label>鉴权方式</label>
        <select v-model="draft.custom.authScheme">
          <option v-for="s in SCHEMES" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div v-if="draft.custom.authScheme !== 'none'" class="field">
        <label>Token</label>
        <input v-model="draft.custom.token" type="password" placeholder="仅保存在本机" autocomplete="off" />
      </div>
      <div class="field">
        <label>文件字段名</label>
        <input v-model="draft.custom.fileField" placeholder="file" spellcheck="false" />
      </div>
      <div class="field">
        <label>链接字段路径（点分；留空自动探测常见结构）</label>
        <input v-model="draft.custom.urlPath" placeholder="data.links.url" spellcheck="false" />
      </div>
    </template>

    <div class="field inline">
      <label>默认复制格式</label>
      <select v-model="draft.defaultFormat">
        <option v-for="f in FORMATS" :key="f" :value="f">{{ FORMAT_LABELS[f] }}</option>
      </select>
    </div>
    <div class="field inline">
      <label>历史上限（{{ MIN_HISTORY_LIMIT }}–{{ MAX_HISTORY_LIMIT }} 条）</label>
      <input v-model.number="draft.historyLimit" type="number" :min="MIN_HISTORY_LIMIT" :max="MAX_HISTORY_LIMIT" />
    </div>

    <p v-if="validationError" class="err">{{ validationError }}</p>
    <div class="actions">
      <button class="btn primary" :disabled="saving" @click="save">保存</button>
      <button class="btn" @click="emit('close')">取消</button>
      <button class="btn" title="恢复默认设置" @click="resetToDefault">恢复默认</button>
    </div>
  </div>
</template>

<style scoped>
.panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 13px;
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
.field.inline label {
  flex: none;
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
.field.inline input,
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
  padding: 5px 14px;
  font-size: 13px;
  cursor: pointer;
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.err {
  color: var(--danger);
  margin: 0;
}
.muted {
  color: var(--fg-dim);
  font-size: 12px;
  margin: 0;
}
</style>
