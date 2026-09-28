<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import QRCode from 'qrcode'
import type { PluginContext } from '@sdk/api'
import { isUrlLike, normalizePayload } from './logic/qr'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const text = ref('')
const dataUrl = ref('')
const error = ref('')
const copied = ref(false)
let gen = 0
let copiedTimer: ReturnType<typeof setTimeout> | undefined

async function render(): Promise<void> {
  const payload = normalizePayload(text.value)
  if (payload === null) {
    dataUrl.value = ''
    error.value = text.value.trim() === '' ? '' : '内容超过 2000 字符，无法生成'
    return
  }
  const id = ++gen
  try {
    const url = await QRCode.toDataURL(payload, { width: 280, margin: 2 })
    if (id !== gen) return // 输入已再变化，丢弃过期生成结果
    dataUrl.value = url
    error.value = ''
  } catch {
    if (id !== gen) return
    dataUrl.value = ''
    error.value = '生成失败：内容过长或含无法编码的字符'
  }
}

// 全局 regex 推荐 / 关键词后剩余输入 → 预填并即时出码（同 memo 的 query 直达通路）
watch(
  () => props.query,
  (q) => {
    const t = q.trim()
    if (t !== '') text.value = t
  },
  { immediate: true }
)
watch(text, () => void render())

function hintOf(): string {
  if (error.value !== '') return error.value
  if (dataUrl.value === '') return '输入 URL 或任意文本，即时生成二维码'
  return isUrlLike(text.value) ? '扫码即可打开此链接' : '扫码即可查看文本内容'
}

async function copyImage(): Promise<void> {
  if (dataUrl.value === '') return
  try {
    await props.ctx.host.clipboard.writeImage(dataUrl.value)
    copied.value = true
    if (copiedTimer !== undefined) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => (copied.value = false), 1500)
  } catch (err) {
    error.value = `复制失败：${err instanceof Error ? err.message : String(err)}`
  }
}

onBeforeUnmount(() => {
  if (copiedTimer !== undefined) clearTimeout(copiedTimer)
})
</script>

<template>
  <div class="qr">
    <div class="preview" :class="{ empty: dataUrl === '' }">
      <img v-if="dataUrl !== ''" :src="dataUrl" alt="二维码" />
      <span v-else class="ph">▦</span>
    </div>
    <p class="hint" :class="{ err: error !== '' }">{{ hintOf() }}</p>
    <div class="controls">
      <input v-model="text" class="input" type="text" placeholder="粘贴 URL 或任意文本…" spellcheck="false" />
      <button class="btn" :disabled="dataUrl === ''" @click="copyImage">{{ copied ? '已复制' : '复制图片' }}</button>
    </div>
  </div>
</template>

<style scoped>
.qr {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-3);
  color: var(--fg);
}
.preview {
  flex: none;
  width: 280px;
  height: 280px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-raised);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-pop);
  overflow: hidden;
}
.preview.empty {
  color: var(--fg-dim);
}
.preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.ph {
  font-size: 64px;
}
.hint {
  margin: 0;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.hint.err {
  color: var(--danger);
}
.controls {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  width: min(520px, 92%);
}
.input {
  flex: 1;
  min-width: 0;
  height: 34px;
  box-sizing: border-box;
  background: var(--bg-raised);
  color: var(--fg);
  border: none;
  border-radius: var(--r-md);
  padding: 0 var(--sp-3);
  font-size: var(--fs-title);
  outline: none;
  caret-color: var(--accent);
}
.input:focus {
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.btn {
  flex: none;
  height: 34px;
  padding: 0 var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
