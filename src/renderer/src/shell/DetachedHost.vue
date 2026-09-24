<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import { router } from './router'
import PluginViewHost from './PluginViewHost.vue'

const props = defineProps<{ manifests: PluginManifest[] }>()

// sandbox 渲染层无 process.platform，用 UA 粗判（仅用于交通灯避让的像素级样式）
const isMac = navigator.userAgent.includes('Mac')
const pinned = ref(false)
const name = computed(() => props.manifests.find((m) => m.id === router.activePluginId)?.name ?? '')

function togglePin(): void {
  pinned.value = !pinned.value
  void window.gtools.host('window:set-always-on-top', { value: pinned.value })
}

function closeWindow(): void {
  void window.gtools.host('window:close-detached')
}

// 独立窗口只有插件态，Esc 即关窗（主窗的 Esc 逐级退出逻辑不适用）
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented) {
    e.preventDefault()
    closeWindow()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // 主题变化主进程只广播到本窗口（settings-changed 只发主窗），用专用事件同步三态
  window.gtools.on('detached:theme', (t) => {
    if (typeof t === 'string') document.documentElement.dataset.theme = t
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="detached">
    <header class="topbar" :class="{ mac: isMac }">
      <span class="title">{{ name }}</span>
      <div class="actions">
        <button class="win-btn" :class="{ on: pinned }" :title="pinned ? '取消置顶' : '窗口置顶'" @mousedown.prevent @click="togglePin">
          <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
            <path
              d="M15.5 2.6l5.9 5.9-2.7.9-3.2 5.7 1.1 3.3-1.5 1.5-4-4-5.3 5.4-1.1-1.1 5.4-5.3-4-4L7.6 9.4l3.3 1.1 5.7-3.2z"
              fill="currentColor"
            />
          </svg>
        </button>
        <button class="win-btn close" title="关闭 (Esc)" @mousedown.prevent @click="closeWindow">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
            <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </header>
    <main class="body">
      <PluginViewHost :manifests="props.manifests" @exit="closeWindow" />
    </main>
  </div>
</template>

<style scoped>
.detached {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-raised);
}
.topbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 40px;
  padding: 0 var(--sp-2) 0 var(--sp-3);
  -webkit-app-region: drag;
}
/* macOS titleBarStyle hidden 的交通灯落在左上角，顶栏左侧让出 70px */
.topbar.mac {
  padding-left: 70px;
}
.title {
  flex: 1;
  min-width: 0;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  -webkit-app-region: no-drag;
}
.win-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}
.win-btn:hover {
  color: var(--fg);
  background: var(--hover);
}
.win-btn.on {
  color: var(--accent);
  background: var(--accent-dim);
}
.win-btn.close:hover {
  color: var(--danger);
}
.body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
</style>
