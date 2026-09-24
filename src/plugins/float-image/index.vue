<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { FloatWindowEvent, PluginContext } from '@sdk/api'
import { buildFloatHtml, extractThemeVars, sanitizeDataUrl } from './logic/float-html'
import {
  createPinRuntime,
  dropPin,
  reduceFloatEvent,
  registerPin,
  type PinRuntime
} from './logic/controller'
import {
  buildDataUrl,
  FLOAT_HTML_CHAR_BUDGET,
  initialPinPlan,
  mimeForPath,
  normalizePersist,
  parseStateReport,
  shrinkScaleFor,
  type NaturalSize
} from './logic/state'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const STORAGE_KEY = 'state'
const THUMB_MAX = 96

/** 已悬浮列表一行：会话级展示信息（缩略图/显示尺寸来自事件回传，不持久化） */
interface PinRow {
  id: string
  label: string
  thumb?: string
  /** 无真实缩略图时的占位图样式（demo 行固定给，真实贴图失败兜底 photo） */
  ph?: 'photo' | 'palette'
  natural?: NaturalSize
  display?: { width: number; height: number }
  x?: number
  y?: number
  opacity?: number
}

// demo 态（#plugin=float-image&demo=1）：2 条稳定示例供截图与新手引导，关闭按钮只改本地数组
const demoMode = props.initialCommand === 'demo'
const demoRows = ref<PinRow[]>([
  { id: 'demo-1', label: '界面参考图.png', ph: 'photo', natural: { width: 1280, height: 800 }, display: { width: 480, height: 300 }, opacity: 1 },
  { id: 'demo-2', label: '配色板.png', ph: 'palette', natural: { width: 640, height: 400 }, display: { width: 320, height: 200 }, opacity: 0.7 }
])

const status = ref('')
const error = ref('')
const busy = ref(false)
const dragOver = ref(false)
const clipboardImage = ref<{ dataUrl: string; width: number; height: number } | null>(null)
const pins = reactive(new Map<string, PinRow>())

// demo 态下真实贴图仍会生效并追加展示，示例行固定排前面
const rows = computed<PinRow[]>(() => (demoMode ? [...demoRows.value, ...pins.values()] : [...pins.values()]))
const openCount = computed(() => rows.value.length)

let runtime: PinRuntime = createPinRuntime(normalizePersist(null))
let offEvents: (() => void) | null = null
let statusTimer: ReturnType<typeof setTimeout> | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let commandDone = false

onMounted(() => {
  void loadPersist()
  offEvents = props.ctx.host.events.on('float-event', (p) => onFloatEvent(p as FloatWindowEvent))
  if (!demoMode) void probeClipboard()
})

onBeforeUnmount(() => {
  offEvents?.()
  if (persistTimer !== null) clearTimeout(persistTimer)
  // demo 态不落盘：示例会话的位置/倍率记忆不能覆盖真实用户数据
  if (!demoMode) void props.ctx.host.storage.set(STORAGE_KEY, runtime.persist).catch(() => {})
})

// 全局词条直达：pin-clipboard 直接贴出剪贴板，pin-file 直接弹文件选择（demo 不触发动作）
watch(
  () => props.initialCommand,
  (cmd) => {
    if (commandDone || !cmd) return
    commandDone = true
    if (cmd === 'pin-clipboard') void pinClipboard()
    else if (cmd === 'pin-file') void pickFiles()
  },
  { immediate: true }
)

async function loadPersist(): Promise<void> {
  if (demoMode) return
  try {
    runtime = createPinRuntime(normalizePersist(await props.ctx.host.storage.get(STORAGE_KEY)))
  } catch {
    // 读取失败按全新状态走，不阻塞功能
  }
}

function flash(text: string): void {
  status.value = text
  if (statusTimer !== null) clearTimeout(statusTimer)
  statusTimer = setTimeout(() => (status.value = ''), 1800)
}

function fail(text: string): void {
  error.value = text
}

async function probeClipboard(): Promise<void> {
  try {
    clipboardImage.value = await props.ctx.host.clipboard.readImage()
  } catch {
    clipboardImage.value = null
  }
}

function onFloatEvent(ev: FloatWindowEvent): void {
  trackPinFromEvent(ev)
  const r = reduceFloatEvent(runtime, ev)
  runtime = r.runtime
  for (const action of r.actions) {
    if (action.kind === 'update') {
      props.ctx.host.window.float.update(action.id, action.patch).catch(() => {
        // 窗口已被关掉：清出计数即可，不影响其余浮窗
        runtime = dropPin(runtime, action.id)
        pins.delete(action.id)
      })
    } else {
      schedulePersist()
    }
  }
}

// 浮窗周期性 state 报告回填列表行的显示尺寸/位置/不透明度；重挂载后的幽灵窗口找不回缩略图，给占位
function trackPinFromEvent(ev: FloatWindowEvent): void {
  if (typeof ev?.id !== 'string' || ev.id === '') return
  if (ev.event === 'closing') {
    pins.delete(ev.id)
    return
  }
  if (ev.event !== 'state') return
  const s = parseStateReport(ev.payload)
  if (!s) return
  const row = pins.get(ev.id) ?? { id: ev.id, label: '已悬浮图片', ph: 'photo' as const }
  pins.set(ev.id, {
    ...row,
    display: { width: s.width, height: s.height },
    x: s.x,
    y: s.y,
    ...(s.opacity !== undefined ? { opacity: s.opacity } : {})
  })
}

function schedulePersist(): void {
  if (demoMode) return
  if (persistTimer !== null) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    void props.ctx.host.storage.set(STORAGE_KEY, runtime.persist).catch(() => {})
  }, 500)
}

async function pinClipboard(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const img = clipboardImage.value ?? (await props.ctx.host.clipboard.readImage())
    clipboardImage.value = img
    if (!img) {
      fail('剪贴板里没有图片：先截图（macOS ⇧⌘4 / Windows Win+Shift+S）或复制一张图片')
      return
    }
    await pinDataUrl(img.dataUrl, { width: img.width, height: img.height }, '剪贴板图片')
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

async function pickFiles(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const paths = await props.ctx.host.dialog.openFile({
      title: '选择要悬浮的图片',
      multiple: true,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }]
    })
    for (const p of paths) {
      try {
        await pinFile(p)
      } catch (err) {
        fail(`${p}：${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

// Electron 44 无 File.path，拖入文件必须经 pathForFile 取路径再显式授权
async function onDrop(e: DragEvent): Promise<void> {
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length === 0 || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const paths = files.map((f) => window.gtools.pathForFile(f))
    await props.ctx.host.fs.grant(paths)
    for (const p of paths) {
      try {
        await pinFile(p)
      } catch (err) {
        fail(`${p}：${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  } finally {
    busy.value = false
  }
}

async function pinFile(path: string): Promise<void> {
  const mime = mimeForPath(path)
  if (!mime) {
    fail(`不支持的图片格式：${path}`)
    return
  }
  const base64 = await props.ctx.host.fs.read(path, { encoding: 'base64' })
  const dataUrl = buildDataUrl(mime, base64)
  const size = await measureDataUrl(dataUrl)
  await pinDataUrl(dataUrl, size, path.replace(/^.*[/\\]/, ''))
}

async function pinDataUrl(rawUrl: string, natural: NaturalSize, label: string): Promise<void> {
  let dataUrl = sanitizeDataUrl(rawUrl)
  if (!dataUrl) {
    fail('图片数据不合法（须为 png/jpeg/gif/webp/bmp/svg 的 base64 数据）')
    return
  }
  let size = natural
  if (dataUrl.length > FLOAT_HTML_CHAR_BUDGET) {
    // 浮窗 html 有长度上限：超预算时画布降采样转 JPEG（GIF 动画会被压成首帧静态图）
    const shrunk = await shrinkToBudget(dataUrl, size)
    if (!shrunk) {
      fail(`图片过大（${(rawUrl.length / 1000).toFixed(0)}KB），降采样后仍超出浮窗承载上限`)
      return
    }
    dataUrl = sanitizeDataUrl(shrunk.dataUrl)
    if (!dataUrl) {
      fail('图片压缩失败')
      return
    }
    size = shrunk.size
  }
  const thumb = await makeThumb(dataUrl)

  const plan = initialPinPlan(size, runtime.persist)
  const html = buildFloatHtml(dataUrl, {
    themeVars: extractThemeVars((name) => getComputedStyle(document.documentElement).getPropertyValue(name)),
    opacity: plan.opacity
  })
  // win32 透明窗不支持原生缩放，本插件统一 resizable:false + update 改尺寸（Windows 分支未实测）
  const id = await props.ctx.host.window.float.create({
    html,
    title: '贴图',
    width: plan.width,
    height: plan.height,
    ...(plan.x !== undefined && plan.y !== undefined ? { x: plan.x, y: plan.y } : {}),
    resizable: false,
    alwaysOnTop: true,
    transparent: true,
    focus: true
  })
  runtime = registerPin(runtime, id, size)
  pins.set(id, { id, label, thumb, ph: 'photo', natural: size, opacity: plan.opacity })
  // 连续贴多张时按 26px 阶梯错位，避免完全叠在同一处
  if (plan.x !== undefined && plan.y !== undefined) {
    runtime = {
      ...runtime,
      persist: normalizePersist({ ...runtime.persist, x: plan.x + 26, y: plan.y + 26 })
    }
  }
  flash(`已悬浮：${label}（${size.width}×${size.height}）`)
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = () => reject(new Error('图片解码失败'))
    im.src = dataUrl
  })
}

async function measureDataUrl(dataUrl: string): Promise<NaturalSize> {
  try {
    const im = await loadImage(dataUrl)
    if (im.naturalWidth > 0 && im.naturalHeight > 0) {
      return { width: im.naturalWidth, height: im.naturalHeight }
    }
  } catch {
    // 解析失败给个可视占位尺寸，仍可贴出（1:1 时由浮窗端真实 naturalWidth 校正）
  }
  return { width: 360, height: 240 }
}

// 列表缩略图：96px 内等比 PNG（保留透明通道）；失败不阻塞贴图
async function makeThumb(dataUrl: string): Promise<string | undefined> {
  try {
    const im = await loadImage(dataUrl)
    const w = im.naturalWidth
    const h = im.naturalHeight
    if (w <= 0 || h <= 0) return undefined
    const s = Math.min(1, THUMB_MAX / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * s))
    canvas.height = Math.max(1, Math.round(h * s))
    const cx = canvas.getContext('2d')
    if (!cx) return undefined
    cx.drawImage(im, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  } catch {
    return undefined
  }
}

async function shrinkToBudget(
  dataUrl: string,
  size: NaturalSize
): Promise<{ dataUrl: string; size: NaturalSize } | null> {
  let url = dataUrl
  let cur = size
  let scale = shrinkScaleFor(url.length, FLOAT_HTML_CHAR_BUDGET)
  for (let i = 0; i < 4 && url.length > FLOAT_HTML_CHAR_BUDGET; i++) {
    const w = Math.max(1, Math.round(cur.width * scale))
    const h = Math.max(1, Math.round(cur.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const cx = canvas.getContext('2d')
    if (!cx) return null
    // JPEG 无透明通道，透明区压白底（图像处理用途，非 UI 配色）
    cx.fillStyle = '#ffffff'
    cx.fillRect(0, 0, w, h)
    try {
      cx.drawImage(await loadImage(url), 0, 0, w, h)
    } catch {
      return null
    }
    url = canvas.toDataURL('image/jpeg', 0.85)
    cur = { width: w, height: h }
    scale = 0.7
  }
  return url.length <= FLOAT_HTML_CHAR_BUDGET ? { dataUrl: url, size: cur } : null
}

async function closeOne(id: string): Promise<void> {
  if (id.startsWith('demo-')) {
    demoRows.value = demoRows.value.filter((r) => r.id !== id)
    return
  }
  try {
    await props.ctx.host.window.float.close(id)
  } catch {
    // 窗口可能已被用户在浮窗端关闭，继续清本地记录
  }
  runtime = dropPin(runtime, id)
  pins.delete(id)
}

async function closeAll(): Promise<void> {
  demoRows.value = []
  try {
    await props.ctx.host.window.float.closeAll()
    runtime = { ...runtime, openIds: [], naturals: {} }
    pins.clear()
    flash('已关闭全部悬浮图')
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}

function isDemoRow(id: string): boolean {
  return id.startsWith('demo-')
}

function rowSub(row: PinRow): string {
  const parts: string[] = []
  if (row.natural) parts.push(`原始 ${row.natural.width}×${row.natural.height}`)
  if (row.display) parts.push(`显示 ${row.display.width}×${row.display.height}`)
  if (row.opacity !== undefined && row.opacity < 1) parts.push(`${Math.round(row.opacity * 100)}%`)
  if (row.x !== undefined && row.y !== undefined) parts.push(`(${row.x}, ${row.y})`)
  return parts.length > 0 ? parts.join(' · ') : '悬浮中'
}
</script>

<template>
  <div class="fi">
    <div v-if="demoMode" class="demo-banner">示例数据 · 演示模式（不写入本地存储）</div>

    <!-- 选择/拖入图片区 -->
    <div
      class="drop"
      :class="{ over: dragOver }"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <svg class="d-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <circle cx="9" cy="10" r="1.6" />
        <path d="M5 17l5-5 3.5 3.5L16 13l3 3" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <p class="d-title">把图片拖到这里，贴成置顶悬浮窗</p>
      <p class="d-sub">支持 png / jpg / gif / webp / bmp / svg，可一次多张</p>
      <div class="d-actions">
        <button class="btn primary" :disabled="busy" @click="pickFiles">新建悬浮窗…</button>
        <button class="btn" :disabled="busy" @click="pinClipboard">贴出剪贴板</button>
      </div>
      <p v-if="clipboardImage" class="d-clip">
        剪贴板里有一张图（{{ clipboardImage.width }}×{{ clipboardImage.height }}），点「贴出剪贴板」直接钉住
      </p>
      <p v-else class="d-clip dim">剪贴板暂无图片：先截图（macOS ⇧⌘4 / Windows Win+Shift+S）或复制一张图片</p>
    </div>

    <p class="feedback" :class="{ err: error !== '', ok: error === '' && status !== '' }">
      {{ error !== '' ? error : status }}
    </p>

    <!-- 已悬浮列表 -->
    <div class="list">
      <div class="l-head">
        <span class="l-title">悬浮中</span>
        <span class="l-count">{{ openCount }}</span>
        <span class="l-space"></span>
        <button class="linkbtn danger" :disabled="openCount === 0" @click="closeAll">关闭全部</button>
      </div>

      <div v-if="rows.length === 0" class="l-empty">
        <svg class="e-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M5 17l5-5 3.5 3.5L16 13l3 3" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <p>还没有悬浮的图片：拖一张图到上方，或点「贴出剪贴板」</p>
      </div>

      <div v-else class="rows">
        <div v-for="row in rows" :key="row.id" class="row" :title="row.label">
          <span class="thumb">
            <img v-if="row.thumb" :src="row.thumb" alt="" />
            <!-- 占位图全部用主题变量绘制，三主题可用的"简单占位图" -->
            <svg v-else-if="row.ph === 'palette'" class="ph" viewBox="0 0 48 48" aria-hidden="true">
              <rect x="8" y="12" width="32" height="24" rx="4" fill="var(--bg-raised)" stroke="var(--border)" stroke-width="1.5" />
              <circle cx="16" cy="24" r="3" fill="var(--accent)" />
              <circle cx="24" cy="24" r="3" fill="var(--ok)" />
              <circle cx="32" cy="24" r="3" fill="var(--warn)" />
            </svg>
            <svg v-else class="ph" viewBox="0 0 48 48" aria-hidden="true">
              <rect x="6" y="10" width="36" height="28" rx="4" fill="var(--bg-raised)" stroke="var(--border)" stroke-width="1.5" />
              <circle cx="17" cy="19" r="3.5" fill="var(--accent)" />
              <path d="M11 33 L20 24 L27 30 L33 24 L39 32" fill="none" stroke="var(--fg-dim)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="r-main">
            <span class="r-label">
              <span class="name">{{ row.label }}</span>
              <em v-if="isDemoRow(row.id)" class="r-demo">示例</em>
            </span>
            <span class="r-sub">{{ rowSub(row) }}</span>
          </span>
          <button class="r-close" title="关闭该悬浮窗" aria-label="关闭该悬浮窗" @click="closeOne(row.id)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <p class="tips">
      悬浮窗操作：悬停浮出底部控制条（缩放 / 不透明度 / 关闭）· 滚轮缩放 · 双击图片回到 1:1 · Esc 关闭 · 位置与大小会被记住
    </p>
  </div>
</template>

<style scoped>
.fi {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  font-size: var(--fs-title);
  color: var(--fg);
  min-height: 0;
}

/* demo 态顶部横幅（与其余四期插件一致的标注方式） */
.demo-banner {
  flex: none;
  padding: var(--sp-1) var(--sp-3);
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: var(--r-sm);
  font-size: var(--fs-foot);
  text-align: center;
}

/* 拖入区：层级用底色差表达（bg-raised 垫底），虚线框承担"可放置"暗示 */
.drop {
  flex: none;
  border: 1.5px dashed var(--border);
  border-radius: var(--r-lg);
  padding: var(--sp-5) var(--sp-4) var(--sp-4);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1);
  text-align: center;
  background: var(--bg-raised);
  transition:
    border-color 0.12s ease,
    background-color 0.12s ease;
}
.drop.over {
  border-color: var(--accent);
  background: var(--accent-dim);
}
.d-icon {
  width: 28px;
  height: 28px;
  color: var(--fg-dim);
}
.drop.over .d-icon {
  color: var(--accent);
}
.d-title {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-title);
  font-weight: 600;
}
.d-sub {
  margin: 0;
  font-size: var(--fs-sub);
  color: var(--fg-dim);
}
.d-actions {
  display: flex;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}
.d-clip {
  margin: var(--sp-2) 0 0;
  font-size: var(--fs-sub);
  color: var(--accent);
}
.d-clip.dim {
  color: var(--fg-dim);
}

/* §2 主按钮：accent 底 + on-accent 字；次按钮透明底 1px 边框 */
.btn {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-sub);
  cursor: pointer;
  transition: background-color 0.12s ease;
}
.btn:hover:not(:disabled) {
  background: var(--hover);
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
  font-weight: 600;
}
.btn.primary:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(1.08);
}
.btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.feedback {
  flex: none;
  margin: 0;
  min-height: 18px;
  font-size: var(--fs-sub);
}
.feedback.err {
  color: var(--danger);
}
.feedback.ok {
  color: var(--ok);
}

.list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.l-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  height: 32px;
}
.l-title {
  font-size: var(--fs-sub);
  font-weight: 600;
  color: var(--fg-dim);
}
.l-count {
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 9px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: var(--fs-foot);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.l-space {
  flex: 1;
}
.linkbtn {
  height: 24px;
  padding: 0 var(--sp-2);
  border: none;
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  border-radius: var(--r-sm);
  cursor: pointer;
}
.linkbtn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--danger);
}
.linkbtn:disabled {
  opacity: 0.45;
  cursor: default;
}

/* §2 空态：图标 + 一句话，垂直居中 */
.l-empty {
  flex: 1;
  min-height: 140px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  color: var(--fg-dim);
  font-size: var(--fs-sub);
}
.l-empty p {
  margin: 0;
}
.e-icon {
  width: 32px;
  height: 32px;
  opacity: 0.55;
}

/* §1.4 行样式：46px 行高、2px 行距、hover 才见底色 */
.rows {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  height: 46px;
  padding: 0 var(--sp-3);
  border-radius: var(--r-md);
}
.row:hover {
  background: var(--hover);
}
.thumb {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: var(--r-sm);
  background: var(--bg-raised);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.thumb img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.thumb .ph {
  width: 100%;
  height: 100%;
}
.r-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.r-label {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-title);
  min-width: 0;
}
.r-label .name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-demo {
  flex: none;
  font-style: normal;
  font-size: var(--fs-foot);
  line-height: 16px;
  padding: 0 6px;
  border-radius: var(--r-sm);
  background: var(--accent-dim);
  color: var(--accent);
}
.r-sub {
  font-size: var(--fs-sub);
  color: var(--fg-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-close {
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--fg-dim);
  border-radius: var(--r-sm);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  visibility: hidden;
}
.row:hover .r-close {
  visibility: visible;
}
.r-close:hover {
  color: var(--danger);
  background: var(--hover);
}

.tips {
  flex: none;
  margin: 0;
  font-size: var(--fs-foot);
  color: var(--fg-dim);
}
</style>
