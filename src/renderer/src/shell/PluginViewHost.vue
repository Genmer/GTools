<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onErrorCaptured, ref, watch } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import { getPluginEntryLoader, loadWithRetry } from '../core/registry'
import { createHostClient } from '../core/host-client'
import { restOf, router } from './router'

const props = defineProps<{ manifests: PluginManifest[] }>()
const emit = defineEmits<{ exit: [] }>()

const errored = ref<string | null>(null)
const retryKey = ref(0)
const bodyRef = ref<HTMLDivElement | null>(null)

const manifest = computed(() => props.manifests.find((m) => m.id === router.activePluginId) ?? null)
const rest = computed(() => restOf(router.query, props.manifests))
// 依赖 retryKey：重试时强制重建异步组件；loader 经指数退避重试后再交错误降级
const comp = computed(() => {
  void retryKey.value
  if (!manifest.value) return null
  const loader = getPluginEntryLoader(manifest.value.id)
  return loader ? defineAsyncComponent(() => loadWithRetry(loader)) : null
})
const ctx = computed(() =>
  manifest.value ? { manifest: manifest.value, host: createHostClient(manifest.value.id) } : null
)

// B2 错误隔离：插件组件异常就地降级，外壳与其他插件不受影响
onErrorCaptured((err) => {
  errored.value = err instanceof Error ? err.message : String(err)
  return false
})

function focusContent(): void {
  // 焦点交还插件内容，优先其首个输入控件
  void nextTick(() => {
    const el = bodyRef.value?.querySelector<HTMLElement>('input, textarea, select')
    if (el) el.focus()
    else bodyRef.value?.focus()
  })
}

function retryLoad(): void {
  errored.value = null
  retryKey.value++
}

watch(
  () => router.activePluginId,
  () => {
    errored.value = null
    focusContent()
  },
  { immediate: true }
)
defineExpose({ focusContent })
</script>

<template>
  <div class="plugin-page">
    <div ref="bodyRef" class="plugin-body" tabindex="-1">
      <div v-if="errored !== null" class="plugin-error">
        <p class="msg">该插件出错：{{ errored }}</p>
        <p class="dim">可到设置中禁用该插件后反馈</p>
        <div class="error-actions">
          <button class="retry-btn" @click="retryLoad">重试加载</button>
          <button class="back-btn" @click="emit('exit')">返回搜索 (Esc)</button>
        </div>
      </div>
      <component
        v-else-if="comp && ctx && manifest"
        :is="comp"
        :key="`${manifest.id}:${retryKey}`"
        :ctx="ctx"
        :query="rest"
        :initial-command="router.initialCommand"
      />
      <div v-else class="plugin-error"><p>插件视图未找到</p></div>
    </div>
  </div>
</template>

<style scoped>
.plugin-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.plugin-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--sp-4);
  background: var(--bg);
  outline: none;
}
/* §1.7 细滚动条：槽 9px，拇指视觉 6px 且右缘留 3px 间隙不贴死窗边 */
.plugin-body::-webkit-scrollbar {
  width: 9px;
}
.plugin-body::-webkit-scrollbar-track {
  background: transparent;
}
.plugin-body::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 5px;
  border-width: 0 3px 0 0;
  border-style: solid;
  border-color: transparent;
  background-clip: padding-box;
}
.plugin-body::-webkit-scrollbar-thumb:hover {
  background-color: var(--scrollbar-thumb-hover);
}
.plugin-error {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
}
.msg {
  color: var(--danger);
  font-size: var(--fs-title);
}
.dim {
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.error-actions {
  margin-top: var(--sp-2);
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.retry-btn {
  padding: var(--sp-1) var(--sp-4);
  border: none;
  border-radius: var(--r-md);
  background: var(--accent-dim);
  color: var(--accent);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.retry-btn:hover {
  background: var(--accent);
  color: var(--on-accent);
}
.back-btn {
  padding: var(--sp-1) var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.back-btn:hover {
  color: var(--fg);
  background: var(--hover);
}
</style>
