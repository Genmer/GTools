<script setup lang="ts">
import { ref } from 'vue'
import { uuidBatch } from './logic/uuid'
import { useCopyFeedback } from './copy'

const count = ref(5)
const list = ref<string[]>([])
const { msg: copyMsg, copy } = useCopyFeedback()

function gen(): void {
  list.value = uuidBatch(count.value)
}
</script>

<template>
  <div class="tool">
    <div class="bar">
      <label>数量（1-1000）</label>
      <input v-model.number="count" type="number" min="1" max="1000" style="width: 100px" />
      <button class="btn primary" @click="gen">生成</button>
      <button v-if="list.length" class="btn" @click="copy(list.join('\n'))">复制全部</button>
      <span v-if="copyMsg !== ''" :class="copyMsg === '复制失败' ? 'err' : 'ok'">{{ copyMsg }}</span>
    </div>
    <div v-if="list.length" class="result">
      <pre>{{ list.join('\n') }}</pre>
    </div>
  </div>
</template>

<style scoped>
@import './tool.css';
</style>
