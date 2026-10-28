<script setup lang="ts">
import { computed } from 'vue'

// 背景双预览（搜索/设置视图骨架）：纯展示无交互；纱罩浓度换算与 .app 同式（dim/100×0.85），
// 经局部 --wp-dim 覆写让纱罩公式与真实视图共用同一 token 链（fallback 防独立预览环境空值）
const props = defineProps<{
  image: string | null
  dim: number
  variant: 'search' | 'settings'
}>()

const previewDim = computed(() => {
  const pct = typeof props.dim === 'number' && Number.isFinite(props.dim) ? Math.min(Math.max(props.dim, 0), 100) : 40
  return ((pct / 100) * 0.85).toFixed(2)
})
</script>

<template>
  <div class="bg-preview" :class="{ empty: !image }" :style="{ '--wp-dim': previewDim }">
    <template v-if="image">
      <div class="bg-layer bg-photo" :style="{ backgroundImage: `url(${image})` }"></div>
      <div class="bg-layer bg-veil"></div>
    </template>
    <!-- 双骨架与真实视图同构：搜索=胶囊+结果行；设置=标题+配置行 -->
    <div v-if="variant === 'search'" class="sk-search" aria-hidden="true">
      <span class="sk-pill"></span>
      <span v-for="i in 3" :key="i" class="sk-row" :style="{ width: `${88 - i * 14}%` }"></span>
    </div>
    <div v-else class="sk-settings" aria-hidden="true">
      <span class="sk-title"></span>
      <span v-for="i in 3" :key="i" class="sk-line" :style="{ width: `${92 - i * 10}%` }"></span>
    </div>
    <span v-if="!image" class="bg-empty-hint">未选图</span>
  </div>
</template>

<style scoped>
.bg-preview {
  position: relative;
  height: 110px;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg-shell);
}
.bg-preview.empty {
  border-style: dashed;
}
.bg-layer {
  position: absolute;
  inset: 0;
}
.bg-photo {
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}
/* 纱罩公式与 .app background 栈同源：--wp-veil 分主题、--wp-dim 由 props 换算局部覆写 */
.bg-veil {
  background: linear-gradient(
    rgb(var(--wp-veil, 255 255 255) / var(--wp-dim, 0)),
    rgb(var(--wp-veil, 255 255 255) / var(--wp-dim, 0))
  );
}
.sk-search,
.sk-settings {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  height: 100%;
  padding: var(--sp-3);
}
.sk-search {
  justify-content: flex-start;
}
.sk-pill {
  height: 26px;
  margin-bottom: var(--sp-1);
  border-radius: var(--r-pill);
  background: var(--glass-bg);
  border: 1px solid var(--border);
}
.sk-row,
.sk-line,
.sk-title {
  height: 12px;
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  border: 1px solid var(--border);
}
.sk-title {
  height: 14px;
  width: 34%;
  background: var(--fill-well);
}
.bg-empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
</style>
