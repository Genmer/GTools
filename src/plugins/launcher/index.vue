<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PluginContext } from '@sdk/api'
import { filterApps } from './match'
import { DEMO_APPS } from './demo'
import { parseCache, type AppEntry } from './types'

const props = defineProps<{ ctx: PluginContext; query: string; initialCommand?: string }>()

// demo 态（initialCommand === 'demo'）：稳定示例列表、不启动 backend、不扫描本机（截图/新手引导用）
const isDemo = computed(() => props.initialCommand === 'demo')

const apps = ref<AppEntry[]>([])
const scannedAt = ref<number | null>(null)
const status = ref<'idle' | 'scanning' | 'error'>('idle')
const errorMsg = ref('')
const selected = ref(0)
const launching = ref(false)
const listRef = ref<HTMLElement | null>(null)
const offs: (() => void)[] = []

const results = computed(() => filterApps(props.query, apps.value))
const visible = computed(() => results.value.slice(0, 50))

const emptyText = computed(() => {
  if (apps.value.length === 0) {
    return status.value === 'scanning' ? '正在扫描本机应用…' : '暂无应用数据，点击「刷新」扫描'
  }
  return '无匹配应用'
})

watch(
  () => props.query,
  () => {
    selected.value = 0
  }
)
watch(selected, async () => {
  await nextTick()
  listRef.value?.querySelector(`[data-i="${selected.value}"]`)?.scrollIntoView({ block: 'nearest' })
})

function badge(name: string): string {
  const ch = name.trim()[0] ?? '?'
  return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

async function loadFromCache(): Promise<void> {
  try {
    const cache = parseCache(await props.ctx.host.storage.get('apps'))
    if (cache !== null) {
      apps.value = cache.apps
      scannedAt.value = cache.scannedAt
    } else {
      status.value = 'scanning' // 无缓存：backend start 时的补扫正在进行
    }
  } catch (err) {
    status.value = 'error'
    errorMsg.value = `读取缓存失败：${err instanceof Error ? err.message : String(err)}`
  }
}

async function launch(app: AppEntry): Promise<void> {
  if (isDemo.value) {
    await props.ctx.host.notification.show('示例条目', `「${app.name}」为演示数据，仅展示样式；真实启动请在主窗口输入 app 关键词`)
    return
  }
  if (launching.value) return
  launching.value = true
  try {
    // darwin 上 Electron shell 即系统 open 语义（.app 目录 / win32 .lnk 均可直接启动），无需手写 child_process
    await props.ctx.host.shell.openPath(app.path)
    await props.ctx.host.window.hide()
  } catch (err) {
    status.value = 'error'
    errorMsg.value = `启动失败：${err instanceof Error ? err.message : String(err)}`
    try {
      await props.ctx.host.notification.show('应用启动失败', `${app.name}：${errorMsg.value}`)
    } catch {
      // 通知失败不影响界面错误提示
    }
  } finally {
    launching.value = false
  }
}

function requestRescan(): void {
  if (isDemo.value) return // demo 态没有 backend，刷新按钮保持展示不触发扫描
  status.value = 'scanning'
  void props.ctx.host.storage.set('scanRequest', Date.now())
}

function move(dir: 1 | -1): void {
  const n = visible.value.length
  if (n === 0) return
  selected.value = (selected.value + dir + n) % n
}

// 插件模式下外壳 SearchBox 不转发 Enter/方向键（仅 global 模式），列表导航由插件自治监听
function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing) return // 输入法组合态的 Enter/方向键用于选词，不启动应用
  if ((e.target as HTMLElement).tagName === 'BUTTON') return
  if (e.key === 'Enter') {
    e.preventDefault()
    const item = visible.value[selected.value]
    if (item) void launch(item.app)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  if (isDemo.value) {
    // demo 态：填充稳定示例列表，不启动 backend、不读缓存、不订阅扫描事件
    apps.value = DEMO_APPS
    scannedAt.value = Date.now()
    return
  }
  // 宿主只在全球词条选中路径调 plugin:enter；直接敲关键字进入时在此自报（ensureBackendStarted 幂等）
  void window.gtools.host('plugin:enter', { id: props.ctx.manifest.id })
  void loadFromCache()
  offs.push(
    props.ctx.host.events.on('scan-started', () => {
      status.value = 'scanning'
    }),
    props.ctx.host.events.on('scan-done', (p) => {
      const d = p as { apps: AppEntry[]; scannedAt: number }
      apps.value = d.apps
      scannedAt.value = d.scannedAt
      status.value = 'idle'
      selected.value = 0
    }),
    props.ctx.host.events.on('scan-error', (p) => {
      status.value = 'error'
      errorMsg.value = `扫描失败：${(p as { message?: string }).message ?? '未知错误'}`
    })
  )
})

onBeforeUnmount(() => {
  for (const off of offs) off()
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="launcher">
    <div v-if="isDemo" class="demo-banner">示例数据 · 演示模式（不扫描本机）</div>
    <div class="statusbar">
      <span v-if="apps.length > 0" class="count">{{ apps.length }} 个应用</span>
      <span v-if="scannedAt !== null" class="time">扫描于 {{ formatTime(scannedAt) }}</span>
      <span v-if="status === 'scanning'" class="scanning">扫描中…</span>
      <span v-else-if="status === 'error'" class="err">{{ errorMsg }}</span>
      <button class="refresh" :disabled="status === 'scanning'" @click="requestRescan">刷新</button>
    </div>
    <div ref="listRef" class="list">
      <div
        v-for="(item, i) in visible"
        :key="item.app.path"
        class="item"
        :class="{ active: i === selected }"
        :data-i="i"
        @click="launch(item.app)"
        @mouseenter="selected = i"
      >
        <span class="badge">{{ badge(item.app.name) }}</span>
        <span class="name">{{ item.app.name }}</span>
        <span class="path">{{ item.app.path }}</span>
      </div>
      <div v-if="visible.length === 0" class="empty">{{ emptyText }}</div>
    </div>
  </div>
</template>

<style scoped>
.launcher {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.demo-banner {
  flex: none;
  margin: var(--sp-1) 10px 0;
  padding: var(--sp-1) var(--sp-3);
  background: var(--accent-dim);
  color: var(--accent);
  border-radius: var(--r-sm);
  font-size: var(--fs-foot);
  text-align: center;
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
.scanning {
  color: var(--accent);
}
.err {
  color: var(--danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  cursor: pointer;
  user-select: none;
}
.item.active {
  background: var(--accent-dim);
}
.badge {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: var(--accent-dim);
  color: var(--accent);
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.name {
  flex: none;
  color: var(--fg);
  font-size: 15px;
}
.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fg-dim);
  font-size: 12px;
  text-align: right;
}
.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--fg-dim);
  font-size: 14px;
}
</style>
