<script lang="ts">
// 与主进程 clipboard-history 服务导出同构（文本只发 preview、图片带 dataUrl 缩略图本体），跨层不 import 主进程模块
export type ClipHistoryItem =
  | { id: string; kind?: 'text'; preview: string; ts: number }
  | { id: string; kind: 'image'; preview: string; dataUrl: string; width: number; height: number; ts: number }
</script>

<script setup lang="ts">
// 剪贴板记录面板（Win+V 式飞窗内）：纯展示组件，host 调用与订阅全在 ClipboardFlyoutHost；
// 卡片外观（定位/边框/圆角/背景/阴影）由飞窗卡片根承担，本组件只做文档流满幅内容
defineProps<{
  items: ClipHistoryItem[]
}>()

const emit = defineEmits<{
  copy: [id: string]
  remove: [id: string]
  clear: []
}>()
</script>

<template>
  <div class="clip-panel" aria-label="剪贴板记录">
    <div v-if="items.length === 0" class="clip-empty">暂无剪贴板记录</div>
    <template v-else>
      <ul class="clip-list">
        <li
          v-for="item in items"
          :key="item.id"
          class="clip-row"
          :class="{ image: item.kind === 'image' }"
          :title="item.kind === 'image' ? `图片 ${item.width}×${item.height}` : item.preview"
          role="button"
          tabindex="-1"
          @click="emit('copy', item.id)"
        >
          <img
            v-if="item.kind === 'image'"
            class="clip-thumb"
            :src="item.dataUrl"
            alt=""
            draggable="false"
          />
          <span v-else class="clip-text">{{ item.preview }}</span>
          <span v-if="item.kind === 'image'" class="clip-dims">{{ item.width }}×{{ item.height }}</span>
          <button class="clip-del" title="删除此条" tabindex="-1" @click.stop="emit('remove', item.id)">
            <svg viewBox="0 0 24 24" width="10" height="10" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
              />
            </svg>
          </button>
        </li>
      </ul>
      <div class="clip-foot">
        <span>{{ items.length }} 条</span>
        <button class="clip-clear" tabindex="-1" @click="emit('clear')">清空</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 文档流满幅：外窗尺寸即卡片尺寸（主进程锚定），内部列表自滚动 */
.clip-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.clip-empty {
  padding: var(--sp-4);
  font-size: var(--fs-sub);
  color: var(--fg-dim);
  text-align: center;
}
.clip-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  list-style: none;
  padding: var(--sp-1);
}
.clip-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 30px;
  padding: 0 var(--sp-1) 0 var(--sp-2);
  border-radius: var(--r-md);
  cursor: pointer;
}
/* 图片条目行更高放缩略图；缩略图保持宽高比、白底衬托透明 PNG */
.clip-row.image {
  height: 52px;
}
.clip-thumb {
  flex: none;
  max-width: 88px;
  height: 44px;
  object-fit: contain;
  border-radius: var(--r-sm);
  background: var(--bg-raised);
}
.clip-dims {
  flex: none;
  font-size: var(--fs-foot);
  color: var(--fg-dim);
}
.clip-row:hover {
  background: var(--hover);
}
.clip-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sub);
  color: var(--fg);
}
.clip-del {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
  opacity: 0;
}
.clip-row:hover .clip-del,
.clip-del:focus-visible {
  opacity: 1;
}
.clip-del:hover {
  color: var(--danger);
  background: var(--hover);
}
.clip-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-1) var(--sp-2);
  border-top: 1px solid var(--border);
  font-size: var(--fs-foot);
  color: var(--fg-dim);
}
.clip-clear {
  padding: 2px var(--sp-2);
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  cursor: pointer;
}
.clip-clear:hover {
  color: var(--fg);
  background: var(--hover);
}
</style>
