<script setup lang="ts">
import { ref } from 'vue'
import { format, minify, validate } from './logic/json'
import type { JsonResult } from './logic/json'
import { copyText } from './copy'

const input = ref('{"name":"GTools","tags":["launcher","electron"]}')
const indent = ref<2 | 4>(2)
const result = ref<JsonResult | null>(null)

function run(mode: 'format' | 'minify' | 'validate'): void {
  if (mode === 'validate') result.value = validate(input.value)
  else if (mode === 'minify') result.value = minify(input.value)
  else result.value = format(input.value, indent.value)
}
</script>

<template>
  <div class="tool">
    <div class="bar">
      <label><input type="radio" :value="2" v-model="indent" /> 2 空格</label>
      <label><input type="radio" :value="4" v-model="indent" /> 4 空格</label>
      <button class="btn" @click="run('format')">格式化</button>
      <button class="btn" @click="run('minify')">压缩</button>
      <button class="btn" @click="run('validate')">校验</button>
    </div>
    <textarea v-model="input" rows="8" spellcheck="false" />
    <div v-if="result?.ok && result.text !== undefined" class="result">
      <pre>{{ result.text }}</pre>
      <button class="btn" @click="copyText(result.text!)">复制</button>
    </div>
    <p v-else-if="result?.ok" class="ok">✓ 合法 JSON</p>
    <p v-else-if="result && !result.ok" class="err">✗ 第 {{ result.line }} 行第 {{ result.column }} 列：{{ result.message }}</p>
  </div>
</template>

<style scoped>
@import './tool.css';
</style>
