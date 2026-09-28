<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { SearchEntry } from '../core/matcher'
import { highlightSegments } from '../core/highlight'
import type { RecItem } from '../core/recommend'
import { tileColorClass } from './app-grid'

const props = defineProps<{
  items: { entry: SearchEntry; score: number }[]
  recommendations: RecItem[]
  activeIndex: number
  query: string
}>()

const emit = defineEmits<{
  select: [index: number]
  hover: [index: number]
  resize: [height: number]
}>()

const rootEl = ref<HTMLElement | null>(null)
// 详情条跨两区取选中项：items.length 内为主结果，其后为推荐项（推荐格扁平续编）
const activeInfo = computed<{ title: string; subtitle?: string } | null>(() => {
  const main = props.items[props.activeIndex]
  if (main) return { title: main.entry.title, subtitle: main.entry.subtitle }
  const rec = props.recommendations[props.activeIndex - props.items.length]
  return rec ? { title: rec.title, subtitle: rec.subtitle } : null
})

function isImg(icon: string | undefined): boolean {
  return typeof icon === 'string' && icon.startsWith('data:image')
}
function letterOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

// 键盘选中项跟随滚动（九宫格按单元格最近边对齐）
watch(
  () => props.activeIndex,
  (i) => {
    void nextTick(() => rootEl.value?.querySelector(`[data-idx="${i}"]`)?.scrollIntoView({ block: 'nearest' }))
  }
)

// 实测自然高度上报：紧贴搜索结果网格行数，对齐 uTools
function emitNaturalHeight(): void {
  const root = rootEl.value
  const last = root?.lastElementChild
  if (!root || !last) return
  root.scrollTop = 0
  const b = last.getBoundingClientRect()
  const r = root.getBoundingClientRect()
  const padB = parseFloat(getComputedStyle(root).paddingBottom) || 0
  emit('resize', Math.ceil(b.bottom + padB + (window.innerHeight - r.bottom)))
}

onMounted(() => void nextTick(emitNaturalHeight))
watch(
  () => [props.items.length, props.recommendations.length, props.query],
  () => void nextTick(emitNaturalHeight)
)
</script>

<template>
  <div ref="rootEl" class="result-view">
    <div v-if="items.length > 0" class="section">
      <div class="sec-title">
        <span>搜索结果</span>
        <span class="count-badge">{{ items.length }}</span>
      </div>

      <!-- 9 列图标网格（对齐空态与 uTools 统一设计语言，替代旧垂直单行列表） -->
      <div class="result-grid">
        <div
          v-for="(item, i) in items"
          :key="item.entry.key"
          class="result-cell"
          :class="{ active: i === activeIndex }"
          :data-idx="i"
          :title="item.entry.subtitle ? `${item.entry.title} · ${item.entry.subtitle}` : item.entry.title"
          role="button"
          tabindex="-1"
          @mouseenter="emit('hover', i)"
          @click="emit('select', i)"
        >
          <span v-if="isImg(item.entry.icon)" class="tile"><img :src="item.entry.icon" alt="" /></span>
          <span
            v-else-if="item.entry.kind === 'app'"
            class="tile"
            :class="tileColorClass(item.entry.appId ?? item.entry.key)"
          >
            {{ letterOf(item.entry.title) }}
          </span>
          <span v-else-if="item.entry.icon" class="tile emoji">{{ item.entry.icon }}</span>
          <span v-else class="tile" :class="tileColorClass(item.entry.key)">{{ letterOf(item.entry.title) }}</span>
          <span class="cell-name">
            <template v-for="(seg, si) in highlightSegments(item.entry.title, query)" :key="si">
              <b v-if="seg.hit" class="hl">{{ seg.text }}</b>
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
        </div>
      </div>
    </div>

    <!-- 推荐区：独立条件渲染，0 主结果时不再被 v-else 吞掉（盘符路径等「仅推荐」场景） -->
    <div v-if="recommendations.length > 0" class="section rec-section">
      <div class="sec-title">
        <span>推荐</span>
        <span class="count-badge">{{ recommendations.length }}</span>
      </div>
      <div class="result-grid">
        <div
          v-for="(r, j) in recommendations"
          :key="r.key"
          class="result-cell"
          :class="{ active: items.length + j === activeIndex }"
          :data-idx="items.length + j"
          :title="`${r.label} · ${r.title}`"
          role="button"
          tabindex="-1"
          @mouseenter="emit('hover', items.length + j)"
          @click="emit('select', items.length + j)"
        >
          <span v-if="r.icon" class="tile rec-tile emoji">{{ r.icon }}</span>
          <span v-else class="tile rec-tile" :class="tileColorClass(r.key)">{{ letterOf(r.title) }}</span>
          <span class="cell-name">
            <template v-for="(seg, si) in highlightSegments(r.label, query)" :key="si">
              <b v-if="seg.hit" class="hl">{{ seg.text }}</b>
              <template v-else>{{ seg.text }}</template>
            </template>
          </span>
        </div>
      </div>
    </div>

    <!-- 无结果态：主结果与推荐均空才显示 -->
    <div v-if="items.length === 0 && recommendations.length === 0" class="empty">
      <svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.5" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <p class="empty-title">没有找到「{{ query }}」相关结果</p>
      <p class="empty-hint">试试应用或插件名称、拼音首字母（如 wx、jsq）</p>
    </div>

    <!-- 详情条移到视图底部并跨两区取值，使「仅推荐」态同样可见 -->
    <div v-if="activeInfo" class="active-detail">
      <span class="detail-title">{{ activeInfo.title }}</span>
      <span v-if="activeInfo.subtitle" class="detail-sep">·</span>
      <span v-if="activeInfo.subtitle" class="detail-sub">{{ activeInfo.subtitle }}</span>
    </div>
  </div>
</template>

<style scoped>
.result-view {
  height: 100%;
  overflow-y: auto;
  /* 内容层实色面板；顶部 68px 让位悬浮玻璃胶囊（64px 栏 + 4px 呼吸） */
  padding: 68px 16px 14px;
  scroll-padding-top: 68px;
  background: var(--bg-content);
  /* 顶部溶解：结果滚入玻璃下方渐隐（#000 为 alpha 蒙版形状色，非 UI 颜色） */
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 64px);
  mask-image: linear-gradient(to bottom, transparent 0, #000 64px);
}
.section {
  padding: 0 var(--sp-1);
}
.rec-section {
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
.count-badge {
  padding: 1px 6px;
  border-radius: var(--r-sm);
  background: var(--hover);
  color: var(--fg-dim);
  font-size: 10px;
  line-height: 1.4;
}
.result-grid {
  display: grid;
  grid-template-columns: repeat(9, 1fr);
  gap: var(--sp-2) var(--sp-1);
}
.result-cell {
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
.result-cell:hover {
  background: var(--hover);
}
.result-cell.active {
  background: var(--active-row);
}
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
  font-size: 20px;
  line-height: 1;
}
.tile img {
  width: 36px;
  height: 36px;
  object-fit: contain;
}
/* 推荐格：主格小号变体（图标更小），名称弱化为 dim（推荐区实际类名是 result-cell，按区选择器命中） */
.rec-tile {
  width: 30px;
  height: 30px;
}
.rec-tile.emoji {
  font-size: 15px;
}
.rec-section .cell-name {
  color: var(--fg-dim);
}
.tile.t-blue { background: var(--tile-blue-bg); color: var(--tile-blue-fg); }
.tile.t-green { background: var(--tile-green-bg); color: var(--tile-green-fg); }
.tile.t-amber { background: var(--tile-amber-bg); color: var(--tile-amber-fg); }
.tile.t-rose { background: var(--tile-rose-bg); color: var(--tile-rose-fg); }
.tile.t-violet { background: var(--tile-violet-bg); color: var(--tile-violet-fg); }
.tile.t-teal { background: var(--tile-teal-bg); color: var(--tile-teal-fg); }
.cell-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg);
  font-size: var(--fs-foot);
  text-align: center;
  line-height: 1.3;
}
.hl {
  color: var(--accent);
  font-weight: 600;
}
.active-detail {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: var(--sp-3);
  padding: 6px 12px;
  border-radius: var(--r-md);
  background: var(--hover);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-title {
  color: var(--fg);
  font-weight: 600;
}
.detail-sep {
  opacity: 0.5;
}
.detail-sub {
  color: var(--fg-dim);
  overflow: hidden;
  text-overflow: ellipsis;
}
.empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  padding: 32px 0;
  color: var(--fg-dim);
}
.empty-title {
  color: var(--fg);
  font-size: var(--fs-title);
}
.empty-hint {
  font-size: var(--fs-sub);
}
</style>
