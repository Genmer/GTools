<script setup lang="ts">
import { computed } from 'vue'
import type { PluginContext } from '@sdk/api'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const greeting = computed(() => (props.query.trim() === '' ? '输入任意内容试试' : `你好，${props.query.trim()}`))
</script>

<template>
  <div class="hello">
    <p class="icon">{{ ctx.manifest.icon }}</p>
    <p class="greet">{{ greeting }}</p>
    <p class="meta">{{ ctx.manifest.name }} v{{ ctx.manifest.version }} · keywords: {{ ctx.manifest.keywords.join(' / ') }}</p>
  </div>
</template>

<style scoped>
.hello {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.icon {
  font-size: 40px;
}
.greet {
  font-size: 18px;
  color: var(--fg);
}
.meta {
  font-size: 12px;
  color: var(--fg-dim);
}
</style>
