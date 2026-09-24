<script setup lang="ts">
import { ref } from 'vue'
import { encode, tryDecode } from './logic/base64'
import { copyText } from './copy'

const input = ref('')
const output = ref('')
const error = ref<string | null>(null)

function doEncode(): void {
  error.value = null
  output.value = encode(input.value)
}

function doDecode(): void {
  error.value = null
  const r = tryDecode(input.value)
  if (r.ok) output.value = r.text
  else {
    output.value = ''
    error.value = r.message
  }
}
</script>

<template>
  <div class="tool">
    <div class="bar">
      <button class="btn primary" @click="doEncode">编码 →</button>
      <button class="btn" @click="doDecode">← 解码</button>
    </div>
    <textarea v-model="input" rows="5" placeholder="输入文本或 Base64" spellcheck="false" />
    <p v-if="error" class="err">✗ {{ error }}</p>
    <div v-else-if="output" class="result">
      <pre>{{ output }}</pre>
      <button class="btn" @click="copyText(output)">复制</button>
    </div>
  </div>
</template>

<style scoped>
@import './tool.css';
</style>
