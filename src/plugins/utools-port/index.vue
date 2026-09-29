<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

// uTools 插件清单归一化结构（主进程 utools-compat.ts 的 scan 产物），插件目录内自持一份只读形状
interface UtoolsFeature {
  code: string
  explain: string
  cmds: string[]
}
interface UtoolsManifest {
  name: string
  description: string
  version: string
  main: string
  logo: string
  preload?: string
  features: UtoolsFeature[]
}
interface ScanEntry {
  id: string
  manifest?: UtoolsManifest
  error?: string
}
interface HostResult {
  ok: boolean
  data?: unknown
  error?: string
}

const view = ref<'manage' | 'container'>('manage')
const entries = ref<ScanEntry[]>([])
const listError = ref('')
const loading = ref(false)

const activeId = ref('')
const activeName = ref('')
const activeUrl = ref('')
const activeOrigin = ref('')
const enterCode = ref('main')
const iframeRef = ref<HTMLIFrameElement | null>(null)

const usable = computed(() => entries.value.filter((e) => e.manifest !== undefined))
const broken = computed(() => entries.value.filter((e) => e.manifest === undefined))

// 徽标依据：清单声明了 preload 即标受限（POC 不执行 preload.js，Node 能力缺失）
function needsNode(entry: ScanEntry): boolean {
  return (entry.manifest?.preload ?? '') !== ''
}
const activeRestricted = computed(() => {
  const e = entries.value.find((x) => x.id === activeId.value)
  return e !== undefined && needsNode(e)
})

function badge(entry: ScanEntry): string {
  const ch = (entry.manifest?.name ?? entry.id).trim()[0] ?? '?'
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch
}

// commandId 形如 '<dirId>/<code>'：目录名不含 '/'，按首个 '/' 切分无歧义。
// 渲染层 core/utools-entries.ts 有同款，插件视图规约禁 import 宿主 core，自持一份
function parseCommandId(v: string): { id: string; code: string } | null {
  const i = v.indexOf('/')
  if (i <= 0 || i === v.length - 1) return null
  return { id: v.slice(0, i), code: v.slice(i + 1) }
}

async function refresh(): Promise<void> {
  loading.value = true
  try {
    const r = (await window.gtools.host('utools:list')) as HostResult
    if (!r.ok) {
      listError.value = r.error ?? '扫描失败'
      return
    }
    listError.value = ''
    entries.value = (r.data ?? []) as ScanEntry[]
  } finally {
    loading.value = false
  }
}

async function open(entry: ScanEntry, code?: string): Promise<void> {
  if (entry.manifest === undefined) return
  const r = (await window.gtools.host('utools:serve', { id: entry.id })) as HostResult & { data?: { url?: string } }
  const url = r.ok ? r.data?.url : undefined
  if (typeof url !== 'string' || url === '') {
    listError.value = r.error ?? '启动本地服务失败'
    return
  }
  activeId.value = entry.id
  activeName.value = entry.manifest.name
  activeUrl.value = url
  activeOrigin.value = new URL(url).origin
  enterCode.value = code ?? entry.manifest.features[0]?.code ?? 'main'
  view.value = 'container'
}

// 词条直达：initialCommand='<dirId>/<code>' 命中可用插件即进容器（code 不在清单回落 features[0]）；
// 解析不命中/目录已删→管理视图。同 dir+code 已打开则跳过（挂载态 watch 原位更新场景）
async function tryEnterFromCommand(): Promise<void> {
  // router.initialCommand 可为 null（管理入口/宿主命令），一并无 command 处理
  const parsed = props.initialCommand ? parseCommandId(props.initialCommand) : null
  if (parsed === null) return
  const entry = entries.value.find((e) => e.manifest !== undefined && e.id === parsed.id)
  if (entry === undefined || entry.manifest === undefined) return
  const code = entry.manifest.features.some((f) => f.code === parsed.code) ? parsed.code : undefined
  const effective = code ?? entry.manifest.features[0]?.code ?? 'main'
  if (view.value === 'container' && activeId.value === entry.id && enterCode.value === effective) return
  await open(entry, code)
}

watch(
  () => props.initialCommand,
  () => {
    void tryEnterFromCommand()
  }
)

// 离开容器广播 onPluginOut（isKill=false）：iframe 随视图销毁，广播要赶在卸载前发出
function notifyOut(): void {
  iframeRef.value?.contentWindow?.postMessage({ source: 'gtools-utools-host', type: 'gtools:out' }, activeOrigin.value)
}

function back(): void {
  notifyOut()
  view.value = 'manage'
  activeUrl.value = ''
  activeOrigin.value = ''
  activeId.value = ''
  void window.gtools.host('utools:stop')
}

// shim 请求桥：校验来源是本 iframe 且 origin 与 serve 返回一致，其余窗口/来源一概不认
function onMessage(e: MessageEvent): void {
  const frame = iframeRef.value
  if (frame === null || e.source !== frame.contentWindow || e.origin !== activeOrigin.value) return
  const d = e.data as { source?: string; action?: string; payload?: unknown; reqId?: string } | null
  if (d === null || typeof d !== 'object' || d.source !== 'gtools-utools-shim' || typeof d.action !== 'string') return
  void window.gtools
    .host('utools:api', { action: d.action, payload: d.payload ?? {} })
    .then((r: unknown) => {
      const res = r as { ok?: boolean; data?: unknown; error?: string }
      frame.contentWindow?.postMessage(
        { source: 'gtools-utools-host', reqId: d.reqId, ok: res.ok !== false, data: res.data, error: res.error },
        activeOrigin.value
      )
    })
}

// iframe load 完成时插件脚本（含 shim 注册）已执行，此时推进入事件；payload=搜索余文（uTools 语义），回调未注册即丢弃（POC 语义）
function onFrameLoad(): void {
  iframeRef.value?.contentWindow?.postMessage(
    { source: 'gtools-utools-host', type: 'gtools:enter', payload: { code: enterCode.value, type: 'main', payload: props.query } },
    activeOrigin.value
  )
}

onMounted(async () => {
  window.addEventListener('message', onMessage)
  await refresh()
  await tryEnterFromCommand()
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  // 容器开着时直接退出插件页：广播 onPluginOut 后停掉静态服务防泄漏
  if (view.value === 'container') {
    notifyOut()
    void window.gtools.host('utools:stop')
  }
})
</script>

<template>
  <div class="utools-port">
    <template v-if="view === 'manage'">
      <div class="statusbar">
        <span class="count">
          {{ usable.length }} 个插件<template v-if="broken.length > 0"> · {{ broken.length }} 个不可用</template>
        </span>
        <button class="refresh" :disabled="loading" @click="refresh">刷新</button>
      </div>
      <p v-if="listError !== ''" class="err">{{ listError }}</p>
      <div class="list">
        <div v-for="entry in usable" :key="entry.id" class="item">
          <span class="logo badge">{{ badge(entry) }}</span>
          <div class="meta">
            <div class="line">
              <span class="name">{{ entry.manifest?.name }}</span>
              <span v-if="entry.manifest?.version !== ''" class="ver">v{{ entry.manifest?.version }}</span>
              <span v-if="needsNode(entry)" class="restrict">功能受限（需 Node）</span>
            </div>
            <p class="desc">{{ entry.manifest?.description || '（无描述）' }}</p>
            <p class="dir">{{ entry.id }}</p>
          </div>
          <button class="open" @click="open(entry)">打开</button>
        </div>
        <div v-for="entry in broken" :key="entry.id" class="item broken">
          <span class="logo badge">!</span>
          <div class="meta">
            <div class="line">
              <span class="name">{{ entry.id }}</span>
            </div>
            <p class="desc">{{ entry.error }}</p>
          </div>
        </div>
        <div v-if="entries.length === 0 && !loading" class="empty">
          <p class="big">🧩 还没有可运行的 uTools 插件</p>
          <p class="dim">把 uTools 插件整个目录拷进 userData/utools-plugins/ 下，回到本页点「刷新」</p>
          <p class="dim">POC 仅运行页面主体：不执行插件 preload.js，只提供白名单 API（onPluginEnter / onPluginOut / copyText / notify / hideMainWindow）</p>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="toolbar">
        <button class="back" @click="back">← 返回</button>
        <span class="title">{{ activeName }}</span>
      </div>
      <div class="notice">POC：不执行 preload.js，仅支持白名单 API<template v-if="activeRestricted"> · 功能受限（需 Node）</template></div>
      <!-- 插件页与宿主跨源，clipboard-write 默认 allowlist=self 会被 permissions policy 拦截；uTools 语义下插件可写剪贴板，显式委托。
           sandbox 保留自身 origin（allow-same-origin）维持 localStorage 等能力，但与宿主跨源，allow-scripts+allow-same-origin 的逃逸组合不成立 -->
      <iframe
        v-if="activeUrl !== ''"
        ref="iframeRef"
        class="frame"
        :src="activeUrl"
        :data-plugin="activeId"
        sandbox="allow-scripts allow-forms allow-same-origin"
        allow="clipboard-write"
        @load="onFrameLoad"
      ></iframe>
    </template>
  </div>
</template>

<style scoped>
.utools-port {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.statusbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--fg-dim);
  font-size: 12px;
  min-height: 30px;
}
.count {
  color: var(--fg);
}
.refresh {
  margin-left: auto;
  border: none;
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: 6px;
  padding: 3px 12px;
  font-size: 12px;
  cursor: pointer;
}
.refresh:disabled {
  opacity: 0.5;
  cursor: default;
}
.err {
  flex: none;
  margin: 6px 14px 0;
  color: var(--danger);
  font-size: var(--fs-sub);
}
.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 6px;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
}
.item:hover {
  background: var(--hover);
}
.item.broken {
  opacity: 0.55;
}
.logo {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: var(--r-md);
}
.logo.badge {
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.meta {
  flex: 1;
  min-width: 0;
}
.line {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.name {
  color: var(--fg);
  font-size: 14px;
}
.ver {
  color: var(--fg-dim);
  font-size: var(--fs-foot);
}
.restrict {
  flex: none;
  padding: 1px 8px;
  border-radius: var(--r-sm);
  background: var(--tile-amber-bg);
  color: var(--tile-amber-fg);
  font-size: var(--fs-foot);
}
.desc {
  margin: 2px 0 0;
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dir {
  margin: 2px 0 0;
  color: var(--fg-dim);
  font-size: var(--fs-foot);
  opacity: 0.7;
}
.open {
  flex: none;
  border: none;
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: 6px;
  padding: 4px 14px;
  font-size: 12px;
  cursor: pointer;
}
.empty {
  padding: 32px 16px;
  text-align: center;
}
.empty .big {
  color: var(--fg);
  font-size: 15px;
  margin: 0 0 8px;
}
.empty .dim {
  color: var(--fg-dim);
  font-size: var(--fs-sub);
  margin: 4px 0;
}
.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  min-height: 30px;
}
.back {
  border: none;
  background: var(--bg-raised);
  color: var(--fg);
  border-radius: var(--r-sm);
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}
.back:hover {
  background: var(--hover);
}
.title {
  color: var(--fg);
  font-size: 13px;
}
.notice {
  flex: none;
  margin: 6px 10px 0;
  padding: 4px 10px;
  background: var(--tile-amber-bg);
  color: var(--tile-amber-fg);
  border-radius: var(--r-sm);
  font-size: var(--fs-foot);
  text-align: center;
}
.frame {
  flex: 1;
  min-height: 0;
  margin: 6px 10px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--bg);
}
</style>
