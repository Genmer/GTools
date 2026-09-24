<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import type { AppSettings, ThemeName } from '@sdk/settings'
import { normalizeAccelerator, validateAccelerator } from '@sdk/shortcut-rules'
import ApiServicesSection from './ApiServicesSection.vue'

const props = defineProps<{ settings: AppSettings | null; plugins: { manifest: PluginManifest; enabled: boolean }[] }>()

const hotkeyError = ref<string | null>(null)
const recording = ref(false)
const pendingAccel = ref<string | null>(null)
const opError = ref<string | null>(null)

const platform = computed(() => (navigator.userAgent.includes('Mac') ? 'darwin' : 'win32'))
const currentHotkey = computed(() => props.settings?.hotkey[platform.value] ?? '')
const themes: { id: ThemeName; label: string }[] = [
  { id: 'light', label: '白色' },
  { id: 'dark', label: '黑色' },
  { id: 'glass', label: '玻璃' }
]

async function setTheme(theme: ThemeName): Promise<void> {
  const r = await window.gtools.host('settings:set', { theme })
  if (!r.ok) opError.value = r.error ?? '保存失败'
}

function startRecording(): void {
  recording.value = true
  pendingAccel.value = null
  hotkeyError.value = null
}

function onRecordKey(e: KeyboardEvent): void {
  if (!recording.value) return
  if (e.isComposing) return // 输入法组合态不录键
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    recording.value = false
    return
  }
  const mods: string[] = []
  if (e.metaKey) mods.push('Cmd')
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const keyName =
    e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key[0].toUpperCase() + e.key.slice(1)
  if (['Cmd', 'Ctrl', 'Alt', 'Shift', 'Meta', 'Control', 'Option'].includes(e.key)) return // 修饰键单独按下不结算
  const accel = normalizeAccelerator([...mods, keyName].join('+'))
  pendingAccel.value = accel
  const issue = validateAccelerator(accel, platform.value)
  hotkeyError.value = issue.ok ? null : (issue.reason ?? null)
}

async function saveHotkey(): Promise<void> {
  if (!pendingAccel.value || hotkeyError.value) return
  const r = await window.gtools.host('settings:set', { hotkey: { [platform.value]: pendingAccel.value } })
  if (!r.ok) {
    hotkeyError.value = r.error ?? '注册失败'
    return
  }
  recording.value = false
  pendingAccel.value = null
}

async function togglePlugin(id: string, enabled: boolean): Promise<void> {
  const r = await window.gtools.host('plugins:set-enabled', { id, enabled })
  if (!r.ok) opError.value = r.error ?? '操作失败'
}

const backupMsg = ref<string | null>(null)
const backupIsError = ref(false)
const backupBusy = ref(false)

async function exportBackup(): Promise<void> {
  backupBusy.value = true
  backupMsg.value = null
  try {
    const r = await window.gtools.host('backup:export')
    if (!r.ok) {
      backupIsError.value = true
      backupMsg.value = r.error ?? '导出失败'
      return
    }
    const path = (r.data as { path: string | null } | null)?.path ?? null
    backupIsError.value = false
    backupMsg.value = path === null ? '已取消导出' : `已导出到 ${path}`
  } finally {
    backupBusy.value = false
  }
}

async function importBackup(): Promise<void> {
  backupBusy.value = true
  backupMsg.value = null
  try {
    const r = await window.gtools.host('backup:import')
    if (!r.ok) {
      backupIsError.value = true
      backupMsg.value = r.error ?? '导入失败'
      return
    }
    const d = r.data as {
      restored: boolean
      warnings: string[]
      restartRecommended: boolean
      safetyBackupPath: string | null
    }
    backupIsError.value = false
    if (!d.restored) {
      backupMsg.value = '已取消导入'
      return
    }
    const parts = ['导入成功']
    if (d.safetyBackupPath) parts.push(`导入前数据已快照到 ${d.safetyBackupPath}`)
    if (d.restartRecommended) parts.push('建议重启应用，使常驻插件加载导入的数据')
    if (d.warnings.length > 0) parts.push(d.warnings.join('；'))
    backupMsg.value = parts.join('，')
  } finally {
    backupBusy.value = false
  }
}
</script>

<template>
  <div class="settings" @keydown="onRecordKey">
    <section>
      <h3>主题</h3>
      <div class="row">
        <button
          v-for="t in themes"
          :key="t.id"
          class="btn"
          :class="{ primary: settings?.theme === t.id }"
          @click="setTheme(t.id)"
        >
          {{ t.label }}
        </button>
      </div>
    </section>

    <section>
      <h3>全局快捷键</h3>
      <div class="row">
        <span class="accel">{{ currentHotkey || '未设置' }}</span>
        <button class="btn" @click="startRecording">{{ recording ? '录入中…（按 Esc 取消）' : '修改' }}</button>
        <template v-if="recording && pendingAccel">
          <span class="accel preview">{{ pendingAccel }}</span>
          <button class="btn primary" :disabled="hotkeyError !== null" @click="saveHotkey">保存</button>
        </template>
        <span v-if="hotkeyError" class="error">{{ hotkeyError }}</span>
      </div>
    </section>

    <section>
      <h3>插件</h3>
      <div v-for="p in plugins" :key="p.manifest.id" class="row plugin-row">
        <span class="icon">{{ p.manifest.icon }}</span>
        <span class="name">{{ p.manifest.name }}</span>
        <span class="dim">{{ p.manifest.id }} · v{{ p.manifest.version }}</span>
        <label class="switch">
          <input type="checkbox" :checked="p.enabled" @change="togglePlugin(p.manifest.id, ($event.target as HTMLInputElement).checked)" />
          <span>{{ p.enabled ? '已启用' : '已禁用' }}</span>
        </label>
      </div>
    </section>

    <ApiServicesSection />

    <section>
      <h3>备份与恢复</h3>
      <div class="row">
        <button class="btn" :disabled="backupBusy" @click="exportBackup">导出备份…</button>
        <button class="btn" :disabled="backupBusy" @click="importBackup">导入备份…</button>
      </div>
      <p v-if="backupMsg" class="backup-msg" :class="{ error: backupIsError }">{{ backupMsg }}</p>
      <p class="dim">备份包含应用设置、API 服务配置、插件启用状态与全部插件数据，可用于 Windows / macOS 之间迁移。</p>
    </section>

    <p v-if="opError" class="error">{{ opError }}</p>
    <p class="dim tip">按 Esc 返回搜索</p>
  </div>
</template>

<style scoped>
.settings {
  height: 100%;
  overflow-y: auto;
  padding: 16px 20px;
  box-sizing: border-box;
}
section {
  margin-bottom: 20px;
}
h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--fg-dim);
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.accel {
  font-family: ui-monospace, monospace;
  background: var(--accent-dim);
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
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
.plugin-row .icon {
  font-size: 18px;
}
.name {
  font-size: 14px;
}
.dim {
  color: var(--fg-dim);
  font-size: 12px;
}
.switch {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg-dim);
  cursor: pointer;
}
.error {
  color: var(--danger);
  font-size: 13px;
}
.backup-msg {
  margin: 4px 0 8px;
  font-size: 12px;
  color: var(--fg-dim);
  word-break: break-all;
}
.tip {
  margin-top: 12px;
}
</style>
