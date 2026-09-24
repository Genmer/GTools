<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PluginContext } from '@sdk/api'
import type { BackupFile } from './logic/format'
import { parseBackup } from './logic/format'
import { fallbackEnvInfo, platformLabel, ENV_STORAGE_KEY, type BackupEnvInfo } from './logic/datadir'
import { buildImportPlan, type ImportPlan } from './logic/diff'
import {
  collectCurrentState,
  executeImport,
  exportToFile,
  NotDataDirError,
  SAFETY_DIR,
  type BackupPort,
  type CurrentState,
  type ExportResult,
  type ImportWriteResult
} from './logic/service'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const env = ref<BackupEnvInfo>(fallbackEnvInfo(''))
const envReady = ref(false)

const tab = ref<'export' | 'import'>(props.initialCommand === 'import' ? 'import' : 'export')

type ExportPhase = 'idle' | 'working' | 'done' | 'error'
const exportPhase = ref<ExportPhase>('idle')
const exportResult = ref<ExportResult | null>(null)
const exportError = ref('')

type ImportPhase = 'pick-file' | 'pick-dir' | 'preview' | 'executing' | 'done' | 'error'
const importPhase = ref<ImportPhase>('pick-file')
const importError = ref('')
const backupPath = ref('')
const backup = ref<BackupFile | null>(null)
const backupWarnings = ref<string[]>([])
const dataDir = ref('')
const plan = ref<ImportPlan | null>(null)
const importResult = ref<ImportWriteResult | null>(null)

function makePort(): BackupPort {
  const host = props.ctx.host
  return {
    pickDirectory: async (title, defaultPath) => (await host.dialog.openFile({ title, directory: true, defaultPath }))[0] ?? null,
    pickBackupFile: async (title) =>
      (await host.dialog.openFile({ title, filters: [{ name: 'GTools 备份', extensions: ['gtools', 'json'] }] }))[0] ?? null,
    pickSavePath: (defaultPath) =>
      host.dialog.saveFile({
        title: '导出 GTools 备份',
        defaultPath,
        filters: [
          { name: 'GTools 备份', extensions: ['gtools'] },
          { name: 'JSON', extensions: ['json'] }
        ]
      }),
    stat: async (path) => host.fs.stat(path),
    list: (dir) => host.fs.list(dir),
    read: (path) => host.fs.read(path),
    write: (path, data, opts) => host.fs.write(path, data, { createDir: opts?.createDir }),
    mkdir: (path) => host.fs.mkdir(path),
    remove: (path) => host.fs.remove(path)
  }
}

// backend 在首次进入插件时才 init，env 可能晚几拍到达，短轮询等它
onMounted(() => {
  void (async () => {
    for (let i = 0; i < 20; i++) {
      try {
        const info = await props.ctx.host.storage.get<BackupEnvInfo>(ENV_STORAGE_KEY)
        if (info && typeof info === 'object' && typeof info.sep === 'string') {
          env.value = info
          envReady.value = true
          return
        }
      } catch {
        // storage 暂不可用则继续等
      }
      const platform = props.ctx.host.app.platform
      if (platform !== '') env.value = fallbackEnvInfo(platform)
      await new Promise((r) => setTimeout(r, 150))
    }
  })()
})

function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : p
}

function sizeLabel(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function timeLabel(iso: string): string {
  if (iso === '') return '未知'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function envHint(): string {
  const c = env.value.candidates[0]
  return `本机 ${platformLabel(env.value.platform)}${c ? `，数据目录通常在 ${c}` : ''}`
}

async function pickDataDir(): Promise<string | null> {
  return makePort().pickDirectory('选择 GTools 数据目录', env.value.candidates[0])
}

async function doExport(): Promise<void> {
  exportPhase.value = 'working'
  exportError.value = ''
  exportResult.value = null
  try {
    const port = makePort()
    const dir = await pickDataDir()
    if (dir === null) {
      exportPhase.value = 'idle'
      return
    }
    const current = await collectCurrentState(port, env.value, dir)
    const r = await exportToFile(port, env.value, dir, current, props.ctx.host.app.version || 'unknown')
    if (r.status === 'canceled') {
      exportPhase.value = 'idle'
      return
    }
    exportResult.value = r
    exportPhase.value = 'done'
  } catch (err) {
    exportPhase.value = 'error'
    exportError.value = err instanceof NotDataDirError ? err.hint : err instanceof Error ? err.message : String(err)
  }
}

function resetImport(): void {
  importPhase.value = 'pick-file'
  importError.value = ''
  backupPath.value = ''
  backup.value = null
  backupWarnings.value = []
  dataDir.value = ''
  plan.value = null
  importResult.value = null
}

async function loadBackupFrom(path: string): Promise<void> {
  importError.value = ''
  try {
    const raw = await makePort().read(path)
    const parsed = parseBackup(raw)
    if (!parsed.ok) throw new Error(parsed.error)
    backupPath.value = path
    backup.value = parsed.backup
    backupWarnings.value = parsed.warnings
    importPhase.value = 'pick-dir'
  } catch (err) {
    importPhase.value = 'error'
    importError.value = err instanceof Error ? err.message : String(err)
  }
}

async function pickBackupFile(): Promise<void> {
  const p = await makePort().pickBackupFile('选择 .gtools 备份文件')
  if (p === null) return
  await loadBackupFrom(p)
}

async function onDrop(e: DragEvent): Promise<void> {
  const file = e.dataTransfer?.files[0]
  if (!file) return
  try {
    const p = window.gtools.pathForFile(file)
    await props.ctx.host.fs.grant([p])
    await loadBackupFrom(p)
  } catch (err) {
    importPhase.value = 'error'
    importError.value = err instanceof Error ? err.message : String(err)
  }
}

async function buildPreview(): Promise<void> {
  if (backup.value === null) return
  importError.value = ''
  try {
    const dir = await pickDataDir()
    if (dir === null) return
    dataDir.value = dir
    const port = makePort()
    const current: CurrentState = await collectCurrentState(port, env.value, dir, { allowEmpty: true })
    const allWarnings = [...backupWarnings.value, ...current.warnings]
    plan.value = buildImportPlan(backup.value, current, allWarnings)
    importPhase.value = 'preview'
  } catch (err) {
    importPhase.value = 'error'
    importError.value = err instanceof NotDataDirError ? err.hint : err instanceof Error ? err.message : String(err)
  }
}

async function confirmImport(): Promise<void> {
  if (backup.value === null || plan.value === null) return
  importPhase.value = 'executing'
  importError.value = ''
  try {
    const port = makePort()
    const current = await collectCurrentState(port, env.value, dataDir.value, { allowEmpty: true })
    importResult.value = await executeImport(port, env.value, dataDir.value, backup.value, current, {
      appVersion: props.ctx.host.app.version || 'unknown'
    })
    importPhase.value = 'done'
  } catch (err) {
    importPhase.value = 'error'
    importError.value = err instanceof Error ? err.message : String(err)
  }
}

async function openDir(p: string): Promise<void> {
  try {
    await props.ctx.host.shell.openPath(p)
  } catch {
    // 打开失败不影响主流程
  }
}

const exportStats = computed(() => {
  const b = exportResult.value?.backup
  if (!b) return null
  const keys = Object.values(b.pluginStorage).reduce((n, kv) => n + Object.keys(kv).length, 0)
  return { plugins: Object.keys(b.pluginStorage).length, keys, bytes: exportResult.value?.bytes ?? 0 }
})

const crossPlatform = computed(
  () => backup.value !== null && backup.value.sourcePlatform !== '' && backup.value.sourcePlatform !== env.value.platform
)

const statusText: Record<string, string> = { new: '新增', update: '覆盖更新', same: '无变化' }
</script>

<template>
  <div class="backup">
    <div class="head">
      <div class="tabs">
        <button :class="{ active: tab === 'export' }" @click="tab = 'export'">导出备份</button>
        <button :class="{ active: tab === 'import' }" @click="tab = 'import'">导入迁移</button>
      </div>
      <span class="env" :title="envReady ? '' : '环境信息加载中'">{{ envHint() }}</span>
    </div>

    <template v-if="tab === 'export'">
      <div class="card">
        <p class="desc">
          把本机全部数据（应用设置 + 所有插件数据）打包成一个 <code>.gtools</code> 文件，内含版本与平台信息；
          绝对路径导出时自动归一化，换 Windows / macOS 机器导入可自动换算。
        </p>
        <div class="actions">
          <button class="btn primary" :disabled="exportPhase === 'working'" @click="doExport">
            {{ exportPhase === 'working' ? '导出中…' : '选择数据目录并导出…' }}
          </button>
        </div>

        <div v-if="exportPhase === 'error'" class="err">
          <p>{{ exportError }}</p>
          <button class="btn" @click="exportPhase = 'idle'">返回重试</button>
        </div>

        <div v-else-if="exportPhase === 'done' && exportResult && exportStats" class="done">
          <p class="ok">✅ 已导出 {{ exportStats.plugins }} 个插件、{{ exportStats.keys }} 条数据（{{ sizeLabel(exportStats.bytes) }}）</p>
          <p class="path" :title="exportResult.path">{{ exportResult.path }}</p>
          <ul v-if="exportResult.warnings.length > 0" class="warns">
            <li v-for="w in exportResult.warnings" :key="w">{{ w }}</li>
          </ul>
          <div class="actions">
            <button class="btn" @click="openDir(dirOf(exportResult.path ?? ''))">打开所在目录</button>
            <button class="btn" @click="exportPhase = 'idle'">再次导出</button>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="card">
        <template v-if="importPhase === 'pick-file'">
          <p class="desc">选择导出的 <code>.gtools</code> 备份文件（兼容宿主设置页导出的 .json）。导入前会先展示差异预览，确认后才写盘。</p>
          <div class="drop" @dragover.prevent @drop.prevent="onDrop">
            <p>把 .gtools / .json 备份文件拖到这里</p>
          </div>
          <div class="actions">
            <button class="btn primary" @click="pickBackupFile">选择备份文件…</button>
          </div>
        </template>

        <template v-else-if="importPhase === 'pick-dir' && backup">
          <p class="meta">
            备份来自 <b>{{ platformLabel(backup.sourcePlatform) }}</b> · 应用 v{{ backup.appVersion }} ·
            {{ timeLabel(backup.createdAt) }} · {{ Object.keys(backup.pluginStorage).length }} 个插件的数据
          </p>
          <ul v-if="backupWarnings.length > 0" class="warns">
            <li v-for="w in backupWarnings" :key="w">{{ w }}</li>
          </ul>
          <p class="desc">接下来选择<b>本机</b> GTools 的数据目录（导入目标）。</p>
          <div class="actions">
            <button class="btn primary" @click="buildPreview">选择本机数据目录…</button>
            <button class="btn" @click="resetImport">重选备份文件</button>
          </div>
        </template>

        <template v-else-if="importPhase === 'preview' && backup && plan">
          <p class="meta">
            备份来自 <b>{{ platformLabel(backup.sourcePlatform) }}</b> · 应用 v{{ backup.appVersion }} ·
            {{ timeLabel(backup.createdAt) }}
            <span v-if="crossPlatform" class="cross">（跨平台迁移：绝对路径将自动转换为本机格式）</span>
          </p>

          <p class="section">插件数据（写 {{ plan.pluginsToWrite }} 个插件 / {{ plan.keysToWrite }} 条）</p>
          <table v-if="plan.plugins.length > 0" class="grid">
            <thead>
              <tr><th>插件</th><th>动作</th><th>明细</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in plan.plugins" :key="p.pluginId" :class="p.status">
                <td class="pid">{{ p.pluginId }}</td>
                <td><span class="badge" :class="p.status">{{ statusText[p.status] }}</span></td>
                <td class="detail">
                  <template v-if="p.status === 'new'">新增 {{ p.added.length }} 条数据</template>
                  <template v-else-if="p.status === 'update'">
                    新增 {{ p.added.length }} · 覆盖 {{ p.overwritten.length }} · 无变化 {{ p.unchangedCount }}
                  </template>
                  <template v-else>内容一致</template>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">备份里没有插件数据</p>

          <p class="section">应用设置</p>
          <table v-if="plan.settingsChanges.length > 0" class="grid">
            <tbody>
              <tr v-for="c in plan.settingsChanges" :key="c.field">
                <td class="pid">{{ c.label }}</td>
                <td class="detail"><span class="old">{{ c.before }}</span> → <span class="new">{{ c.after }}</span></td>
              </tr>
            </tbody>
          </table>
          <p v-else class="muted">与本机一致，不会改动</p>

          <ul v-if="plan.warnings.length > 0" class="warns">
            <li v-for="w in plan.warnings" :key="w">{{ w }}</li>
          </ul>

          <p class="safety">确认导入时会先把本机当前数据快照存到 数据目录/{{ SAFETY_DIR }}/ 下，误导入可回退。</p>
          <div class="actions">
            <button class="btn primary" @click="confirmImport">确认导入</button>
            <button class="btn" @click="resetImport">取消</button>
          </div>
        </template>

        <template v-else-if="importPhase === 'executing'">
          <p class="muted">正在写入…</p>
        </template>

        <template v-else-if="importPhase === 'done' && importResult">
          <p class="ok">✅ 导入完成：{{ importResult.writtenPlugins.length }} 个插件数据{{ importResult.wroteSettings ? ' + 应用设置' : '' }}已写入</p>
          <p v-if="importResult.safetyBackupPath" class="path" :title="importResult.safetyBackupPath">
            导入前快照：{{ importResult.safetyBackupPath }}
          </p>
          <p class="warn-big">请尽快重启 GTools（托盘图标退出后重新打开）使设置与常驻插件生效；重启前不要在设置页改动设置。</p>
          <div class="actions">
            <button
              v-if="importResult.safetyBackupPath"
              class="btn"
              @click="openDir(dirOf(importResult.safetyBackupPath))"
            >
              打开快照目录
            </button>
            <button class="btn" @click="resetImport">继续导入其他备份</button>
          </div>
        </template>

        <template v-else-if="importPhase === 'error'">
          <div class="err">
            <p>{{ importError }}</p>
            <button class="btn" @click="resetImport">返回重试</button>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.backup {
  height: 100%;
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 13px;
}
.head {
  width: 100%;
  max-width: 620px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px 0;
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
  padding: 5px 14px;
  font-size: 12px;
  cursor: pointer;
}
.tabs button.active {
  background: var(--accent-dim);
  color: var(--accent);
}
.env {
  color: var(--fg-dim);
  font-size: 12px;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card {
  width: 100%;
  max-width: 620px;
  margin: 12px 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-raised);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.desc {
  margin: 0;
  color: var(--fg-dim);
  line-height: 1.6;
}
.desc b,
.meta b {
  color: var(--fg);
}
.meta {
  margin: 0;
  color: var(--fg-dim);
  line-height: 1.6;
}
.cross {
  color: var(--accent);
}
.drop {
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 18px;
  text-align: center;
  color: var(--fg-dim);
}
.drop p {
  margin: 0;
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.btn.primary {
  background: var(--accent-dim);
  border-color: var(--accent);
  color: var(--accent);
}
.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.ok {
  margin: 0;
  color: var(--fg);
}
.path {
  margin: 0;
  color: var(--fg-dim);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  word-break: break-all;
  user-select: text;
}
.warns {
  margin: 0;
  padding-left: 18px;
  color: var(--fg-dim);
  line-height: 1.6;
}
.warn-big {
  margin: 0;
  color: var(--danger);
  line-height: 1.6;
}
.err p {
  margin: 0 0 8px;
  color: var(--danger);
  word-break: break-all;
}
.section {
  margin: 4px 0 0;
  color: var(--fg);
  font-weight: 600;
}
.muted {
  margin: 0;
  color: var(--fg-dim);
}
.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.grid th {
  text-align: left;
  color: var(--fg-dim);
  font-weight: normal;
  border-bottom: 1px solid var(--border);
  padding: 4px 8px 4px 0;
}
.grid td {
  border-bottom: 1px solid var(--border);
  padding: 5px 8px 5px 0;
  vertical-align: top;
}
.pid {
  font-family: ui-monospace, monospace;
  color: var(--fg);
}
.detail {
  color: var(--fg-dim);
  word-break: break-all;
}
.old {
  text-decoration: line-through;
  opacity: 0.8;
}
.new {
  color: var(--accent);
}
.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  color: var(--fg-dim);
}
.badge.new {
  border-color: var(--accent);
  color: var(--accent);
}
.badge.update {
  border-color: var(--danger);
  color: var(--danger);
}
.safety {
  margin: 0;
  color: var(--fg-dim);
  line-height: 1.6;
}
code {
  font-family: ui-monospace, monospace;
  background: var(--accent-dim);
  border-radius: 4px;
  padding: 0 4px;
}
</style>
