<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { UpdateDownloadSnapshot } from '../env'

const props = defineProps<{ appVersion: string }>()

const platform = computed(() => (navigator.userAgent.includes('Mac') ? 'darwin' : 'win32'))

// 更新状态机：不自动检测（进分区不发网络请求，无静默外联）；切分区由 KeepAlive 保住已检测态
type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'download-failed' | 'failed'
const state = ref<UpdateState>('idle')
const updateInfo = ref<{ current: string; latest: string } | null>(null)
const updateError = ref('')
const downloadUrl = ref<string | null>(null)
const downloadSnap = ref<UpdateDownloadSnapshot | null>(null)

// 下载会话快照 → UI 态（事件、恢复、下载/取消返回共用）
function applySnapshot(snap: UpdateDownloadSnapshot): void {
  downloadSnap.value = snap
  if (snap.state === 'downloading') state.value = 'downloading'
  else if (snap.state === 'downloaded') {
    updateError.value = ''
    state.value = 'downloaded'
  } else if (snap.state === 'failed') state.value = 'download-failed'
  else state.value = updateInfo.value !== null ? 'available' : 'idle'
}

async function checkUpdate(): Promise<void> {
  state.value = 'checking'
  const r = await window.gtools.host('update:check')
  if (!r.ok) {
    updateError.value = r.error ?? '检查更新失败'
    state.value = 'failed'
    return
  }
  const d = r.data as { current: string; latest: string; hasUpdate: boolean; downloadUrl: string | null }
  updateInfo.value = { current: d.current, latest: d.latest }
  downloadUrl.value = d.downloadUrl
  state.value = d.hasUpdate ? 'available' : 'latest'
}

async function startDownload(): Promise<void> {
  const r = await window.gtools.host('update:download')
  if (r.ok) {
    applySnapshot(r.data as UpdateDownloadSnapshot)
    return
  }
  updateError.value = r.error ?? '下载失败'
  state.value = 'download-failed'
}

async function cancelDownload(): Promise<void> {
  const r = await window.gtools.host('update:cancel')
  if (r.ok) applySnapshot(r.data as UpdateDownloadSnapshot)
}

// 安装请求 pending 期间禁用按钮：主进程另有单飞标记，这里是双保险（防双击双拉安装器）
const installPending = ref(false)

async function installUpdate(): Promise<void> {
  if (installPending.value) return
  installPending.value = true
  try {
    const r = await window.gtools.host('update:install')
    if (!r.ok) updateError.value = r.error ?? '安装失败'
  } finally {
    installPending.value = false
  }
}

// 只传意图不传 URL，目标地址由主进程闭包缓存 + 白名单后交 openExternal
function openUpdate(target: 'repo' | 'release' | 'download'): void {
  void window.gtools.host('update:open', { target })
}

function relaunchApp(): void {
  void window.gtools.host('app:relaunch')
}

let offProgress: (() => void) | null = null

onMounted(async () => {
  // 挂载即恢复进行中/已完成的下载会话，并订阅主进程进度广播
  offProgress =
    window.gtools.on('update-download-progress', (payload) => {
      applySnapshot(payload as UpdateDownloadSnapshot)
    }) ?? null
  const r = await window.gtools.host('update:download-status')
  if (r.ok) {
    const snap = r.data as UpdateDownloadSnapshot
    downloadSnap.value = snap
    if (snap.state === 'downloading') state.value = 'downloading'
    else if (snap.state === 'downloaded') state.value = 'downloaded'
  }
})

onBeforeUnmount(() => {
  offProgress?.()
  offProgress = null
})

const percent = computed(() => {
  const snap = downloadSnap.value
  if (snap === null || snap.totalBytes === null || snap.totalBytes <= 0) return 0
  return Math.min(100, Math.floor((snap.receivedBytes / snap.totalBytes) * 100))
})

const fmtMB = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`
const fmtSpeed = (bps: number): string => `${(bps / 1048576).toFixed(1)} MB/s`
</script>

<template>
  <div class="about">
    <div class="group">
      <div class="version-card">
        <span class="app-tile">⚙️</span>
        <div class="version-main">
          <div class="version-title">
            <span class="app-name">GTools</span>
            <span class="accel">v{{ appVersion }}</span>
          </div>
          <a class="repo-link" @click="openUpdate('repo')">github.com/Genmer/GTools</a>
        </div>
        <button class="btn" @click="relaunchApp">重启应用</button>
      </div>
      <p class="dim">{{ platform === 'darwin' ? 'macOS (darwin)' : 'Windows (win32)' }}</p>
    </div>

    <div class="group">
      <div class="group-title">软件更新</div>
      <template v-if="state === 'idle'">
        <p class="dim">检查 GitHub 上的最新 Release</p>
        <div class="actions">
          <button class="btn primary" @click="checkUpdate">检查更新</button>
        </div>
      </template>
      <template v-else-if="state === 'checking'">
        <div class="actions">
          <button class="btn primary" disabled>检测中…</button>
        </div>
      </template>
      <template v-else-if="state === 'available'">
        <p class="update-line accent">发现新版本 v{{ updateInfo?.latest }}</p>
        <p class="dim">当前 v{{ updateInfo?.current }}</p>
        <div class="actions">
          <button v-if="downloadUrl" class="btn primary" @click="startDownload">下载</button>
          <button v-else class="btn primary" @click="openUpdate('download')">前往下载</button>
          <button class="btn" @click="openUpdate('release')">查看发布页</button>
          <button class="btn text" @click="checkUpdate">重新检测</button>
        </div>
      </template>
      <template v-else-if="state === 'downloading'">
        <p class="update-line accent">正在下载 v{{ updateInfo?.latest }}</p>
        <template v-if="downloadSnap && downloadSnap.totalBytes !== null">
          <div class="progress"><div class="progress-fill" :style="{ width: `${percent}%` }"></div></div>
          <p class="dim">
            {{ percent }}% · {{ fmtMB(downloadSnap.receivedBytes) }} / {{ fmtMB(downloadSnap.totalBytes)
            }}<template v-if="downloadSnap.speedBps !== null"> · {{ fmtSpeed(downloadSnap.speedBps) }}</template>
          </p>
        </template>
        <p v-else class="dim">已下载 {{ fmtMB(downloadSnap?.receivedBytes ?? 0) }}</p>
        <div class="actions">
          <button class="btn" @click="cancelDownload">取消</button>
        </div>
      </template>
      <template v-else-if="state === 'downloaded'">
        <p class="update-line ok">安装包已就绪</p>
        <p v-if="updateError" class="update-line danger">{{ updateError }}</p>
        <div class="actions">
          <button class="btn primary" :disabled="installPending" @click="installUpdate">{{ platform === 'win32' ? '重启并安装' : '打开安装包' }}</button>
        </div>
      </template>
      <template v-else-if="state === 'download-failed'">
        <p class="update-line danger">下载失败：{{ downloadSnap?.error ?? updateError }}</p>
        <div class="actions">
          <button v-if="downloadUrl" class="btn primary" @click="startDownload">重试下载</button>
          <button v-else class="btn primary" @click="openUpdate('download')">前往下载</button>
          <button class="btn text" @click="checkUpdate">重新检测</button>
        </div>
      </template>
      <template v-else-if="state === 'latest'">
        <p class="update-line ok">已是最新版本 v{{ updateInfo?.current }}</p>
        <div class="actions">
          <button class="btn" @click="checkUpdate">重新检测</button>
        </div>
      </template>
      <template v-else>
        <p class="update-line danger">检测失败：{{ updateError }}</p>
        <div class="actions">
          <button class="btn primary" @click="checkUpdate">重试</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.about {
  display: flex;
  flex-direction: column;
}
.group {
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-raised);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-4);
}
.group-title {
  display: flex;
  gap: var(--sp-2);
  font-size: var(--fs-title);
  color: var(--fg-dim);
  font-weight: 600;
  margin: 0 0 var(--sp-2);
}
.version-card {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-2);
}
/* 40px 字形磁贴：沿用设置词条同款 ⚙️ 图标 */
.app-tile {
  flex: none;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  background: var(--tile-blue-bg);
  color: var(--tile-blue-fg);
  border-radius: var(--r-md);
}
.version-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.version-title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.app-name {
  font-size: var(--fs-input);
  font-weight: 600;
}
.accel {
  font-family: ui-monospace, monospace;
  background: var(--accent-dim);
  padding: 2px 8px;
  border-radius: var(--r-sm);
  font-size: var(--fs-sub);
}
.repo-link {
  color: var(--accent);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.version-card .btn {
  margin-left: auto;
}
.update-line {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-title);
}
.update-line.accent {
  color: var(--accent);
}
.update-line.ok {
  color: var(--ok);
}
.update-line.danger {
  color: var(--danger);
  word-break: break-all;
}
/* 下载进度条：底 var(--bg) 填充 var(--accent)，6px 圆角细条 */
.progress {
  height: 6px;
  border-radius: var(--r-sm);
  background: var(--bg);
  overflow: hidden;
  margin: var(--sp-2) 0 var(--sp-1);
}
.progress-fill {
  height: 100%;
  border-radius: var(--r-sm);
  background: var(--accent);
  transition: width 0.2s ease;
}
.dim {
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  margin: 0;
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
.btn {
  /* 卡内按钮取 --bg 与卡底 --bg-raised 拉开层次 */
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 5px 12px;
  font-size: var(--fs-title);
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
.btn.text {
  border-color: transparent;
  background: transparent;
  color: var(--fg-dim);
  padding: 5px 4px;
}
.btn.text:hover {
  color: var(--fg);
  background: var(--hover);
}
</style>
