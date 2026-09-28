<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import type { RecItem } from '../core/recommend'
import { APPS_FOLD_COUNT, tileColorClass, type NativeAppItem, type RecentTile } from './app-grid'

// 兜底模式的最近使用行（与 App.vue recentRows 结构对齐的结构化类型）
interface RecentRow {
  key: string
  title: string
  subtitle: string
  icon: string
  pluginId: string
  commandId?: string
}

const props = defineProps<{
  plugins: PluginManifest[]
  recents: RecentRow[]
  recentTiles: RecentTile[]
  /** 剪贴板 JSON 推荐（C2）：占扁平导航序最前 K 位，两分支顶部各渲染一行 */
  clipboardRecs: RecItem[]
  /** 搜索历史词（新→旧）：剪贴板行之后第二段 chips 行 */
  queryHistory: string[]
  apps: NativeAppItem[]
  /** 应用全量数（apps 为折叠切片），超过折叠容量才显示展开/收起格 */
  appsTotal: number
  appsExpanded: boolean
  pinnedIds: string[]
  activeIndex: number
  /** true = uTools 图标网格布局；false = 应用枚举为空/失败时的旧 4 列插件网格兜底 */
  appsMode: boolean
  appsLoading: boolean
  appError: string | null
  opError: { id: string; name: string; error: string } | null
  demo: boolean
}>()
const emit = defineEmits<{
  select: [index: number]
  hover: [index: number]
  appOpen: [id: string]
  appPin: [id: string]
  toggleApps: []
  refreshApps: []
  retryOpen: []
  resize: [height: number]
  historySelect: [query: string]
  historyRemove: [query: string]
  historyClear: []
}>()

const rootEl = ref<HTMLElement | null>(null)
const pinnedSet = computed(() => new Set(props.pinnedIds))
/** 剪贴板推荐行占用的扁平序前缀长度（后续行/格 data-idx 整体 +K） */
const clipCount = computed(() => props.clipboardRecs.length)
/** 历史 chips 段长度（其后所有行/格 data-idx 再整体 +H，与 App.vue emptyTargets 同序） */
const histCount = computed(() => props.queryHistory.length)
/** 应用总数超过折叠容量才有抽屉开关格（展开态显示「收起」） */
const hasAppsToggle = computed(() => props.appsTotal > APPS_FOLD_COUNT)

// 键盘选中项跟随滚动（两分支共用 data-idx，与 App.vue 的扁平序一致）
watch(
  () => props.activeIndex,
  (i) => {
    void nextTick(() => rootEl.value?.querySelector(`[data-idx="${i}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
)

// 实测自然高度上报：容器被拉伸铺满视口，scrollHeight 测不出比视口矮的内容，
// 改取最后一个子元素底边（视口坐标，已含顶栏）+ 根下内边距 + 视口底距（底栏）折算整窗高度
function emitNaturalHeight(): void {
  const root = rootEl.value
  const last = root?.lastElementChild
  if (!root || !last) return
  root.scrollTop = 0 // 滚动后子元素 rect 上移会少算高度，结构变化时回顶重测
  const b = last.getBoundingClientRect()
  const r = root.getBoundingClientRect()
  const padB = parseFloat(getComputedStyle(root).paddingBottom) || 0
  const h = Math.ceil(b.bottom + padB + (window.innerHeight - r.bottom))
  if (h === lastEmittedH) return // RO 会被自身报高引发的视口变化再次触发，去重防环
  lastEmittedH = h
  emit('resize', h)
}
let lastEmittedH = -1

// 仅抽屉展开且超过视口时启用溢出态（底 padding 36px + 渐隐 mask），折叠态恒不溢出贴底收尾
const overflowing = ref(false)
function syncOverflow(): void {
  const root = rootEl.value
  overflowing.value = !!root && props.appsExpanded && root.scrollHeight > root.clientHeight + 1
}
async function remeasure(): Promise<void> {
  await nextTick()
  syncOverflow()
  await nextTick() // overflowing 切换会改底 padding，等样式生效后再量高
  emitNaturalHeight()
}
// 图标 img 分帧解码长高不改 props，watch 追不到，RO 兜底重测防报高偏矮裁内容
let sizeRo: ResizeObserver | null = null
onMounted(() => {
  void remeasure()
  const root = rootEl.value
  if (!root || typeof ResizeObserver !== 'function') return
  sizeRo = new ResizeObserver(() => {
    const panel = root.querySelector('.panel')
    if (panel) sizeRo?.observe(panel)
    syncOverflow()
    emitNaturalHeight()
  })
  sizeRo.observe(root)
})
onBeforeUnmount(() => {
  sizeRo?.disconnect()
  sizeRo = null
})
watch(
  () => [props.apps, props.appsExpanded, props.appsMode, props.appsLoading, props.recentTiles, props.plugins, props.recents, props.clipboardRecs, props.queryHistory],
  () => void remeasure()
)

function isImg(icon: string | undefined): boolean {
  return typeof icon === 'string' && icon.startsWith('data:image')
}
function letterOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}
</script>

<template>
  <div ref="rootEl" class="empty-state" :class="{ 'is-overflowing': overflowing }">
    <div v-if="appError" class="op-error">
      <span class="op-error-text">应用列表加载失败：{{ appError }}</span>
      <button class="op-retry" @click="emit('refreshApps')">重试</button>
    </div>
    <div v-else-if="opError" class="op-error">
      <span class="op-error-text">{{ opError.error }}</span>
      <button v-if="opError.id !== ''" class="op-retry" @click="emit('retryOpen')">重试</button>
      <button v-else class="op-retry" @click="emit('refreshApps')">知道了</button>
    </div>

    <div v-if="appsMode" class="panel">
      <!-- 剪贴板推荐行：扁平序最前 K 位，唤起后首格高亮、Enter 直接激活 -->
      <section v-if="clipboardRecs.length > 0" class="section">
        <div class="sec-title">
          <span>剪贴板推荐</span>
        </div>
        <div class="app-grid">
          <div
            v-for="(r, j) in clipboardRecs"
            :key="r.key"
            class="app-cell"
            :class="{ active: j === activeIndex }"
            :data-idx="j"
            :title="r.label"
            role="button"
            tabindex="-1"
            @mouseenter="emit('hover', j)"
            @click="emit('select', j)"
          >
            <span v-if="r.icon" class="tile emoji">{{ r.icon }}</span>
            <span v-else class="tile" :class="tileColorClass(r.key)">{{ letterOf(r.title) }}</span>
            <span class="app-name">{{ r.title }}</span>
          </div>
        </div>
      </section>

      <!-- 搜索历史 chips：剪贴板行之后第二段，扁平序 [clipCount, clipCount+H)，与 App.vue emptyTargets 同序 -->
      <section v-if="queryHistory.length > 0" class="section">
        <div class="sec-title">
          <span>搜索历史</span>
          <button class="title-btn history-clear" title="清空搜索历史" @click="emit('historyClear')">清空</button>
        </div>
        <div class="history-row">
          <span
            v-for="(q, i) in queryHistory"
            :key="q"
            class="history-chip"
            :class="{ active: clipCount + i === activeIndex }"
            :data-idx="clipCount + i"
            role="button"
            tabindex="-1"
            @mouseenter="emit('hover', clipCount + i)"
            @click="emit('historySelect', q)"
          >
            <span class="chip-text">{{ q }}</span>
            <span class="chip-x" title="删除该条" @click.stop="emit('historyRemove', q)" @mousedown.prevent>×</span>
          </span>
        </div>
      </section>

      <section v-if="recentTiles.length > 0" class="section">
        <div class="sec-title">
          <span>最近打开</span>
          <span v-if="demo" class="demo-badge">示例</span>
        </div>
        <div class="app-grid">
          <div
            v-for="(t, i) in recentTiles"
            :key="t.key"
            class="app-cell"
            :class="{ active: clipCount + histCount + i === activeIndex }"
            :data-idx="clipCount + histCount + i"
            :title="t.title"
            role="button"
            tabindex="-1"
            @mouseenter="emit('hover', clipCount + histCount + i)"
            @click="emit('select', clipCount + histCount + i)"
          >
            <span v-if="isImg(t.icon)" class="tile"><img :src="t.icon" alt="" /></span>
            <span v-else-if="t.icon" class="tile emoji">{{ t.icon }}</span>
            <span v-else class="tile" :class="tileColorClass(t.appId ?? t.key)">{{ letterOf(t.title) }}</span>
            <span class="app-name">{{ t.title }}</span>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="sec-title">
          <span>应用</span>
          <span v-if="demo" class="demo-badge">示例数据</span>
          <button v-else class="title-btn" title="重新扫描本机应用" @click="emit('refreshApps')">
            <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path
                fill="currentColor"
                d="M17.65 6.35A7.95 7.95 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"
              />
            </svg>
          </button>
        </div>
        <div v-if="appsLoading" class="app-hint">
          <span class="spin" aria-hidden="true"></span>
          <span>正在扫描本机应用…</span>
        </div>
        <div v-else class="app-grid">
          <div
            v-for="(a, i) in apps"
            :key="a.id"
            class="app-cell"
            :class="{ active: clipCount + histCount + recentTiles.length + i === activeIndex }"
            :data-idx="clipCount + histCount + recentTiles.length + i"
            role="button"
            tabindex="-1"
            @mouseenter="emit('hover', clipCount + histCount + recentTiles.length + i)"
            @click="emit('select', clipCount + histCount + recentTiles.length + i)"
          >
            <span v-if="pinnedSet.has(a.id)" class="pin-badge" title="已置顶">
              <svg viewBox="0 0 24 24" width="8" height="8" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"
                />
              </svg>
            </span>
            <span v-if="isImg(a.icon)" class="tile"><img :src="a.icon" alt="" /></span>
            <span v-else class="tile" :class="tileColorClass(a.id)">{{ letterOf(a.name) }}</span>
            <span class="app-name">{{ a.name }}</span>
            <span class="cell-actions" @click.stop @mousedown.stop>
              <button :title="pinnedSet.has(a.id) ? '取消置顶' : '置顶'" @click="emit('appPin', a.id)">
                <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"
                  />
                </svg>
              </button>
            </span>
          </div>
          <!-- 抽屉开关格：折叠态在第二行末「展开」，展开态在全部应用后「收起」 -->
          <div
            v-if="hasAppsToggle"
            class="app-cell apps-toggle"
            :class="{ active: clipCount + histCount + recentTiles.length + apps.length === activeIndex }"
            :data-idx="clipCount + histCount + recentTiles.length + apps.length"
            role="button"
            tabindex="-1"
            :title="appsExpanded ? '收起应用列表' : '展开全部应用'"
            @mouseenter="emit('hover', clipCount + histCount + recentTiles.length + apps.length)"
            @click="emit('toggleApps')"
          >
            <span class="tile toggle-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  :d="appsExpanded ? 'M18 15l-6-6-6 6' : 'M6 9l6 6 6-6'"
                />
              </svg>
            </span>
            <span class="app-name">{{ appsExpanded ? '收起' : '展开' }}</span>
          </div>
        </div>
      </section>
    </div>

    <!-- 兜底：应用枚举为空（win32/扫描失败）回退旧 4 列插件网格（ui-style-guide §1.5） -->
    <div v-else class="panel">
      <div v-if="clipboardRecs.length > 0" class="clip-recs">
        <div class="sec-title"><span>剪贴板推荐</span></div>
        <div class="app-grid">
          <div
            v-for="(r, j) in clipboardRecs"
            :key="r.key"
            class="app-cell"
            :class="{ active: j === activeIndex }"
            :data-idx="j"
            :title="r.label"
            role="button"
            tabindex="-1"
            @mouseenter="emit('hover', j)"
            @click="emit('select', j)"
          >
            <span v-if="r.icon" class="tile emoji">{{ r.icon }}</span>
            <span v-else class="tile" :class="tileColorClass(r.key)">{{ letterOf(r.title) }}</span>
            <span class="app-name">{{ r.title }}</span>
          </div>
        </div>
      </div>
      <!-- 搜索历史 chips：与 appsMode 分支同款，同在剪贴板行之后 -->
      <div v-if="queryHistory.length > 0" class="section history-fallback">
        <div class="sec-title">
          <span>搜索历史</span>
          <button class="title-btn history-clear" title="清空搜索历史" @click="emit('historyClear')">清空</button>
        </div>
        <div class="history-row">
          <span
            v-for="(q, i) in queryHistory"
            :key="q"
            class="history-chip"
            :class="{ active: clipCount + i === activeIndex }"
            :data-idx="clipCount + i"
            role="button"
            tabindex="-1"
            @mouseenter="emit('hover', clipCount + i)"
            @click="emit('historySelect', q)"
          >
            <span class="chip-text">{{ q }}</span>
            <span class="chip-x" title="删除该条" @click.stop="emit('historyRemove', q)" @mousedown.prevent>×</span>
          </span>
        </div>
      </div>
      <div class="grid">
        <button
          v-for="(m, i) in plugins"
          :key="m.id"
          class="cell"
          :class="{ active: clipCount + histCount + i === activeIndex }"
          :data-idx="clipCount + histCount + i"
          :title="m.description"
          @mouseenter="emit('hover', clipCount + histCount + i)"
          @click="emit('select', clipCount + histCount + i)"
        >
          <span class="tile emoji">{{ m.icon }}</span>
          <span class="name">{{ m.name }}</span>
        </button>
      </div>
    </div>
    <div v-if="!appsMode && recents.length > 0" class="recent">
      <div class="recent-title">最近使用</div>
      <button
        v-for="(r, j) in recents"
        :key="r.key"
        class="row"
        :class="{ active: clipCount + histCount + plugins.length + j === activeIndex }"
        :data-idx="clipCount + histCount + plugins.length + j"
        @mouseenter="emit('hover', clipCount + histCount + plugins.length + j)"
        @click="emit('select', clipCount + histCount + plugins.length + j)"
      >
        <span class="row-icon">{{ r.icon }}</span>
        <span class="row-title">{{ r.title }}</span>
        <span class="row-sub">{{ r.subtitle }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  height: 100%;
  overflow-y: auto;
  /* 内容层实色面板（与导航玻璃分层）；顶部 68px 让位悬浮玻璃胶囊（64px 栏 + 4px 呼吸） */
  padding: 68px 16px 14px;
  scroll-padding-top: 68px; /* 键盘导航 scrollIntoView 不把项送进胶囊底下 */
  background: var(--bg-content);
  /* 顶部溶解：内容滚入玻璃下方渐隐（#000 为 alpha 蒙版形状色，非 UI 颜色） */
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 64px);
  mask-image: linear-gradient(to bottom, transparent 0, #000 64px);
}
/* 抽屉展开且溢出滚动时启用 36px 底留白 + 底缘渐隐（对齐 base.css 原语义） */
.empty-state.is-overflowing {
  padding-bottom: 36px;
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 64px, #000 calc(100% - 32px), transparent);
  mask-image: linear-gradient(to bottom, transparent 0, #000 64px, #000 calc(100% - 32px), transparent);
}
.panel {
  padding: 0;
}
.section {
  padding: 0 var(--sp-1);
}
.section + .section {
  margin-top: var(--sp-3);
}
.sec-title {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.demo-badge {
  padding: 1px 6px;
  border-radius: var(--r-sm);
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 10px;
  line-height: 1.4;
}
.title-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  margin-left: auto;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}
.title-btn:hover {
  color: var(--fg);
  background: var(--hover);
}

/* 通用图标块：无底色容器（白衬底会在每个真图标外露一圈白边）；字母块取 --tile-* 六色 */
.tile {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-md);
  overflow: hidden;
}
.tile.emoji {
  font-size: 26px;
  line-height: 1;
}
.tile img {
  width: 36px;
  height: 36px;
  object-fit: contain;
}
/* 字母磁贴扁平：只靠 --tile-* 半透明填充区隔，无投影 */
.tile.t-blue {
  background: var(--tile-blue-bg);
  color: var(--tile-blue-fg);
}
.tile.t-green {
  background: var(--tile-green-bg);
  color: var(--tile-green-fg);
}
.tile.t-amber {
  background: var(--tile-amber-bg);
  color: var(--tile-amber-fg);
}
.tile.t-rose {
  background: var(--tile-rose-bg);
  color: var(--tile-rose-fg);
}
.tile.t-violet {
  background: var(--tile-violet-bg);
  color: var(--tile-violet-fg);
}
.tile.t-teal {
  background: var(--tile-teal-bg);
  color: var(--tile-teal-fg);
}

/* 统一 9 列图标网格（最近打开、应用栏与搜索结果共享） */
.app-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: var(--sp-2) var(--sp-1);
}
.app-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: var(--sp-1) 2px var(--sp-2);
  border-radius: var(--r-md);
  cursor: pointer;
  user-select: none;
}
.app-cell:hover {
  background: var(--hover);
}
.app-cell.active {
  background: var(--active-row);
}
/* 抽屉开关格：弱化待命，hover/选中提亮 */
.apps-toggle .toggle-icon {
  color: var(--fg-dim);
}
.apps-toggle:hover .toggle-icon,
.apps-toggle.active .toggle-icon {
  color: var(--fg);
}
.app-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-size: var(--fs-foot);
  text-align: center;
  line-height: 1.3;
}
.pin-badge {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--accent);
  color: var(--on-accent);
}
.cell-actions {
  position: absolute;
  top: 2px;
  right: 2px;
  display: none;
  gap: 2px;
  padding: 2px;
  border-radius: var(--r-sm);
  /* 弹层实底厚背板 + 1px hairline 勾边，无投影 */
  background: var(--bg-content);
  border: 1px solid var(--border);
}
.app-cell:hover .cell-actions,
.app-cell.active .cell-actions {
  display: flex;
}
.cell-actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: calc(var(--r-sm) - 2px); /* 同轴圆角：外半径 − 弹层内边距 2px */
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}
.cell-actions button:hover {
  color: var(--fg);
  background: var(--hover);
}
.app-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: var(--sp-5) 0;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.spin {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: tile-spin 0.8s linear infinite;
}
@keyframes tile-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 兜底分支的剪贴板推荐行与插件网格间距 */
.clip-recs {
  margin-bottom: var(--sp-3);
}
.history-fallback {
  margin-bottom: var(--sp-3);
}

/* 搜索历史 chips（两分支共用）：弱色词块，选中/悬停换 accent-dim 底（本功能色值只用这三变量） */
.history-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.history-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-1);
  max-width: 100%;
  padding: 2px 4px 2px 10px;
  border-radius: var(--r-md);
  background: var(--hover);
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  line-height: 1.6;
  cursor: pointer;
  user-select: none;
}
.history-chip:hover,
.history-chip.active {
  background: var(--accent-dim);
}
.chip-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip-x {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  font-size: 12px;
  line-height: 1;
}
.chip-x:hover {
  background: var(--hover);
}
/* 行尾「清空」：复用 title-btn 弱化态，放宽为文字按钮 */
.history-clear {
  width: auto;
  padding: 0 var(--sp-1);
  font-size: var(--fs-foot);
}

/* 行内错误条：加载/打开/置顶失败可重试 */
.op-error {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-2);
  padding: 6px var(--sp-3);
  border-radius: var(--r-md);
  background: var(--bg-raised);
  font-size: var(--fs-sub);
}
.op-error-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--danger);
}
.op-retry {
  flex: none;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.op-retry:hover {
  text-decoration: underline;
}

/* ---- 兜底旧形态（4 列插件网格 + 最近使用列表），保持原样不回归 ---- */
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--sp-2);
}
.cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  height: 88px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  cursor: pointer;
}
.cell:hover,
.cell.active {
  background: var(--hover);
}
.cell .tile {
  width: 36px;
  height: 36px;
  background: var(--bg);
  font-size: 20px;
}
.name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-size: var(--fs-sub);
}
.recent {
  margin-top: var(--sp-3);
}
.recent-title {
  padding: 0 16px var(--sp-2);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 46px;
  padding: 0 16px;
  margin-bottom: 2px;
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  cursor: pointer;
  user-select: none;
}
.row:hover {
  background: var(--hover);
}
.row.active {
  background: var(--active-row);
}
.row-icon {
  flex: none;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  font-size: 16px;
  line-height: 1;
}
.row-title {
  flex: none;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-size: var(--fs-title);
  text-align: left;
}
.row-sub {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  text-align: right;
}
</style>
