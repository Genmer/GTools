<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PluginContext, ScreenshotResult } from '@sdk/api'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const busy = ref(false)
const error = ref('')
const last = ref<ScreenshotResult | null>(null)

async function start(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    last.value = await props.ctx.host.screenshot.capture()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function copyLast(): Promise<void> {
  if (!last.value?.dataUrl) return
  try {
    await props.ctx.host.clipboard.writeImage(last.value.dataUrl)
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function saveLast(): Promise<void> {
  if (!last.value?.dataUrl) return
  try {
    // 对话框选中路径自动授予 fs 写授权；取消返回 null
    const p = await props.ctx.host.dialog.saveFile({
      title: '保存截图',
      defaultPath: `截图_${Date.now()}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (!p) return
    const d = last.value.dataUrl
    await props.ctx.host.fs.write(p, d.slice(d.indexOf(',') + 1), { encoding: 'base64' })
    last.value = { ...last.value, action: 'save', savedPath: p }
    error.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

// 指令热键/命令直达：进插件视图即开拍（主进程会先弹启动器装载插件，capture 内部再隐藏）
onMounted(() => {
  if (props.initialCommand === 'capture') void start()
})
</script>

<template>
  <div class="shot">
    <button class="go" :disabled="busy" @click="start">
      {{ busy ? '截图中…（框选后回车复制 / Esc 取消）' : '开始截图' }}
    </button>
    <p class="hint">隐藏启动器后屏幕定格：拖拽框选，工具条可复制 / 另存；回车=复制选区，双击/不框选回车=全屏，Esc 或右键取消。可在 设置 → 指令热键 绑定全局快捷键。</p>
    <p v-if="error" class="err">{{ error }}</p>
    <template v-if="last && last.action !== 'cancel'">
      <p class="done">
        {{ last.action === 'copy' ? '已复制到剪贴板' : `已保存：${last.savedPath}` }}
        <span v-if="last.width">（{{ last.width }} × {{ last.height }}）</span>
      </p>
      <img v-if="last.dataUrl" class="prev" :src="last.dataUrl" alt="截图预览" />
      <div v-if="last.dataUrl" class="acts">
        <button @click="copyLast">复制</button>
        <button @click="saveLast">另存为…</button>
      </div>
    </template>
    <p v-else-if="last && last.action === 'cancel'" class="hint">已取消。</p>
  </div>
</template>

<style scoped>
.shot {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
}
.go {
  align-self: flex-start;
  border: none;
  cursor: pointer;
  border-radius: 8px;
  padding: 10px 22px;
  font-size: 14px;
  color: var(--fg);
  background: var(--accent-dim);
}
.go:disabled {
  opacity: 0.6;
  cursor: default;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--fg-dim);
}
.err {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
.done {
  margin: 0;
  font-size: 13px;
  color: var(--fg);
}
.prev {
  max-width: 360px;
  max-height: 220px;
  border-radius: 6px;
  border: 1px solid var(--border);
  object-fit: contain;
}
.acts {
  display: flex;
  gap: 8px;
}
.acts button {
  border: 1px solid var(--border);
  cursor: pointer;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--fg);
  background: transparent;
}
.acts button:hover {
  background: var(--hover);
}
</style>
