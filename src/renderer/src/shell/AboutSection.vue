<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ appVersion: string }>()

const platform = computed(() => (navigator.userAgent.includes('Mac') ? 'darwin' : 'win32'))

// 更新状态机：不自动检测（进分区不发网络请求，无静默外联）；切分区由 KeepAlive 保住已检测态
type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'failed'
const state = ref<UpdateState>('idle')
const updateInfo = ref<{ current: string; latest: string } | null>(null)
const updateError = ref('')

async function checkUpdate(): Promise<void> {
  state.value = 'checking'
  const r = await window.gtools.host('update:check')
  if (!r.ok) {
    updateError.value = r.error ?? '检查更新失败'
    state.value = 'failed'
    return
  }
  const d = r.data as { current: string; latest: string; hasUpdate: boolean }
  updateInfo.value = { current: d.current, latest: d.latest }
  state.value = d.hasUpdate ? 'available' : 'latest'
}

// 只传意图不传 URL，目标地址由主进程闭包缓存 + 白名单后交 openExternal
function openUpdate(target: 'repo' | 'release' | 'download'): void {
  void window.gtools.host('update:open', { target })
}

function relaunchApp(): void {
  void window.gtools.host('app:relaunch')
}
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
          <button class="btn primary" @click="openUpdate('download')">前往下载</button>
          <button class="btn" @click="openUpdate('release')">查看发布页</button>
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
