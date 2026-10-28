<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import ClipboardHistoryPanel, { type ClipHistoryItem } from './ClipboardHistoryPanel.vue'
import { host } from '../core/host-bridge'

// 剪贴板飞窗（Win+V 式）：窗口创建与锚定在主进程，本组件只承担卡片渲染与面板数据流；
// 主窗外壳副作用不进本窗（App.vue isFlyoutWindow 分流），主题/透明经 detached:theme 同步
const items = ref<ClipHistoryItem[]>([])
const offs: (() => void)[] = []

async function refresh(): Promise<void> {
  const r = await host('clipboard-history:list')
  if (r.ok && Array.isArray(r.data)) {
    items.value = (r.data as ClipHistoryItem[]).filter(
      (x): x is ClipHistoryItem =>
        !!x &&
        typeof x.id === 'string' &&
        typeof x.ts === 'number' &&
        (x.kind === 'image'
          ? typeof x.dataUrl === 'string' && typeof x.width === 'number' && typeof x.height === 'number'
          : typeof x.preview === 'string')
    )
  }
}

// 回写/删除/清空全在主进程完成，随后广播驱动刷新；失败静默（下次刷新自愈）
function copyItem(id: string): void {
  void host('clipboard-history:copy', { id })
}

function removeItem(id: string): void {
  void host('clipboard-history:remove', { id })
}

function clearItems(): void {
  void host('clipboard-history:clear')
}

function onVisible(): void {
  // 主窗重新唤起带动本窗显隐，visible 即重拉覆盖错过的广播
  if (document.visibilityState === 'visible') void refresh()
}

onMounted(() => {
  // 启动即拉一次覆盖「服务先于渲染层采集」；主进程采集/copy/remove/clear 任一变更即广播
  const offChanged = window.gtools.on('clipboard-history-changed', () => {
    void refresh()
  })
  if (offChanged) offs.push(offChanged)
  void refresh()
  // 主题/透明变化主进程只广播到本窗口（settings-changed 只发主窗），用专用事件同步；
  // transparency 宽松读取保持两侧改动解耦（blur 字段旧载荷缺省视为开，glassFrost 缺省回 45）
  window.gtools.on('detached:theme', (p) => {
    const d = p as {
      theme?: string
      transparency?: { enabled: boolean; opacity: number; blur?: boolean; glassFrost?: number }
    }
    if (typeof d?.theme === 'string') document.documentElement.dataset.theme = d.theme
    if (d?.transparency) {
      document.documentElement.dataset.transparency = d.transparency.enabled ? 'on' : 'off'
      document.documentElement.dataset.blur = d.transparency.blur !== false ? 'on' : 'off'
      // --frost 与主窗 applyVisualSettings 同公式（四点同 commit 纪律）
      const t = d.transparency.opacity / 100
      document.documentElement.style.setProperty('--tx', t.toFixed(2))
      document.documentElement.style.setProperty('--txp', Math.pow(1 - t, 3).toFixed(4))
      const frostPct = d.transparency.glassFrost
      const frost =
        typeof frostPct === 'number' && Number.isFinite(frostPct) ? Math.min(Math.max(frostPct, 0), 100) : 45
      document.documentElement.style.setProperty('--frost', Math.pow(frost / 100, 0.9).toFixed(4))
    }
  })
  document.addEventListener('visibilitychange', onVisible)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
  for (const off of offs) off()
})
</script>

<template>
  <div class="flyout-card">
    <!-- 拖动头带：全卡唯一 app-region:drag 区（须落在 pointer-events:auto 的卡片根内），面板内容默认可点不受影响 -->
    <div class="flyout-drag" aria-hidden="true"></div>
    <div class="flyout-body">
      <ClipboardHistoryPanel :items="items" @copy="copyItem" @remove="removeItem" @clear="clearItems" />
    </div>
  </div>
</template>

<style>
/* 边距环区不吞点击（F10 主案）：#app 的透明 padding 区 DOM 命中必须关掉，卡片根显式恢复 auto；
   以 html[data-flyout] 为作用域键——样式表全窗共享，只有飞窗窗口命中，主窗/独立窗零影响 */
html[data-flyout='1'] #app {
  pointer-events: none;
}
</style>

<style scoped>
/* 卡片根承担全部卡片外观（F11/F12）：定位交给 #app 边距环 padding，圆角与主窗同语言（--r-window）、
   实底背板（--bg 比 --bg-content 更实：浮窗独立于主窗，防底层内容透出显影）、题2 黑细线描边、外投影落边距环 */
.flyout-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
  border: 1px solid var(--window-outline, transparent);
  border-radius: var(--r-window);
  background: var(--bg);
  box-shadow: var(--window-ring, none), var(--shadow-window);
}
/* 拖动头带（≤10px 窄条）：中央 grip 线示意可拖；占位高度由列表 flex:1 吸收，窗口尺寸不变 */
.flyout-drag {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 10px;
  -webkit-app-region: drag;
}
.flyout-drag::after {
  content: '';
  width: 36px;
  height: 3px;
  border-radius: 2px;
  background: var(--border);
}
.flyout-body {
  flex: 1;
  min-height: 0;
}
</style>
