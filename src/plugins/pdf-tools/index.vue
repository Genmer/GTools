<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import {
  baseName,
  fileNameOf,
  formatBytes,
  isLargeFile,
  joinPath,
  parsePageRanges,
  parseRangeGroups
} from './logic/pages'
import {
  base64ToBytes,
  bytesToBase64,
  deletePages,
  extractPages,
  imagesToPdf,
  mergePdfs,
  readPageCount,
  rotatePages,
  type ImageKind
} from './logic/pdf-ops'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

type FileKind = 'pdf' | 'image'

interface FileItem {
  id: string
  name: string
  path: string
  size: number
  kind: FileKind
  pageCount: number | null
  demo: boolean
  error: string
}

type OpId = 'merge' | 'split' | 'rotate' | 'delete' | 'extract' | 'images'

const OP_TABS: { id: OpId; label: string }[] = [
  { id: 'merge', label: '合并' },
  { id: 'split', label: '拆分' },
  { id: 'rotate', label: '旋转' },
  { id: 'delete', label: '删页' },
  { id: 'extract', label: '提取页' },
  { id: 'images', label: '图片转 PDF' }
]

const OP_HINTS: Record<OpId, string> = {
  merge: '把左侧列表中的 PDF 按当前顺序合并为一个文件（至少 2 个）。',
  split: '把当前选中的 PDF 拆成多个文件：按范围分组，或每页一文件。',
  rotate: '旋转当前选中的 PDF 的全部或指定页，导出为新文件。',
  delete: '删除当前选中的 PDF 的指定页，其余页保留为新文件。',
  extract: '把当前选中的 PDF 的指定页提取为一个新文件。',
  images: '把左侧列表中的图片（png / jpg）按顺序合成一个 PDF，页面尺寸与图片一致。'
}

const EXEC_LABEL: Record<OpId, string> = {
  merge: '合并并导出',
  split: '拆分并导出',
  rotate: '旋转并导出',
  delete: '删除并导出',
  extract: '提取并导出',
  images: '合成并导出'
}

// 外壳搜索框 keyword 后的剩余输入直达操作面板（如「pdf 合并」）
const OP_ALIASES: Record<OpId, string[]> = {
  merge: ['合并', 'hebing', 'merge'],
  split: ['拆', 'chaifen', 'split'],
  rotate: ['旋转', 'xuanzhuan', 'rotate'],
  delete: ['删', 'shanchu', 'delete'],
  extract: ['提取', 'tiqu', 'extract'],
  images: ['图片', 'tupian', 'image']
}

const isDemo = props.initialCommand === 'demo'
let seq = 0
const nextId = (): string => `f${++seq}`

const files = ref<FileItem[]>([])
// 文件字节不进响应式：Proxy 包住大数组会拖垮渲染，元数据与内容分离存放
const bytesById = new Map<string, Uint8Array>()

if (isDemo) {
  files.value = [
    {
      id: nextId(),
      name: '产品说明书-示例.pdf',
      path: '~/Documents/示例/产品说明书.pdf',
      size: 2_411_520,
      kind: 'pdf',
      pageCount: 12,
      demo: true,
      error: ''
    },
    {
      id: nextId(),
      name: '合同扫描件-示例.pdf',
      path: '~/Documents/示例/合同扫描件.pdf',
      size: 6_291_456,
      kind: 'pdf',
      pageCount: 5,
      demo: true,
      error: ''
    }
  ]
}

const op = ref<OpId>('merge')
const selectedId = ref<string | null>(files.value[0]?.id ?? null)
const busy = ref(false)
const dragOver = ref(false)
const confirmingClear = ref(false)

interface Status {
  kind: 'ok' | 'warn' | 'error'
  text: string
}
const status = ref<Status | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined

const splitMode = ref<'ranges' | 'each'>('ranges')
const splitRange = ref('')
const rotateScope = ref<'all' | 'pages'>('all')
const rotatePagesInput = ref('')
const rotateDelta = ref<number>(90)
const deleteRange = ref('')
const extractRange = ref('')

const validPdfs = computed(() => files.value.filter((f) => f.kind === 'pdf' && f.error === ''))
const validImages = computed(() => files.value.filter((f) => f.kind === 'image' && f.error === ''))
const realPdfs = computed(() => validPdfs.value.filter((f) => !f.demo))
const realImages = computed(() => validImages.value.filter((f) => !f.demo))
const current = computed(
  () => validPdfs.value.find((f) => f.id === selectedId.value) ?? validPdfs.value[0] ?? null
)
const hasLargeFile = computed(() => files.value.some((f) => isLargeFile(f.size)))
const demoCardsShown = computed(() => files.value.some((f) => f.demo))
// 左栏计数含示例、右侧操作数排除示例，demo 态两处都显式标注口径，避免「2 vs 0」误读
const demoMixedNote = computed(() => (demoCardsShown.value ? '，示例不计入' : ''))
const demoPdfCount = computed(() => files.value.filter((f) => f.demo && f.kind === 'pdf').length)

const opReady = computed<Record<OpId, boolean>>(() => ({
  merge: realPdfs.value.length >= 2,
  split: current.value !== null && !current.value.demo,
  rotate: current.value !== null && !current.value.demo,
  delete: current.value !== null && !current.value.demo,
  extract: current.value !== null && !current.value.demo,
  images: realImages.value.length >= 1
}))

watch(
  () => props.query,
  (q) => {
    const t = q.trim().toLowerCase()
    if (t === '') return
    for (const tab of OP_TABS) {
      if (OP_ALIASES[tab.id].some((a) => t.includes(a.toLowerCase()))) {
        op.value = tab.id
        return
      }
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (flashTimer !== undefined) clearTimeout(flashTimer)
})

function flash(kind: 'ok' | 'warn', text: string): void {
  status.value = { kind, text }
  if (flashTimer !== undefined) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (status.value = null), 5000)
}

function showError(text: string): void {
  if (flashTimer !== undefined) clearTimeout(flashTimer)
  status.value = { kind: 'error', text }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function kindOfPath(path: string): FileKind | null {
  const lower = path.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image'
  return null
}

function selectItem(f: FileItem): void {
  if (f.kind === 'pdf' && f.error === '') selectedId.value = f.id
}

async function addPaths(paths: string[], needsGrant: boolean): Promise<void> {
  if (paths.length === 0) return
  const skipped: string[] = []
  const supported = paths.filter((p) => {
    if (kindOfPath(p) === null) {
      skipped.push(fileNameOf(p))
      return false
    }
    return true
  })
  // demo 态加入首个真实文件时撤下示例卡片，避免示例混入真实操作对象；全部不支持则保留示例
  if (
    supported.length > 0 &&
    files.value.some((f) => f.demo) &&
    !files.value.some((f) => !f.demo)
  ) {
    files.value = []
  }
  if (supported.length > 0 && needsGrant) {
    try {
      await props.ctx.host.fs.grant(supported)
    } catch (err) {
      showError(`拖入文件授权失败：${errMsg(err)}`)
      return
    }
  }
  for (const p of supported) {
    const kind = kindOfPath(p)
    if (kind === null) continue
    const item: FileItem = {
      id: nextId(),
      name: fileNameOf(p),
      path: p,
      size: 0,
      kind,
      pageCount: null,
      demo: false,
      error: ''
    }
    try {
      const st = await props.ctx.host.fs.stat(p)
      if (st === null || !st.isFile) throw new Error('不是有效文件')
      item.size = st.size
      // 图片也要在加入时读入字节，否则合成 PDF 时 bytesOf 取不到内容
      const bytes = base64ToBytes(await props.ctx.host.fs.read(p, { encoding: 'base64' }))
      if (kind === 'pdf') item.pageCount = await readPageCount(bytes)
      bytesById.set(item.id, bytes)
    } catch (err) {
      const m = errMsg(err)
      item.error = /encrypt/i.test(m) ? '无法读取：文件已加密' : `无法读取：${m}`
    }
    files.value.push(item)
    if (selectedId.value === null && kind === 'pdf' && item.error === '') selectedId.value = item.id
  }
  if (skipped.length > 0) flash('warn', `已跳过不支持的文件：${skipped.join('、')}`)
}

async function pickFiles(): Promise<void> {
  try {
    const paths = await props.ctx.host.dialog.openFile({
      title: '选择 PDF 或图片文件',
      multiple: true,
      filters: [
        { name: 'PDF 与图片', extensions: ['pdf', 'png', 'jpg', 'jpeg'] },
        { name: 'PDF', extensions: ['pdf'] },
        { name: '图片', extensions: ['png', 'jpg', 'jpeg'] }
      ]
    })
    await addPaths(paths, false)
  } catch (err) {
    showError(errMsg(err))
  }
}

function onDrop(e: DragEvent): void {
  dragOver.value = false
  const list = Array.from(e.dataTransfer?.files ?? [])
  if (list.length === 0) return
  // pathForFile 必须在 drop 事件同步上下文里取（webUtils 限制）
  void addPaths(
    list.map((f) => window.gtools.pathForFile(f)),
    true
  )
}

function moveItem(id: string, delta: -1 | 1): void {
  const idx = files.value.findIndex((f) => f.id === id)
  const to = idx + delta
  if (idx < 0 || to < 0 || to >= files.value.length) return
  const list = [...files.value]
  const tmp = list[idx]
  list[idx] = list[to]
  list[to] = tmp
  files.value = list
}

function removeItem(id: string): void {
  files.value = files.value.filter((f) => f.id !== id)
  bytesById.delete(id)
  if (selectedId.value === id) {
    selectedId.value = files.value.find((f) => f.kind === 'pdf' && f.error === '')?.id ?? null
  }
}

function clearAll(): void {
  confirmingClear.value = false
  files.value = []
  bytesById.clear()
  selectedId.value = null
  status.value = null
}

function bytesOf(f: FileItem): Uint8Array {
  const b = bytesById.get(f.id)
  if (b === undefined) throw new Error(`文件内容未加载：${f.name}`)
  return b
}

function imageKindOf(name: string): ImageKind {
  return name.toLowerCase().endsWith('.png') ? 'png' : 'jpg'
}

async function pickSavePath(defaultName: string): Promise<string | null> {
  return props.ctx.host.dialog.saveFile({
    title: '导出 PDF',
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
}

async function writePdf(path: string, bytes: Uint8Array): Promise<void> {
  await props.ctx.host.fs.write(path, bytesToBase64(bytes), { encoding: 'base64' })
}

function requirePages(input: string, pageCount: number): number[] | null {
  const r = parsePageRanges(input, pageCount)
  if (!r.ok) {
    showError(r.error)
    return null
  }
  return r.data
}

async function runMerge(): Promise<void> {
  const docs = realPdfs.value
  if (docs.length < 2) {
    showError('合并至少需要 2 个可读取的 PDF')
    return
  }
  busy.value = true
  try {
    const out = await mergePdfs(docs.map((f) => bytesOf(f)))
    const target = await pickSavePath(`合并-${docs.length}个文件.pdf`)
    if (target === null) return
    await writePdf(target, out)
    flash('ok', `已合并 ${docs.length} 个文件（共 ${await readPageCount(out)} 页）→ ${target}`)
  } catch (err) {
    showError(errMsg(err))
  } finally {
    busy.value = false
  }
}

async function runSplit(): Promise<void> {
  const f = current.value
  if (f === null || f.demo || f.pageCount === null) return
  const base = baseName(f.name)
  const src = bytesOf(f)
  busy.value = true
  try {
    let groups: { label: string; pages: number[] }[]
    if (splitMode.value === 'each') {
      groups = Array.from({ length: f.pageCount }, (_, i) => ({
        label: `第${i + 1}页`,
        pages: [i + 1]
      }))
    } else {
      const r = parseRangeGroups(splitRange.value, f.pageCount)
      if (!r.ok) {
        showError(r.error)
        return
      }
      groups = r.data
    }
    const [dir] = await props.ctx.host.dialog.openFile({
      title: '选择拆分文件保存位置',
      directory: true
    })
    if (dir === undefined) return
    for (const g of groups) {
      await writePdf(joinPath(dir, `${base}_${g.label}.pdf`), await extractPages(src, g.pages))
    }
    flash('ok', `已拆分为 ${groups.length} 个文件 → ${dir}`)
  } catch (err) {
    showError(errMsg(err))
  } finally {
    busy.value = false
  }
}

async function runRotate(): Promise<void> {
  const f = current.value
  if (f === null || f.demo || f.pageCount === null) return
  let targets: number[] | 'all' = 'all'
  if (rotateScope.value === 'pages') {
    const pages = requirePages(rotatePagesInput.value, f.pageCount)
    if (pages === null) return
    targets = pages
  }
  busy.value = true
  try {
    const out = await rotatePages(bytesOf(f), targets, rotateDelta.value)
    const target = await pickSavePath(`${baseName(f.name)}_旋转.pdf`)
    if (target === null) return
    await writePdf(target, out)
    flash('ok', `已旋转并导出（${rotateDelta.value > 0 ? '+' : ''}${rotateDelta.value}°）→ ${target}`)
  } catch (err) {
    showError(errMsg(err))
  } finally {
    busy.value = false
  }
}

async function runDelete(): Promise<void> {
  const f = current.value
  if (f === null || f.demo || f.pageCount === null) return
  const pages = requirePages(deleteRange.value, f.pageCount)
  if (pages === null) return
  const dropped = new Set(pages).size
  if (dropped >= f.pageCount) {
    showError('不能删除全部页面（至少保留 1 页）')
    return
  }
  busy.value = true
  try {
    const out = await deletePages(bytesOf(f), pages)
    const target = await pickSavePath(`${baseName(f.name)}_删页后.pdf`)
    if (target === null) return
    await writePdf(target, out)
    flash('ok', `已删除 ${dropped} 页（保留 ${f.pageCount - dropped} 页）→ ${target}`)
  } catch (err) {
    showError(errMsg(err))
  } finally {
    busy.value = false
  }
}

async function runExtract(): Promise<void> {
  const f = current.value
  if (f === null || f.demo || f.pageCount === null) return
  const pages = requirePages(extractRange.value, f.pageCount)
  if (pages === null) return
  busy.value = true
  try {
    const out = await extractPages(bytesOf(f), pages)
    const target = await pickSavePath(`${baseName(f.name)}_提取.pdf`)
    if (target === null) return
    await writePdf(target, out)
    flash('ok', `已提取 ${pages.length} 页 → ${target}`)
  } catch (err) {
    showError(errMsg(err))
  } finally {
    busy.value = false
  }
}

async function runImages(): Promise<void> {
  const imgs = realImages.value
  if (imgs.length === 0) {
    showError('请先在左侧添加 png / jpg 图片')
    return
  }
  busy.value = true
  try {
    const out = await imagesToPdf(imgs.map((f) => ({ kind: imageKindOf(f.name), bytes: bytesOf(f) })))
    const target = await pickSavePath('图片合成.pdf')
    if (target === null) return
    await writePdf(target, out)
    flash('ok', `已把 ${imgs.length} 张图片合成 PDF → ${target}`)
  } catch (err) {
    showError(errMsg(err))
  } finally {
    busy.value = false
  }
}

const RUNNERS: Record<OpId, () => Promise<void>> = {
  merge: runMerge,
  split: runSplit,
  rotate: runRotate,
  delete: runDelete,
  extract: runExtract,
  images: runImages
}

async function run(): Promise<void> {
  if (busy.value || !opReady.value[op.value]) return
  await RUNNERS[op.value]()
}

function notReadyText(): string {
  if (demoCardsShown.value) return '示例数据仅展示布局，添加真实文件后即可执行'
  switch (op.value) {
    case 'merge':
      return '至少加入 2 个可读取的 PDF'
    case 'images':
      return '请先在左侧加入 png / jpg 图片'
    default:
      return '请先在左侧加入可读取的 PDF'
  }
}
</script>

<template>
  <div class="pdf-tools">
    <div v-if="isDemo" class="demo-banner">
      示例模式：以下为演示数据（卡片带「示例」标记），用于查看布局；添加真实文件后自动进入可操作状态。
    </div>

    <div class="layout">
      <aside class="files">
        <div
          class="drop"
          :class="{ over: dragOver }"
          @dragover.prevent="dragOver = true"
          @dragenter.prevent="dragOver = true"
          @dragleave.prevent="dragOver = false"
          @drop.prevent="onDrop"
        >
          <div class="drop-icon">📄</div>
          <p class="drop-title">拖入 PDF / 图片</p>
          <p class="drop-sub">支持 pdf · png · jpg，可多选</p>
          <button class="btn primary" @click="pickFiles">选择文件…</button>
        </div>

        <div v-if="files.length > 0" class="list-head">
          <span class="count">
            PDF {{ validPdfs.length }}<template v-if="demoPdfCount > 0">（含示例 {{ demoPdfCount }}）</template>
            · 图片 {{ validImages.length }}
          </span>
          <template v-if="confirmingClear">
            <button class="link danger" @click="clearAll">确认清空</button>
            <button class="link" @click="confirmingClear = false">取消</button>
          </template>
          <button v-else class="link" @click="confirmingClear = true">清空</button>
        </div>

        <div class="list">
          <div
            v-for="(f, i) in files"
            :key="f.id"
            class="card"
            :class="{ selected: f.id === current?.id, broken: f.error !== '' }"
            @click="selectItem(f)"
          >
            <span class="card-icon">{{ f.kind === 'pdf' ? '📄' : '🖼️' }}</span>
            <div class="card-main">
              <div class="card-name" :title="f.path">{{ f.name }}</div>
              <div class="card-meta">
                <span v-if="f.error !== ''" class="err-text">{{ f.error }}</span>
                <template v-else>
                  <span v-if="f.kind === 'pdf'">{{ f.pageCount }} 页</span>
                  <span>{{ formatBytes(f.size) }}</span>
                  <span v-if="isLargeFile(f.size)" class="big-tag">大文件</span>
                  <span v-if="f.demo" class="demo-tag">示例</span>
                </template>
              </div>
            </div>
            <div class="card-ops" @click.stop>
              <button class="icon-btn" :disabled="i === 0" title="上移" @click="moveItem(f.id, -1)">↑</button>
              <button
                class="icon-btn"
                :disabled="i === files.length - 1"
                title="下移"
                @click="moveItem(f.id, 1)"
              >
                ↓
              </button>
              <button class="icon-btn danger" title="移除" @click="removeItem(f.id)">×</button>
            </div>
          </div>
        </div>

        <p v-if="hasLargeFile" class="large-hint">含超过 20 MB 的大文件，处理时可能需要数秒，请稍候</p>
      </aside>

      <section class="ops">
        <div class="op-tabs" role="tablist">
          <button
            v-for="t in OP_TABS"
            :key="t.id"
            class="op-tab"
            :class="{ active: op === t.id }"
            role="tab"
            :aria-selected="op === t.id"
            @click="op = t.id"
          >
            {{ t.label }}
          </button>
        </div>

        <div class="panel">
          <p class="op-hint">{{ OP_HINTS[op] }}</p>

          <div v-if="op === 'merge'" class="params">
            <p class="param-line">
              参与合并的 PDF（{{ realPdfs.length }} 个{{ demoMixedNote }}）按左侧列表顺序排列；合并结果是全新文件，不改动原文件。
            </p>
          </div>

          <div v-else-if="op === 'split'" class="params">
            <div class="field">
              <label>拆分方式</label>
              <div class="seg">
                <button :class="{ on: splitMode === 'ranges' }" @click="splitMode = 'ranges'">
                  按范围分组
                </button>
                <button :class="{ on: splitMode === 'each' }" @click="splitMode = 'each'">
                  每页一文件
                </button>
              </div>
            </div>
            <div v-if="splitMode === 'ranges'" class="field">
              <label>范围分组（逗号分隔，每组一个文件）</label>
              <input
                v-model="splitRange"
                class="input mono"
                type="text"
                placeholder="如 1-3,5,8-10"
                spellcheck="false"
              />
            </div>
            <p v-if="current !== null" class="param-line">
              当前文件：{{ current.name }}（{{ current.pageCount }} 页）
            </p>
          </div>

          <div v-else-if="op === 'rotate'" class="params">
            <div class="field">
              <label>旋转对象</label>
              <div class="seg">
                <button :class="{ on: rotateScope === 'all' }" @click="rotateScope = 'all'">
                  全部页
                </button>
                <button :class="{ on: rotateScope === 'pages' }" @click="rotateScope = 'pages'">
                  指定页
                </button>
              </div>
            </div>
            <div v-if="rotateScope === 'pages'" class="field">
              <label>页码范围</label>
              <input
                v-model="rotatePagesInput"
                class="input mono"
                type="text"
                placeholder="如 1-3,5"
                spellcheck="false"
              />
            </div>
            <div class="field">
              <label>旋转角度</label>
              <select v-model.number="rotateDelta" class="input">
                <option :value="90">右转 90°</option>
                <option :value="-90">左转 90°</option>
                <option :value="180">旋转 180°</option>
              </select>
            </div>
          </div>

          <div v-else-if="op === 'delete'" class="params">
            <div class="field">
              <label>要删除的页码范围</label>
              <input
                v-model="deleteRange"
                class="input mono"
                type="text"
                placeholder="如 1-3,5"
                spellcheck="false"
              />
            </div>
            <p v-if="current !== null" class="param-line">
              当前文件：{{ current.name }}（{{ current.pageCount }} 页），删除后其余页保留为新文件。
            </p>
          </div>

          <div v-else-if="op === 'extract'" class="params">
            <div class="field">
              <label>要提取的页码范围</label>
              <input
                v-model="extractRange"
                class="input mono"
                type="text"
                placeholder="如 1-3,5"
                spellcheck="false"
              />
            </div>
            <p v-if="current !== null" class="param-line">
              当前文件：{{ current.name }}（{{ current.pageCount }} 页）
            </p>
          </div>

          <div v-else class="params">
            <p class="param-line">
              左侧图片（{{ realImages.length }} 张{{ demoMixedNote }}）按列表顺序合成，每张一页，页面尺寸与图片一致。
            </p>
          </div>

          <div class="run-row">
            <button class="btn primary run" :disabled="!opReady[op] || busy" @click="run">
              {{ busy ? '处理中…' : EXEC_LABEL[op] }}
            </button>
            <span v-if="!opReady[op]" class="not-ready">{{ notReadyText() }}</span>
          </div>
        </div>

        <div v-if="status !== null" class="status-bar" :class="status.kind">
          <span class="status-icon">{{ status.kind === 'ok' ? '✓' : status.kind === 'warn' ? '!' : '✕' }}</span>
          <span class="status-text" :title="status.text">{{ status.text }}</span>
          <button v-if="status.kind === 'error'" class="icon-btn" title="关闭" @click="status = null">×</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.pdf-tools {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  font-size: var(--fs-sub);
  color: var(--fg);
}
.demo-banner {
  flex: none;
  margin-bottom: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  background: var(--accent-dim);
  color: var(--accent);
  line-height: 1.6;
}
.layout {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: var(--sp-4);
}

/* 左栏：文件列表 */
.files {
  flex: none;
  width: 300px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: var(--sp-2);
}
.drop {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-1);
  border: 1.5px dashed var(--border);
  border-radius: var(--r-lg);
  padding: var(--sp-4) var(--sp-3);
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
}
.drop.over {
  border-color: var(--accent);
  background: var(--accent-dim);
}
.drop-icon {
  font-size: 22px;
  line-height: 1;
}
.drop-title {
  margin: var(--sp-1) 0 0;
  font-size: var(--fs-title);
}
.drop-sub {
  margin: 0 0 var(--sp-2);
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.list-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-1);
}
.count {
  flex: 1;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.list::-webkit-scrollbar {
  width: 6px;
}
.list::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
.card {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  background: var(--bg-raised);
  cursor: pointer;
}
.card:hover {
  background: var(--hover);
}
.card.selected {
  background: var(--active-row);
}
.card.selected .card-name {
  color: var(--accent);
}
.card.broken {
  cursor: default;
}
.card-icon {
  flex: none;
  font-size: 20px;
  line-height: 1;
}
.card-main {
  flex: 1;
  min-width: 0;
}
.card-name {
  font-size: var(--fs-title);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-meta {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-top: 2px;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  white-space: nowrap;
}
.err-text {
  color: var(--danger);
  overflow: hidden;
  text-overflow: ellipsis;
}
.big-tag {
  color: var(--warn);
}
.demo-tag {
  padding: 0 6px;
  border-radius: var(--r-sm);
  background: var(--accent-dim);
  color: var(--accent);
}
.card-ops {
  flex: none;
  display: flex;
  gap: 2px;
}
.large-hint {
  flex: none;
  margin: 0;
  color: var(--warn);
  font-size: var(--fs-foot);
}

/* 通用小控件 */
.btn {
  height: 32px;
  padding: 0 14px;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--fg);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.btn:hover:not(:disabled) {
  background: var(--hover);
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.btn.primary:hover:not(:disabled) {
  background: var(--accent);
  filter: brightness(1.1);
}
.btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.link {
  border: none;
  background: none;
  padding: 0;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  cursor: pointer;
}
.link:hover {
  color: var(--fg);
}
.link.danger {
  color: var(--danger);
}
.icon-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.icon-btn:hover:not(:disabled) {
  background: var(--hover);
  color: var(--fg);
}
.icon-btn.danger:hover {
  color: var(--danger);
}
.icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

/* 右栏：操作面板 */
.ops {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.op-tabs {
  flex: none;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
}
.op-tab {
  height: 32px;
  padding: 0 var(--sp-3);
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  cursor: pointer;
}
.op-tab:hover {
  background: var(--hover);
  color: var(--fg);
}
.op-tab.active {
  background: var(--active-row);
  color: var(--accent);
  font-weight: 600;
}
.panel {
  /* flex:1 撑满右栏剩余高度，600px 视口下不再下半屏空置 */
  flex: 1;
  border-radius: var(--r-lg);
  background: var(--bg-raised);
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.op-hint,
.param-line {
  margin: 0;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  line-height: 1.6;
}
.param-line b {
  color: var(--fg);
}
.params {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.field label {
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.input {
  height: 32px;
  box-sizing: border-box;
  width: 260px;
  max-width: 100%;
  padding: 0 var(--sp-3);
  border: none;
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--fg);
  font-size: var(--fs-sub);
  outline: none;
}
.input:focus {
  box-shadow: 0 0 0 2px var(--accent-dim);
}
.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.seg {
  display: inline-flex;
  gap: 2px;
  width: fit-content;
  padding: 2px;
  border-radius: var(--r-md);
  background: var(--bg);
}
.seg button {
  height: 26px;
  padding: 0 var(--sp-3);
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  cursor: pointer;
}
.seg button.on {
  background: var(--active-row);
  color: var(--accent);
}
.run-row {
  /* 面板被拉高时执行行沉底，与参数区拉开层次 */
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}
.not-ready {
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}

/* 页面内状态条：成功/提醒自动消失，错误常驻可手动关闭 */
.status-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  background: var(--bg-raised);
  font-size: var(--fs-sub);
}
.status-bar.ok {
  color: var(--ok);
}
.status-bar.warn {
  color: var(--warn);
}
.status-bar.error {
  color: var(--danger);
}
.status-icon {
  flex: none;
  font-weight: 600;
}
.status-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
