<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { PluginContext } from '@sdk/api'
import ImageBedSettingsPanel from './settings.vue'
import { base64ToBytes, dataUrlToBase64, dataUrlToMime } from './logic/base64'
import { FORMAT_LABELS, formatLink } from './logic/formats'
import {
  HISTORY_STORAGE_KEY,
  addEntries,
  makeEntryId,
  normalizeHistory,
  removeEntry
} from './logic/history'
import { IMAGE_EXTENSIONS, baseName, clipboardImageName, formatBytes, isImageFilename, mimeOf } from './logic/imagefile'
import { ImageBedError, providerLabel, uploadImage } from './logic/providers'
import type { FetchFn, UploadResult } from './logic/providers'
import {
  DEFAULT_IMAGE_BED_SETTINGS,
  SETTINGS_STORAGE_KEY,
  normalizeImageBedSettings
} from './logic/settings'
import type { ImageBedSettings, LinkFormat } from './logic/settings'
import { makeThumb } from './logic/thumbnail'
import type { HistoryEntry } from './logic/history'

interface PendingItem {
  key: string
  filename: string
  contentType: string
  base64: string
  bytes: number
  width?: number
  height?: number
  thumb?: string
  status: 'waiting' | 'uploading' | 'done' | 'error'
  error?: string
  url?: string
}

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

const tab = ref<'upload' | 'history'>(props.initialCommand === 'history' ? 'history' : 'upload')
const settings = ref<ImageBedSettings>(normalizeImageBedSettings(DEFAULT_IMAGE_BED_SETTINGS))
const format = ref<LinkFormat>('url')
const pending = ref<PendingItem[]>([])
const history = ref<HistoryEntry[]>([])
const lastResult = ref<{ url: string; filename: string } | null>(null)
const showSettings = ref(false)
const dragOver = ref(false)
const toast = ref('')

const hostFetch: FetchFn = (url, init) => props.ctx.host.net.fetch(url, init)
// v-for 迭代对象会丢字面量键类型，改用键数组保住 LinkFormat
const FORMATS: LinkFormat[] = ['url', 'markdown', 'html']
const currentLinkText = computed(() =>
  lastResult.value === null ? '' : formatLink(format.value, lastResult.value.url, lastResult.value.filename)
)
const providerName = computed(() => providerLabel(settings.value))

let toastTimer: ReturnType<typeof setTimeout> | undefined
let uploadRunning = false

function showToast(msg: string): void {
  toast.value = msg
  if (toastTimer !== undefined) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 1800)
}

onMounted(async () => {
  try {
    settings.value = normalizeImageBedSettings(await props.ctx.host.storage.get(SETTINGS_STORAGE_KEY))
  } catch {
    settings.value = normalizeImageBedSettings(DEFAULT_IMAGE_BED_SETTINGS)
  }
  format.value = settings.value.defaultFormat
  try {
    history.value = normalizeHistory(await props.ctx.host.storage.get(HISTORY_STORAGE_KEY), settings.value.historyLimit)
  } catch {
    history.value = []
  }
  // 粘贴截图：焦点在外壳搜索框时 paste 事件仍冒泡到 document
  document.addEventListener('paste', onDocPaste)
})

onBeforeUnmount(() => {
  document.removeEventListener('paste', onDocPaste)
  if (toastTimer !== undefined) clearTimeout(toastTimer)
})

function onDocPaste(): void {
  if (showSettings.value || tab.value !== 'upload') return
  void pasteImage()
}

async function addImage(dataUrl: string, filename: string, width?: number, height?: number): Promise<void> {
  const base64 = dataUrlToBase64(dataUrl)
  if (base64 === '') {
    showToast('图片内容为空')
    return
  }
  const thumb = await makeThumb(dataUrl)
  pending.value.push({
    key: makeEntryId(),
    filename,
    contentType: dataUrlToMime(dataUrl) || mimeOf(filename),
    base64,
    bytes: base64ToBytes(base64).length,
    width,
    height,
    thumb,
    status: 'waiting'
  })
  void drainQueue()
}

async function pasteImage(): Promise<void> {
  try {
    const img = await props.ctx.host.clipboard.readImage()
    if (img === null) {
      showToast('剪贴板中没有图片')
      return
    }
    await addImage(img.dataUrl, clipboardImageName(), img.width, img.height)
  } catch (err) {
    showToast(err instanceof Error ? err.message : '读取剪贴板失败')
  }
}

async function pickFiles(): Promise<void> {
  try {
    const paths = await props.ctx.host.dialog.openFile({
      title: '选择要上传的图片',
      multiple: true,
      filters: [{ name: '图片', extensions: IMAGE_EXTENSIONS }]
    })
    await loadPaths(paths)
  } catch (err) {
    showToast(err instanceof Error ? err.message : '选择文件失败')
  }
}

async function onDrop(e: DragEvent): Promise<void> {
  dragOver.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length === 0) return
  try {
    const paths = files.map((f) => window.gtools.pathForFile(f))
    await props.ctx.host.fs.grant(paths)
    await loadPaths(paths)
  } catch (err) {
    showToast(err instanceof Error ? err.message : '读取拖入文件失败')
  }
}

async function loadPaths(paths: readonly string[]): Promise<void> {
  const images = paths.filter((p) => isImageFilename(baseName(p)))
  if (images.length === 0) {
    showToast('没有可上传的图片文件')
    return
  }
  for (const p of images) {
    try {
      const base64 = await props.ctx.host.fs.read(p, { encoding: 'base64' })
      await addImage(`data:${mimeOf(baseName(p))};base64,${base64}`, baseName(p))
    } catch (err) {
      showToast(err instanceof Error ? err.message : `读取 ${baseName(p)} 失败`)
    }
  }
}

async function drainQueue(): Promise<void> {
  if (uploadRunning) return
  uploadRunning = true
  try {
    for (;;) {
      const item = pending.value.find((p) => p.status === 'waiting')
      if (item === undefined) break
      item.status = 'uploading'
      try {
        const res = await uploadImage(
          { filename: item.filename, contentType: item.contentType, base64: item.base64 },
          settings.value,
          hostFetch
        )
        item.status = 'done'
        item.url = res.url
        lastResult.value = { url: res.url, filename: item.filename }
        await appendHistory(item, res)
        await copyText(formatLink(format.value, res.url, item.filename))
        showToast(`已上传并复制${FORMAT_LABELS[format.value]}链接`)
      } catch (err) {
        item.status = 'error'
        item.error = err instanceof ImageBedError || err instanceof Error ? err.message : String(err)
      }
    }
  } finally {
    uploadRunning = false
  }
}

async function appendHistory(item: PendingItem, res: UploadResult): Promise<void> {
  const entry: HistoryEntry = {
    id: makeEntryId(),
    url: res.url,
    deleteUrl: res.deleteUrl,
    filename: item.filename,
    width: item.width,
    height: item.height,
    bytes: item.bytes,
    thumb: item.thumb,
    uploadedAt: Date.now(),
    providerId: res.providerId
  }
  history.value = addEntries(history.value, [entry], settings.value.historyLimit)
  await persistHistory()
}

async function persistHistory(): Promise<void> {
  try {
    await props.ctx.host.storage.set(HISTORY_STORAGE_KEY, history.value)
  } catch {
    showToast('历史写入本地存储失败')
  }
}

async function copyText(text: string): Promise<void> {
  try {
    await props.ctx.host.clipboard.writeText(text)
  } catch {
    showToast('复制到剪贴板失败')
  }
}

async function copyEntryLink(e: HistoryEntry): Promise<void> {
  await copyText(formatLink(format.value, e.url, e.filename))
  showToast(`已复制${FORMAT_LABELS[format.value]}链接`)
}

async function copyCurrentLink(): Promise<void> {
  if (lastResult.value === null) return
  await copyText(currentLinkText.value)
  showToast(`已复制${FORMAT_LABELS[format.value]}链接`)
}

async function openUrl(url: string): Promise<void> {
  try {
    await props.ctx.host.shell.openExternal(url)
  } catch (err) {
    showToast(err instanceof Error ? err.message : '打开链接失败')
  }
}

async function deleteEntry(id: string): Promise<void> {
  history.value = removeEntry(history.value, id)
  await persistHistory()
}

async function clearHistory(): Promise<void> {
  history.value = []
  await persistHistory()
  showToast('已清空上传历史')
}

function clearPending(): void {
  pending.value = pending.value.filter((p) => p.status === 'uploading')
}

function statusText(item: PendingItem): string {
  if (item.status === 'waiting') return '等待中'
  if (item.status === 'uploading') return '上传中…'
  if (item.status === 'done') return '已上传'
  return item.error ?? '上传失败'
}

function formatDate(ts: number): string {
  return ts > 0 ? new Date(ts).toLocaleString() : '时间未知'
}

function onSettingsSaved(next: ImageBedSettings): void {
  settings.value = next
}
</script>

<template>
  <div class="image-bed">
    <div class="bar">
      <div class="seg">
        <button :class="{ active: tab === 'upload' }" @click="tab = 'upload'">上传</button>
        <button :class="{ active: tab === 'history' }" @click="tab = 'history'">历史（{{ history.length }}）</button>
      </div>
      <span class="spacer"></span>
      <span class="provider" :title="providerName">{{ providerName }}</span>
      <button class="btn" :class="{ active: showSettings }" @click="showSettings = !showSettings">设置</button>
    </div>

    <ImageBedSettingsPanel
      v-if="showSettings"
      :ctx="ctx"
      :settings="settings"
      @saved="onSettingsSaved"
      @close="showSettings = false"
    />

    <template v-else-if="tab === 'upload'">
      <div
        class="dropzone"
        :class="{ over: dragOver }"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop.prevent="onDrop"
      >
        <p class="dz-title">拖入图片到此处</p>
        <p class="dz-hint">也可以点击「选择图片」，或直接 Ctrl+V / ⌘V 粘贴截图</p>
        <div class="dz-actions">
          <button class="btn primary" @click="pickFiles">选择图片</button>
          <button class="btn" @click="pasteImage">粘贴剪贴板图片</button>
        </div>
      </div>

      <div v-if="pending.length > 0" class="pending">
        <div class="phead">
          <span>本次队列（{{ pending.length }}）</span>
          <button class="btn small" @click="clearPending">清空已完成</button>
        </div>
        <div class="plist">
          <div v-for="item in pending" :key="item.key" class="pitem" :class="item.status">
            <img v-if="item.thumb" class="thumb" :src="item.thumb" alt="" />
            <span v-else class="thumb ph">🖼️</span>
            <span class="name" :title="item.filename">{{ item.filename }}</span>
            <span class="size">{{ formatBytes(item.bytes) }}</span>
            <span class="status" :class="{ err: item.status === 'error' }" :title="item.error">{{ statusText(item) }}</span>
          </div>
        </div>
      </div>

      <div v-if="lastResult" class="result">
        <div class="seg">
          <button v-for="f in FORMATS" :key="f" :class="{ active: format === f }" @click="format = f">
            {{ FORMAT_LABELS[f] }}
          </button>
        </div>
        <code class="link" :title="currentLinkText">{{ currentLinkText }}</code>
        <div class="ops">
          <button class="btn" @click="copyCurrentLink">复制</button>
          <button class="btn" @click="openUrl(lastResult.url)">打开链接</button>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="hhead">
        <div class="seg">
          <button v-for="f in FORMATS" :key="f" :class="{ active: format === f }" @click="format = f">
            复制为 {{ FORMAT_LABELS[f] }}
          </button>
        </div>
        <button class="btn small" :disabled="history.length === 0" @click="clearHistory">清空历史</button>
      </div>
      <div class="hlist">
        <div v-for="e in history" :key="e.id" class="hitem">
          <img v-if="e.thumb" class="thumb" :src="e.thumb" alt="" />
          <span v-else class="thumb ph">🖼️</span>
          <div class="meta">
            <span class="name" :title="e.filename">{{ e.filename }}</span>
            <span class="url" :title="e.url">{{ e.url }}</span>
            <span class="date">{{ formatDate(e.uploadedAt) }}<template v-if="e.bytes"> · {{ formatBytes(e.bytes) }}</template></span>
          </div>
          <div class="ops">
            <button class="btn small" title="复制当前格式链接" @click="copyEntryLink(e)">复制</button>
            <button class="btn small" title="在浏览器打开" @click="openUrl(e.url)">打开</button>
            <button class="btn small danger" title="删除该记录" @click="deleteEntry(e.id)">删除</button>
          </div>
        </div>
        <p v-if="history.length === 0" class="muted empty">暂无上传历史，去「上传」页传一张试试</p>
      </div>
    </template>

    <Transition name="fade">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </Transition>
  </div>
</template>

<style scoped>
.image-bed {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 13px;
  min-height: 0;
  position: relative;
}
.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.seg {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.seg button {
  border: none;
  background: var(--bg-raised);
  color: var(--fg-dim);
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.seg button.active {
  background: var(--accent-dim);
  color: var(--accent);
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--bg);
}
.btn.active {
  border-color: var(--accent);
  color: var(--accent);
}
.btn.small {
  padding: 2px 8px;
}
.btn.danger {
  color: var(--danger);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.spacer {
  flex: 1;
}
.provider {
  color: var(--fg-dim);
  font-size: 12px;
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dropzone {
  flex: none;
  border: 1.5px dashed var(--border);
  border-radius: 8px;
  padding: 18px 12px;
  text-align: center;
  cursor: pointer;
}
.dropzone.over {
  border-color: var(--accent);
  background: var(--accent-dim);
}
.dz-title {
  margin: 0 0 4px;
  color: var(--fg);
  font-size: 14px;
}
.dz-hint {
  margin: 0 0 10px;
  color: var(--fg-dim);
  font-size: 12px;
}
.dz-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}
.pending {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}
.phead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--fg-dim);
  font-size: 12px;
}
.plist {
  max-height: 130px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pitem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-raised);
}
.pitem.error {
  border-color: var(--danger);
}
.thumb {
  width: 28px;
  height: 28px;
  object-fit: cover;
  border-radius: 4px;
  flex: none;
}
.thumb.ph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  border: 1px solid var(--border);
}
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.size,
.status {
  color: var(--fg-dim);
  font-size: 12px;
  flex: none;
}
.status.err {
  color: var(--danger);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.result {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-raised);
}
.result .link {
  margin: 0;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--accent);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  word-break: break-all;
  user-select: text;
  max-height: 72px;
  overflow-y: auto;
}
.result .ops {
  display: flex;
  gap: 8px;
}
.hhead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: none;
}
.hlist {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.hitem {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-raised);
}
.hitem .thumb {
  width: 36px;
  height: 36px;
}
.hitem .meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.hitem .name {
  color: var(--fg);
  font-size: 12px;
  flex: none;
  max-width: 200px;
}
.hitem .url {
  color: var(--accent);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: text;
}
.hitem .date {
  color: var(--fg-dim);
  font-size: 11px;
}
.hitem .ops {
  display: flex;
  gap: 6px;
  flex: none;
}
.muted {
  color: var(--fg-dim);
  margin: 0;
}
.empty {
  text-align: center;
  padding: 24px 0;
}
.toast {
  position: absolute;
  left: 50%;
  bottom: 10px;
  transform: translateX(-50%);
  background: var(--accent-dim);
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 6px;
  padding: 5px 14px;
  font-size: 12px;
  pointer-events: none;
  z-index: 5;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
