<script setup lang="ts">
import { computed, ref } from 'vue'
import { parseColor } from './logic/color'
import { copyText } from './copy'

const input = ref('#4493f8')
const result = computed(() => parseColor(input.value))
</script>

<template>
  <div class="tool">
    <div class="bar">
      <input v-model="input" type="text" placeholder="#aabbcc / rgb(1,2,3) / hsl(120,50%,50%)" />
    </div>
    <p v-if="!result.ok" class="err">✗ {{ result.message }}</p>
    <template v-else>
      <div class="bar">
        <span class="swatch" :style="{ background: result.color.hex }"></span>
        <span class="ok">{{ result.color.hex }}</span>
        <span class="ok">rgb({{ result.color.rgb.r }}, {{ result.color.rgb.g }}, {{ result.color.rgb.b }})</span>
        <span class="ok">hsl({{ result.color.hsl.h }}, {{ result.color.hsl.s }}%, {{ result.color.hsl.l }}%)</span>
      </div>
      <div class="bar">
        <button class="btn" @click="copyText(result.color.hex)">复制 HEX</button>
        <button class="btn" @click="copyText(`rgb(${result.color.rgb.r}, ${result.color.rgb.g}, ${result.color.rgb.b})`)">复制 RGB</button>
        <button class="btn" @click="copyText(`hsl(${result.color.hsl.h}, ${result.color.hsl.s}%, ${result.color.hsl.l}%)`)">复制 HSL</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
@import './tool.css';
.swatch {
  display: inline-block;
  width: 40px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid var(--border);
}
</style>
