<script setup lang="ts">
import { ref } from 'vue'
import { runPattern } from './logic/regex'
import type { RegexResult } from './logic/regex'

const pattern = ref('(\\w+)@(\\w+\\.\\w+)')
const flags = ref('g')
const text = ref('联系 alice@example.com 或 bob@test.org')

const result = ref<RegexResult | null>(null)

function run(): void {
  result.value = runPattern(pattern.value, flags.value, text.value)
}
function runOnEnter(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter 只上屏
  run()
}
run()
</script>

<template>
  <div class="tool">
    <div class="bar">
      <span class="muted">/</span>
      <input v-model="pattern" type="text" style="flex: 1" @keydown.enter="runOnEnter" />
      <span class="muted">/</span>
      <input v-model="flags" type="text" style="width: 60px" @keydown.enter="runOnEnter" />
      <button class="btn primary" @click="run">测试</button>
    </div>
    <textarea v-model="text" rows="5" spellcheck="false" />
    <p v-if="result && !result.ok" class="err">✗ {{ result.message }}</p>
    <template v-else-if="result?.ok">
      <p class="muted">共 {{ result.matches.length }} 处匹配</p>
      <div class="result">
        <pre>{{
          result.matches.map((m, i) => `#${i + 1} [${m.index}] ${JSON.stringify(m.match)}${m.groups.length ? ' 分组: ' + m.groups.join(' | ') : ''}`).join('\n')
        }}</pre>
      </div>
    </template>
  </div>
</template>

<style scoped>
@import './tool.css';
</style>
