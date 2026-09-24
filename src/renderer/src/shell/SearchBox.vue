<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import { restOf, router } from './router'

const props = defineProps<{ manifests: PluginManifest[] }>()
const emit = defineEmits<{
  nav: [dir: 1 | -1, axis: 'x' | 'y']
  select: []
  exit: []
  settings: []
  detach: []
}>()

const inputRef = ref<HTMLInputElement | null>(null)
defineExpose({ focus: () => inputRef.value?.focus() })

const activeManifest = computed(() => props.manifests.find((m) => m.id === router.activePluginId) ?? null)
// 插件态输入框只承载参数（keyword 由胶囊表达），全局/设置态仍绑定完整 query
const pluginRest = computed(() => restOf(router.query, props.manifests))

function clearInput(): void {
  router.query = ''
  inputRef.value?.focus()
}

function onPluginInput(v: string): void {
  const m = activeManifest.value
  if (!m) return
  // 沿用当前命中的 keyword 重建 query；v 为空时保留尾部空格维持插件态
  const kw = m.keywords.find((k) => router.query === `${k} ` || router.query.startsWith(`${k} `)) ?? m.keywords[0]
  router.query = `${kw} ${v}`
}

function onKeydown(e: KeyboardEvent): void {
  // 输入法组合态的按键用于选词，不参与导航/选中
  if (e.isComposing) return
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('exit')
    return
  }
  if (router.mode === 'plugin') {
    // 参数区为空且光标在 0 时 Backspace 退出插件（对齐 uTools 逐级删除）
    const input = inputRef.value
    if (e.key === 'Backspace' && input?.value === '' && (input?.selectionStart ?? 0) === 0) {
      e.preventDefault()
      emit('exit')
    }
    return
  }
  // Tab 键在网格内水平切换，上下键跨行切换；空态下左右键亦可水平导航
  if (e.key === 'Tab') {
    e.preventDefault()
    emit('nav', e.shiftKey ? -1 : 1, 'x')
    return
  }
  const axis = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? 'y' : e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? 'x' : null
  if (axis && (axis === 'y' || router.query === '')) {
    e.preventDefault()
    emit('nav', e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1, axis)
    return
  }
  if (e.key === 'Enter' && router.mode === 'global') {
    e.preventDefault()
    emit('select')
  }
}
</script>

<template>
  <div class="searchbox" @mousedown.prevent="inputRef?.focus()">
    <template v-if="router.mode === 'plugin' && activeManifest">
      <div class="plugin-tag" :title="activeManifest.name">
        <span class="tag-icon">{{ activeManifest.icon }}</span>
        <span class="tag-name">{{ activeManifest.name }}</span>
        <button class="tag-close" title="退出插件 (Esc)" @mousedown.prevent @click="emit('exit')">
          <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
            <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
          </svg>
        </button>
      </div>
      <input
        ref="inputRef"
        :value="pluginRest"
        placeholder="输入参数…"
        @input="onPluginInput(($event.target as HTMLInputElement).value)"
        @keydown="onKeydown"
        spellcheck="false"
        autocomplete="off"
      />
      <button class="detach" title="独立窗口打开 (Cmd+D / Ctrl+D)" @mousedown.prevent @click="emit('detach')">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <polyline points="15 3 21 3 21 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <line x1="10" y1="14" x2="21" y2="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </button>
    </template>
    <template v-else>
      <svg class="magnifier" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2" />
        <line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      <input
        ref="inputRef"
        :value="router.query"
        :placeholder="router.mode === 'settings' ? '设置' : '搜索插件、工具，或输入插件关键字…'"
        @input="router.query = ($event.target as HTMLInputElement).value"
        @keydown="onKeydown"
        spellcheck="false"
        autocomplete="off"
      />
      <button v-if="router.query !== ''" class="clear" title="清空" @mousedown.prevent @click="clearInput">
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="currentColor" opacity="0.35" />
          <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
      <!-- 空态脚注栏已隐藏（对齐 uTools 贴底收尾），设置入口挪到搜索框右侧 -->
      <button
        v-else-if="router.mode === 'global'"
        class="gear"
        title="设置"
        @mousedown.prevent
        @click="emit('settings')"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            fill="currentColor"
            d="M19.14 12.94a7.07 7.07 0 0 0 .06-.94 7.07 7.07 0 0 0-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.59.22L2.73 8.87a.5.5 0 0 0 .12.61l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"
          />
        </svg>
      </button>
    </template>
  </div>
</template>

<style scoped>
.searchbox {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  height: 52px;
  border-radius: var(--r-lg);
  background: var(--bg-raised);
  -webkit-app-region: no-drag;
}
.magnifier {
  flex: none;
  color: var(--fg-dim);
}
input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  color: var(--fg);
  font-size: var(--fs-input);
  caret-color: var(--accent);
}
input::placeholder {
  color: var(--fg-dim);
}
.plugin-tag {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  max-width: 45%;
  height: 28px;
  padding: 0 var(--sp-1) 0 var(--sp-2);
  border-radius: var(--r-md);
  background: var(--accent-dim);
  color: var(--accent);
  user-select: none;
}
.tag-icon {
  flex: none;
  font-size: 14px;
  line-height: 1;
}
.tag-name {
  font-size: var(--fs-sub);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tag-close {
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
  color: var(--accent);
  cursor: pointer;
}
.tag-close:hover {
  color: var(--on-accent);
  background: var(--accent);
}
.clear {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}
.clear:hover {
  color: var(--fg);
  background: var(--hover);
}
.gear,
.detach {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}
.gear:hover,
.detach:hover {
  color: var(--fg);
  background: var(--hover);
}
</style>
