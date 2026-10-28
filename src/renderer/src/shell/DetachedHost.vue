<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import { rimFlowPeriodSeconds, sanitizeOutlineCustomColor } from '@sdk/settings'
import { appInfo } from '../core/app-info'
import { host } from '../core/host-bridge'
import { router } from './router'
import { RIM_SEGMENTS_GRADIENT, RIM_SEGMENTS_RAINBOW } from './rim-ring-segments'
import PluginViewHost from './PluginViewHost.vue'

const props = defineProps<{ manifests: PluginManifest[] }>()

// 冲刷 ACK 等待上限：等草稿落盘真完成（大草稿压缩耗时远超一拍），到点放行；主进程侧另有 600ms 超时兜底
const FLUSH_ACK_DELAY_MS = 500

// 交通灯避让样式读 app-info 单例（app:init 真值到达前是 UA 占位）
const isMac = computed(() => appInfo.platform === 'darwin')
const pinned = ref(false)
const name = computed(() => props.manifests.find((m) => m.id === router.activePluginId)?.name ?? '')

function togglePin(): void {
  pinned.value = !pinned.value
  void host('window:set-always-on-top', { value: pinned.value })
}

function closeWindow(): void {
  void host('window:close-detached')
}

// 两阶段关窗：主进程先 hide 并发 detached:flush，这里广播草稿冲刷（插件监听 gtools:flush-drafts
// 落盘并经 detail.track 上报 promise），等冲刷真完成再 ACK 真关；ACK 命中主进程 flushing 分支直接销毁
let offFlush: (() => void) | undefined

// 独立窗口只有插件态，Esc 即关窗（主窗的 Esc 逐级退出逻辑不适用）
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.isComposing && !e.defaultPrevented) {
    e.preventDefault()
    closeWindow()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  offFlush = window.gtools.on('detached:flush', () => {
    const tracked: Promise<unknown>[] = []
    window.dispatchEvent(
      new CustomEvent<{ track(p: Promise<unknown>): void } | undefined>('gtools:flush-drafts', {
        detail: { track: (p) => { tracked.push(p) } }
      })
    )
    void Promise.race([
      Promise.allSettled(tracked),
      new Promise<void>((r) => setTimeout(r, FLUSH_ACK_DELAY_MS))
    ]).then(() => host('window:close-detached'))
  })
  // 主题/透明变化主进程只广播到本窗口（settings-changed 只发主窗），用专用事件同步；
  // transparency/outline 宽松读取保持两侧改动解耦（blur 字段旧载荷缺省视为开）
  window.gtools.on('detached:theme', (p) => {
    const d = p as {
      theme?: string
      transparency?: { enabled: boolean; opacity: number; blur?: boolean; glassFrost?: number }
      outline?: { enabled: boolean; width: number; color: string; customColor?: string; flowSpeed?: number }
    }
    if (typeof d?.theme === 'string') document.documentElement.dataset.theme = d.theme
    if (d?.transparency) {
      document.documentElement.dataset.transparency = d.transparency.enabled ? 'on' : 'off'
      document.documentElement.dataset.blur = d.transparency.blur !== false ? 'on' : 'off'
      // 独立窗不走 App.vue 的 applyVisualSettings，感知曲线 token 需在此对主窗同公式注入；
      // --frost 旧载荷缺字段宽松回 45（与 App.vue/飞窗四点同公式）
      const t = d.transparency.opacity / 100
      document.documentElement.style.setProperty('--tx', t.toFixed(2))
      document.documentElement.style.setProperty('--txp', Math.pow(1 - t, 3).toFixed(4))
      const frostPct = d.transparency.glassFrost
      const frost =
        typeof frostPct === 'number' && Number.isFinite(frostPct) ? Math.min(Math.max(frostPct, 0), 100) : 45
      document.documentElement.style.setProperty('--frost', Math.pow(frost / 100, 0.9).toFixed(4))
    }
    if (d?.outline) {
      // 同主窗：off 注 0px 内联防回落 CSS 被透明组特异性压过；width 坏值回退 3
      const w = typeof d.outline.width === 'number' && Number.isFinite(d.outline.width) ? d.outline.width : 3
      document.documentElement.dataset.ring = d.outline.enabled ? 'on' : 'off'
      document.documentElement.style.setProperty('--rim-width', d.outline.enabled ? `${w}px` : '0px')
      if (d.outline.color === 'auto') delete document.documentElement.dataset.rimColor
      else if (d.outline.color === 'white' || d.outline.color === 'black' || d.outline.color === 'rainbow' || d.outline.color === 'rainbow-gradient' || d.outline.color === 'custom') {
        document.documentElement.dataset.rimColor = d.outline.color
      }
      if (d.outline.color === 'custom') {
        const hex = sanitizeOutlineCustomColor(d.outline.customColor)
        if (hex) document.documentElement.style.setProperty('--rim-custom', hex)
      }
      // 流动周期：载荷缺省/坏值时公式内回退 12s（同 App.vue 公式，两窗不漂移）
      document.documentElement.style.setProperty('--rim-flow-period', `${rimFlowPeriodSeconds(d.outline.flowSpeed)}s`)
      // 同 App.vue applyVisualSettings：流动与 rimColor 原子同步，关环置 off 消除空帧动画
      const rimFlow = (d.outline.color === 'rainbow' || d.outline.color === 'rainbow-gradient') && d.outline.enabled
      document.documentElement.dataset.rimFlow = rimFlow ? 'on' : 'off'
    }
  })
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  offFlush?.()
})
</script>

<template>
  <div class="detached">
    <!-- 同 App.vue 的七彩环承载层：常驻挂载，显隐/几何/动画全交 themes.css；段列共享 rim-ring-segments -->
    <svg class="rim-ring" aria-hidden="true">
      <g class="g-rainbow">
        <rect
          v-for="(s, i) in RIM_SEGMENTS_RAINBOW"
          :key="`rb${i}`"
          pathLength="100"
          :style="{ stroke: s.color, strokeDashoffset: s.offset, animationDelay: s.delay }"
        />
      </g>
      <g class="g-gradient">
        <rect
          v-for="(s, i) in RIM_SEGMENTS_GRADIENT"
          :key="`gd${i}`"
          pathLength="100"
          :style="{ stroke: s.color, strokeDashoffset: s.offset, animationDelay: s.delay }"
        />
      </g>
    </svg>
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
  /* 同 .app 圆角分治：透明窗系统裁圆角，CSS 画同半径弧防方角环被啃角；不透明窗交 OS 裁 */
  border-radius: 0;
  /* 与 .app 同构：1px 边框 glass 下上色深勾边（--panel-edge） */
  border: 1px solid var(--panel-edge, transparent);
  /* 全工程唯一投影只挂窗口根；与主窗 .app 同款 padding-box 背景（sheen 高光层 + tint 层）：
     受光边走 --window-ring inset shadow，border-box 渐变会透过半透明 tint 漏满整窗（白纱根因）；
     --panel-halo 同 .app：glass 深勾边挂面板自身防 overflow 裁剪 */
  box-shadow: var(--panel-halo, none), var(--window-ring, none), var(--shadow-window);
  background:
    linear-gradient(115deg, rgba(255, 255, 255, var(--glass-sheen)), rgba(255, 255, 255, 0) 46%) padding-box,
    linear-gradient(var(--bg-shell), var(--bg-shell)) padding-box;
  /* 磨霜与主窗 .app 同源同变量：macOS 上独立窗透明直透桌面，无此层则失去霜面 */
  backdrop-filter: var(--glass-filter);
}
html[data-wintx='1'] .detached {
  border-radius: var(--r-window);
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
/* 圆角分治与主窗 .app 一致（App.vue 同款规则）：透明窗 CSS 透空四角，不透明窗交 OS 裁剪 */
html[data-wintx='1'] .detached {
  border-radius: var(--r-window);
  /* 透明窗吃进 #app padding-box，外投影落进边距环；无边距环时 #app padding=0，height:100% ≡ 100vh */
  height: 100%;
}
/* win32 不透明窗（独立窗不持系统材质，blur 开由主题底色补观感）：feTurbulence 噪点自绘玻璃颗粒，
   叠 sheen 之上（同主窗 .app 手法） */
html[data-wintx='0'][data-blur='on'] .detached {
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E")
      padding-box,
    linear-gradient(115deg, rgba(255, 255, 255, var(--glass-sheen)), rgba(255, 255, 255, 0) 46%) padding-box,
    linear-gradient(var(--bg-shell), var(--bg-shell)) padding-box;
}
/* 顶栏去卡片化：与 .plugin-body 同背板连成连续材质平面，hairline 分界，上角交 .detached overflow:hidden 裁剪 */
.topbar {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 40px;
  padding: 0 var(--sp-2) 0 var(--sp-4);
  border-bottom: 1px solid var(--border);
  background: var(--bg-content);
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
