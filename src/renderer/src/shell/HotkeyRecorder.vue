<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { normalizeAccelerator, validateAccelerator } from '@sdk/shortcut-rules'

const props = defineProps<{
  platform: 'darwin' | 'win32'
  /** 录入确认后落盘：返回错误文案则保持录入态展示，null 即成功收起 */
  save: (accel: string) => Promise<string | null>
  /** 录键即时冲突校验（对主热键/其他指令项），返回错误文案则禁保存；主热键自身无需查撞 */
  conflictCheck?: (accel: string) => string | null
}>()

const recording = ref(false)
const pendingAccel = ref<string | null>(null)
const error = ref<string | null>(null)
// 只提示不进 error：canSave 要求 error 为空，占用提示不得阻塞录入其他组合
const probeHint = ref<string | null>(null)
const canSave = computed(() => pendingAccel.value !== null && error.value === null)

function stop(): void {
  if (recording.value) void window.gtools.host('hotkey:resume')
  recording.value = false
  pendingAccel.value = null
  error.value = null
  probeHint.value = null
}

async function start(): Promise<void> {
  recording.value = true
  pendingAccel.value = null
  error.value = null
  probeHint.value = null
  // 全局热键先于窗口 keydown 截走按键（如 Alt+Space），录入期间挂起全部已注册热键
  const r = await window.gtools.host('hotkey:suspend')
  if (recording.value && r.ok && (r.data as { probe?: unknown } | undefined)?.probe === false) {
    probeHint.value = 'Alt+Space 疑被其他应用占用，录入该组合可能不稳定'
  }
}

// 录入中窗口被隐藏（Esc 隐藏主窗等）必须收尾，否则热键一直处于挂起态
function onVisibility(): void {
  if (document.hidden && recording.value) stop()
}
onMounted(() => document.addEventListener('visibilitychange', onVisibility))
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  if (recording.value) void window.gtools.host('hotkey:resume')
})

// 结算一条加速键：录入预览 + 校验 + 撞键检查（keydown 与主进程捕获共用）
function settle(rawKey: string, mods: { meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }): void {
  const m: string[] = []
  if (mods.meta) m.push('Cmd')
  if (mods.ctrl) m.push('Ctrl')
  if (mods.alt) m.push('Alt')
  if (mods.shift) m.push('Shift')
  const keyName = rawKey === ' ' ? 'Space' : rawKey.length === 1 ? rawKey.toUpperCase() : rawKey[0].toUpperCase() + rawKey.slice(1)
  const accel = normalizeAccelerator([...m, keyName].join('+'))
  pendingAccel.value = accel
  const issue = validateAccelerator(accel, props.platform)
  error.value = issue.ok ? (props.conflictCheck?.(accel) ?? null) : (issue.reason ?? null)
}

// 窗口捕获级监听：焦点在任何控件（含搜索框）都录得到，preventDefault+stopPropagation 同时挡住录入期间的其它按键语义
function onWindowKey(e: KeyboardEvent): void {
  if (!recording.value) return
  if (e.isComposing) return // 输入法组合态不录键
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    stop()
    return
  }
  if (['Cmd', 'Ctrl', 'Alt', 'Shift', 'Meta', 'Control', 'Option'].includes(e.key)) return // 修饰键单独按下不结算
  settle(e.key, { meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey })
}

// 主进程捕获通道：Alt+Space 等 Windows 系统键组合的 keyDown 被系统吞掉，主进程据 keyUp 重建后转发
let offCaptured: (() => void) | undefined
function onCaptured(payload: unknown): void {
  if (!recording.value || typeof payload !== 'string') return
  if (payload === 'Escape') {
    stop()
    return
  }
  const parts = payload.split('+')
  const key = parts[parts.length - 1] ?? ''
  settle(key === 'Space' ? ' ' : key, {
    meta: parts.includes('Cmd'),
    ctrl: parts.includes('Ctrl'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift')
  })
}

watch(recording, (on) => {
  if (on) {
    window.addEventListener('keydown', onWindowKey, true)
    offCaptured = window.gtools.on('hotkey-captured', onCaptured)
  } else {
    window.removeEventListener('keydown', onWindowKey, true)
    offCaptured?.()
    offCaptured = undefined
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKey, true)
  offCaptured?.()
  offCaptured = undefined
})

async function confirm(): Promise<void> {
  if (!canSave.value || pendingAccel.value === null) return
  const err = await props.save(pendingAccel.value)
  if (err !== null) {
    error.value = err
    return
  }
  stop()
}
</script>

<template>
  <span class="recorder">
    <button class="btn" @click="recording ? stop() : start()">
      {{ recording ? '录入中…（按 Esc 取消）' : '修改' }}
    </button>
    <template v-if="recording && pendingAccel">
      <span class="accel preview">{{ pendingAccel }}</span>
      <button class="btn primary" :disabled="!canSave" @click="confirm">保存</button>
    </template>
    <span v-if="error" class="error">{{ error }}</span>
    <span v-if="probeHint" class="error">{{ probeHint }}</span>
  </span>
</template>

<style scoped>
.recorder {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.accel {
  font-family: ui-monospace, monospace;
  background: var(--accent-dim);
  padding: 4px 10px;
  border-radius: var(--r-sm);
  font-size: 13px;
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: var(--danger);
  font-size: 13px;
}
</style>
