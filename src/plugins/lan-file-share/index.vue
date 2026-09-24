<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import QRCode from 'qrcode'
import type { PluginContext } from '@sdk/api'
import {
  CONFIG_KEY,
  CONTROL_KEY,
  STATE_KEY,
  normalizePort,
  parseConfig,
  shareUrl,
  type ShareState,
  type TransferLogEntry
} from './shared'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const config = ref(parseConfig(null))
const state = ref<ShareState | null>(null)
const lanAddrs = ref<Array<{ name: string; address: string }>>([])
const ipIndex = ref(0)
const qr = ref('')
const pending = ref(false)
const error = ref('')
const copied = ref(false)
const nowTick = ref(Date.now())

let offState: (() => void) | null = null
let controlId = Date.now()
let retryTimer: ReturnType<typeof setTimeout> | undefined
let clockTimer: ReturnType<typeof setInterval> | undefined

const running = computed(() => state.value?.running === true)
const portInput = ref(config.value.port)

const usableAddrs = computed(() => lanAddrs.value.filter((a) => !a.address.startsWith('169.254.')))
const currentIp = computed(() => usableAddrs.value[ipIndex.value]?.address ?? '')
const url = computed(() => (running.value && state.value?.port != null && currentIp.value !== '' ? shareUrl(currentIp.value, state.value.port) : ''))
const dirName = computed(() => {
  const d = config.value.dir ?? state.value?.dir
  if (d == null || d === '') return ''
  const seg = d.split(/[\\/]/).filter(Boolean)
  return seg[seg.length - 1] ?? d
})
const devices = computed(() => state.value?.devices ?? [])
const logs = computed(() => [...(state.value?.log ?? [])].reverse())

onMounted(async () => {
  try {
    config.value = parseConfig(await props.ctx.host.storage.get(CONFIG_KEY))
    portInput.value = config.value.port
  } catch {
    // 读失败用默认
  }
  try {
    state.value = (await props.ctx.host.storage.get(STATE_KEY)) as ShareState | null
  } catch {
    state.value = null
  }
  try {
    lanAddrs.value = await props.ctx.host.net.lanAddresses()
  } catch {
    lanAddrs.value = []
  }
  offState = props.ctx.host.events.on('state', (p) => {
    if (typeof p === 'object' && p !== null) state.value = p as ShareState
  })
  clockTimer = setInterval(() => (nowTick.value = Date.now()), 30_000)
})

// 退出插件视图即停服务：直接写控制键（不等待确认），800ms 后补发一次防丢
onBeforeUnmount(() => {
  offState?.()
  if (clockTimer !== undefined) clearInterval(clockTimer)
  if (retryTimer !== undefined) clearTimeout(retryTimer)
  void sendControlRaw('stop')
  setTimeout(() => void sendControlRaw('stop'), 800)
})

watch(url, (u) => {
  if (u === '') {
    qr.value = ''
    return
  }
  void QRCode.toDataURL(u, { width: 220, margin: 2 })
    .then((d) => (qr.value = d))
    .catch(() => (qr.value = ''))
})

watch(portInput, (p) => {
  const n = normalizePort(p)
  if (n !== null && n !== config.value.port) {
    config.value.port = n
    void props.ctx.host.storage.set(CONFIG_KEY, config.value)
  }
})

async function pickDir(): Promise<void> {
  error.value = ''
  try {
    const [dir] = await props.ctx.host.dialog.openFile({ directory: true, title: '选择要共享的文件夹' })
    if (dir === undefined) return
    config.value.dir = dir
    await props.ctx.host.storage.set(CONFIG_KEY, config.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '选择文件夹失败'
  }
}

async function start(): Promise<void> {
  if (pending.value) return
  error.value = ''
  if (config.value.dir == null) await pickDir()
  if (config.value.dir == null) return
  const port = normalizePort(portInput.value)
  if (port === null) {
    error.value = '端口须为 1024–65535 的整数'
    return
  }
  config.value.port = port
  await props.ctx.host.storage.set(CONFIG_KEY, config.value)
  await sendControl('start', { dir: config.value.dir, port })
}

async function stop(): Promise<void> {
  if (pending.value) return
  await sendControl('stop')
}

async function sendControlRaw(op: 'start' | 'stop', extra?: { dir?: string; port?: number }): Promise<void> {
  controlId = Math.max(Date.now(), controlId + 1)
  await props.ctx.host.storage.set(CONTROL_KEY, { id: controlId, op, ...extra })
}

/** 控制键是协议内唯一的请求通道，可能被并发 storage 覆写丢掉或 backend 尚未装配：重发直到回显确认 */
async function sendControl(op: 'start' | 'stop', extra?: { dir?: string; port?: number }): Promise<void> {
  pending.value = true
  try {
    await sendControlRaw(op, extra)
    for (let i = 0; i < 8; i++) {
      await sleep(700)
      if (state.value !== null && state.value.lastHandledId >= controlId) {
        error.value = state.value.error ?? ''
        return
      }
      await sendControlRaw(op, extra)
    }
    error.value = '服务未响应，请重试'
  } catch (err) {
    error.value = err instanceof Error ? err.message : '操作失败'
  } finally {
    pending.value = false
  }
}

async function openDir(): Promise<void> {
  const dir = config.value.dir ?? state.value?.dir
  if (dir == null) return
  try {
    await props.ctx.host.shell.openPath(dir)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '打开目录失败'
  }
}

async function copyUrl(): Promise<void> {
  if (url.value === '') return
  try {
    await navigator.clipboard.writeText(url.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // 剪贴板被占用时静默
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function fmtTime(t: number): string {
  const d = new Date(t)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtSeen(t: number): string {
  const s = Math.max(0, Math.floor((nowTick.value - t) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  return `${Math.floor(s / 3600)} 小时前`
}

const KIND_META: Record<TransferLogEntry['kind'], { icon: string; label: string }> = {
  start: { icon: '▶', label: '服务已启动' },
  stop: { icon: '■', label: '服务已停止' },
  connect: { icon: '⇄', label: '设备连接' },
  upload: { icon: '↑', label: '上传' },
  download: { icon: '↓', label: '下载' },
  zip: { icon: '🗜', label: '打包下载' },
  error: { icon: '!', label: '错误' }
}

function logText(e: TransferLogEntry): string {
  const m = KIND_META[e.kind]
  if (e.kind === 'start' || e.kind === 'error') return e.detail ?? m.label
  const name = e.name !== undefined ? `「${e.name}」` : ''
  const size = e.size !== undefined ? ` (${fmtSize(e.size)})` : ''
  return `${m.label} ${name}${size}${e.detail !== undefined && e.kind !== 'connect' && e.kind !== 'stop' ? ` · ${e.detail}` : ''}`.trim()
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB']
  let v = n
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}
</script>

<template>
  <div class="lan">
    <div class="bar">
      <button class="btn dir" :title="config.dir ?? '选择要共享的文件夹'" @click="pickDir">
        📁 {{ dirName === '' ? '选择文件夹' : dirName }}
      </button>
      <label class="port">端口 <input v-model.number="portInput" type="number" min="1024" max="65535" /></label>
      <button v-if="!running" class="btn primary" :disabled="pending" @click="start">
        {{ pending ? '处理中…' : '开始共享' }}
      </button>
      <button v-else class="btn danger" :disabled="pending" @click="stop">停止共享</button>
      <button v-if="config.dir != null" class="btn" title="在访达/资源管理器中打开" @click="openDir">打开目录</button>
    </div>

    <p v-if="error !== ''" class="err">{{ error }}</p>

    <div v-if="running" class="share">
      <div class="qr-side">
        <img v-if="qr !== ''" class="qr" :src="qr" alt="扫码访问" />
        <p v-if="usableAddrs.length > 1" class="ifaces">
          网卡：
          <select v-model.number="ipIndex">
            <option v-for="(a, i) in usableAddrs" :key="a.address" :value="i">{{ a.name }}（{{ a.address }}）</option>
          </select>
        </p>
        <p class="url" @click="copyUrl">{{ url }} <span class="copy">{{ copied ? '已复制' : '复制' }}</span></p>
        <p class="hint">手机与电脑连同一 Wi-Fi，扫码或输入地址即可上传 / 下载 / 预览</p>
      </div>
      <div class="right">
        <div class="panel devices">
          <h4>连接设备（{{ devices.length }}）</h4>
          <ul>
            <li v-for="d in devices" :key="d.ip + d.label">
              <span class="dl">{{ d.label }}</span>
              <span class="dim">{{ d.ip }} · {{ fmtSeen(d.lastSeen) }} · {{ d.requests }} 次请求</span>
            </li>
            <li v-if="devices.length === 0" class="dim none">等待设备连接…</li>
          </ul>
        </div>
        <div class="panel log">
          <h4>传输日志</h4>
          <ul>
            <li v-for="(e, i) in logs" :key="`${e.t}-${i}`">
              <span class="t">{{ fmtTime(e.t) }}</span>
              <span class="k" :class="e.kind">{{ KIND_META[e.kind].icon }}</span>
              <span class="tx"><b v-if="e.kind !== 'start' && e.kind !== 'error' && e.kind !== 'stop'">{{ e.device }}</b> {{ logText(e) }}</span>
            </li>
            <li v-if="logs.length === 0" class="dim none">暂无记录</li>
          </ul>
        </div>
      </div>
    </div>

    <div v-else class="guide">
      <p class="big">📡 局域网文件共享</p>
      <ol>
        <li>选择一个要共享的文件夹</li>
        <li>点「开始共享」，用手机扫码（或浏览器输入地址）</li>
        <li>手机上可浏览、在线预览、多选打包下载，也可把手机里的文件上传到当前目录</li>
      </ol>
      <p class="dim">服务随插件运行：退出本插件即自动停止；传输仅限局域网内，文件不经过任何服务器</p>
    </div>
  </div>
</template>

<style scoped>
.lan {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  min-height: 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.btn.dir {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
}
.btn.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--bg);
}
.btn:disabled {
  opacity: 0.55;
  cursor: default;
}
.port {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--fg-dim);
  font-size: 12px;
}
.port input {
  width: 76px;
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 6px;
  font-size: 12px;
  outline: none;
}
.err {
  color: var(--danger);
  margin: 0;
  flex: none;
}
.share {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
}
.qr-side {
  flex: none;
  width: 248px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.qr {
  width: 220px;
  height: 220px;
  border-radius: 6px;
}
.ifaces {
  margin: 0;
  font-size: 12px;
  color: var(--fg-dim);
  max-width: 100%;
}
.ifaces select {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 12px;
  max-width: 150px;
}
.url {
  margin: 0;
  font-size: 12px;
  color: var(--accent);
  font-family: ui-monospace, monospace;
  word-break: break-all;
  cursor: pointer;
  text-align: center;
}
.copy {
  color: var(--fg-dim);
  margin-left: 4px;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--fg-dim);
  text-align: center;
}
.right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}
.panel {
  background: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  overflow: hidden;
}
.panel h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--fg-dim);
  font-weight: 600;
}
.panel ul {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
}
.devices {
  flex: none;
  max-height: 108px;
}
.devices li {
  display: flex;
  gap: 8px;
  justify-content: space-between;
  padding: 2px 0;
  font-size: 12px;
}
.devices .dl {
  color: var(--fg);
}
.log {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.log ul {
  flex: 1;
  min-height: 0;
}
.log li {
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 2px 0;
  font-size: 12px;
}
.log .t {
  color: var(--fg-dim);
  font-family: ui-monospace, monospace;
  flex: none;
}
.log .k {
  flex: none;
  width: 14px;
  text-align: center;
  color: var(--fg-dim);
}
.log .k.upload {
  color: var(--accent);
}
.log .k.download,
.log .k.zip {
  color: var(--accent);
}
.log .k.error {
  color: var(--danger);
}
.log .tx {
  word-break: break-all;
}
.log .tx b {
  font-weight: 600;
}
.dim {
  color: var(--fg-dim);
}
.none {
  padding: 4px 0;
}
.guide {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.guide .big {
  font-size: 16px;
  margin: 0;
}
.guide ol {
  margin: 0;
  padding-left: 20px;
  color: var(--fg);
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.guide p {
  margin: 0;
  font-size: 12px;
}
</style>
