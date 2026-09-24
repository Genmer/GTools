<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import JsonTool from './views/JsonTool.vue'
import TimeTool from './views/TimeTool.vue'
import UuidTool from './views/UuidTool.vue'
import Base64Tool from './views/Base64Tool.vue'
import RegexTool from './views/RegexTool.vue'
import ColorTool from './views/ColorTool.vue'
import JwtTool from './views/JwtTool.vue'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const tools = [
  { id: 'json-format', label: 'JSON', comp: JsonTool },
  { id: 'timestamp', label: '时间戳', comp: TimeTool },
  { id: 'uuid', label: 'UUID', comp: UuidTool },
  { id: 'base64', label: 'Base64', comp: Base64Tool },
  { id: 'regex', label: '正则', comp: RegexTool },
  { id: 'color', label: '颜色', comp: ColorTool },
  { id: 'jwt', label: 'JWT', comp: JwtTool }
]

const current = ref(tools[0].id)
const currentComp = computed(() => tools.find((t) => t.id === current.value)?.comp ?? JsonTool)

watch(
  () => props.initialCommand,
  (cmd) => {
    if (cmd && tools.some((t) => t.id === cmd)) current.value = cmd
  },
  { immediate: true }
)
</script>

<template>
  <div class="devtools">
    <nav class="nav">
      <button
        v-for="t in tools"
        :key="t.id"
        class="nav-btn"
        :class="{ active: current === t.id }"
        @click="current = t.id"
      >
        {{ t.label }}
      </button>
    </nav>
    <div class="panel">
      <component :is="currentComp" :key="current" />
    </div>
  </div>
</template>

<style scoped>
.devtools {
  height: 100%;
  display: flex;
}
.nav {
  flex: none;
  width: 96px;
  padding: 10px 6px;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nav-btn {
  border: none;
  background: transparent;
  color: var(--fg-dim);
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.nav-btn.active {
  background: var(--accent-dim);
  color: var(--accent);
}
.panel {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 14px 16px;
}
</style>
