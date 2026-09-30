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
  // 主题/透明变化主进程只广播到本窗口（settings-changed 只发主窗），用专用事件同步；
  // transparency 宽松读取保持两侧改动解耦（blur 字段旧载荷缺省视为开）
  window.gtools.on('detached:theme', (p) => {
    const d = p as { theme?: string; transparency?: { enabled: boolean; opacity: number; blur?: boolean } }
    if (typeof d?.theme === 'string') document.documentElement.dataset.theme = d.theme
    if (d?.transparency) {
      document.documentElement.dataset.transparency = d.transparency.enabled ? 'on' : 'off'
      document.documentElement.dataset.blur = d.transparency.blur !== false ? 'on' : 'off'
      // 独立窗不走 App.vue 的 applyVisualSettings，感知曲线 token 需在此对主窗同公式注入
      const t = d.transparency.opacity / 100
      document.documentElement.style.setProperty('--tx', t.toFixed(2))
      document.documentElement.style.setProperty('--txp', Math.pow(1 - t, 3).toFixed(4))
      document.documentElement.style.setProperty('--txf', Math.pow(1 - t, 0.9).toFixed(4))
    }
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
  position: relative;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid transparent;
  /* 全工程唯一投影只挂窗口根；与主窗 .app 同款 padding-box 背景（sheen 高光层 + tint 层）：
     受光边走 --window-ring inset shadow，border-box 渐变会透过半透明 tint 漏满整窗（白纱根因） */
  box-shadow: var(--window-ring, none), var(--shadow-window);
  background:
    linear-gradient(115deg, rgba(255, 255, 255, var(--glass-sheen)), rgba(255, 255, 255, 0) 46%) padding-box,
    linear-gradient(var(--bg-shell), var(--bg-shell)) padding-box;
  /* 磨霜与主窗 .app 同源同变量：macOS 上独立窗透明直透桌面，无此层则失去霜面 */
  backdrop-filter: var(--glass-filter);
}
/* 厚玻璃壁：与主窗 .app::after 同构；--glass-depth 惰性 0px 时 mask xor 无环带不可见 */
.detached::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: var(--glass-depth);
  background: linear-gradient(
    168deg,
    rgba(255, 255, 255, 0.9),
    rgba(255, 255, 255, 0.14) 30%,
    rgba(148, 163, 184, 0.04) 55%,
    rgba(100, 116, 139, 0.16) 84%,
    rgba(255, 255, 255, 0.55)
  );
  -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0) border-box;
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0) border-box;
  mask-composite: exclude;
  pointer-events: none;
}
/* 顶栏扁平化：与窗口根同 tint，无自身材质 */
.topbar {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 40px;
  padding: 0 var(--sp-2) 0 var(--sp-3);
  border-radius: var(--r-xl);
  background: var(--bg-shell);
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
/* 独立窗口的栏在文档流内（不同于主窗悬浮胶囊），插件面板恢复紧凑上边距、不开顶部溶解 */
.detached .body :deep(.plugin-body) {
  padding-top: var(--sp-4);
  scroll-padding-top: 0;
  -webkit-mask-image: none;
  mask-image: none;
}
</style>
