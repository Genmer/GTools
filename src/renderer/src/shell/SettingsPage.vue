<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import type { AppSettings, CommandHotkey, GlassMaterial, ThemeName, TransparencySettings } from '@sdk/settings'
import { validateAccelerator } from '@sdk/shortcut-rules'
import type { HostInitResult } from '../env'
import ApiServicesSection from './ApiServicesSection.vue'
import HotkeyRecorder from './HotkeyRecorder.vue'
import { warningsOf } from './settings-warnings'

const props = defineProps<{ settings: AppSettings | null; plugins: { manifest: PluginManifest; enabled: boolean }[] }>()

const opError = ref<string | null>(null)

const platform = computed(() => (navigator.userAgent.includes('Mac') ? 'darwin' : 'win32'))
const currentHotkey = computed(() => props.settings?.hotkey[platform.value] ?? '')
const themes: { id: ThemeName; label: string }[] = [
  { id: 'light', label: '白色' },
  { id: 'dark', label: '黑色' },
  { id: 'glass', label: '玻璃' }
]
const glassMaterials: { id: GlassMaterial; label: string }[] = [
  { id: 'clear', label: '清玻璃' },
  { id: 'wallpaper', label: '屏幕折射' },
  { id: 'acrylic', label: '亚克力' }
]

async function setTheme(theme: ThemeName): Promise<void> {
  const r = await window.gtools.host('settings:set', { theme })
  if (!r.ok) opError.value = r.error ?? '保存失败'
}

async function setGlassMaterial(glassMaterial: GlassMaterial): Promise<void> {
  const r = await window.gtools.host('settings:set', { glassMaterial })
  if (!r.ok) opError.value = r.error ?? '保存失败'
}

async function setTransparency(patch: Partial<TransparencySettings>): Promise<void> {
  const r = await window.gtools.host('settings:set', { transparency: patch })
  if (!r.ok) opError.value = r.error ?? '保存失败'
}

async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  const r = await window.gtools.host('settings:set', { launchAtLogin: enabled })
  if (!r.ok) opError.value = r.error ?? '保存失败'
}

async function setBehavior(field: 'clipboardSuggest' | 'hideOnBlur', enabled: boolean): Promise<void> {
  const r = await window.gtools.host('settings:set', { [field]: enabled })
  if (!r.ok) opError.value = r.error ?? '保存失败'
}

// 外部插件（userData/plugins/）宿主只做清单校验与检测提示，不提供启用/安装入口；仅设置态挂载时取一次
const loadIssues = ref<{ pluginId: string; message: string }[]>([])
const externalDetected = ref<{ id: string; name: string }[]>([])
const appVersion = ref('')

onMounted(async () => {
  const r = await window.gtools.host('app:init')
  if (!r.ok) return
  const d = r.data as HostInitResult
  appVersion.value = d.version
  loadIssues.value = d.loadIssues
  externalDetected.value = d.externalDetected
})

const globalHotkeyWarnings = ref<string[]>([])
const commandHotkeyWarnings = ref<string[]>([])

async function saveGlobalHotkey(accel: string): Promise<string | null> {
  globalHotkeyWarnings.value = []
  const r = await window.gtools.host('settings:set', { hotkey: { [platform.value]: accel } })
  if (!r.ok) return r.error ?? '注册失败'
  globalHotkeyWarnings.value = warningsOf(r)
  return null
}

// 主键录音预检：与指令热键撞键会让后者让位失效，录入期即拦住（主键自身无撞可查）
function globalConflict(accel: string): string | null {
  for (const h of props.settings?.commandHotkeys ?? []) {
    if (h[platform.value] === accel) return `与「${commandLabel(h)}」的指令热键冲突`
  }
  return null
}

// ---- 指令快捷键 ----
const cmdPluginId = ref('')
const cmdCommandId = ref('')
// 只为启用中的插件新建指令热键；禁用插件的既有绑定不删除，仅在列表标注
const commandPlugins = computed(() => props.plugins.filter((p) => p.enabled && (p.manifest.commands?.length ?? 0) > 0))
const selectedCommands = computed(
  () => commandPlugins.value.find((p) => p.manifest.id === cmdPluginId.value)?.manifest.commands ?? []
)

// 已卸载的插件不算「禁用」（label 已回退显示原始 id），不标注
function pluginEnabled(pluginId: string): boolean {
  const p = props.plugins.find((x) => x.manifest.id === pluginId)
  return p === undefined ? true : p.enabled
}

function commandLabel(h: CommandHotkey): string {
  const p = props.plugins.find((x) => x.manifest.id === h.pluginId)
  const c = p?.manifest.commands?.find((c) => c.id === h.commandId)
  return `${p?.manifest.name ?? h.pluginId} / ${c?.title ?? h.commandId}`
}

function commandConflict(accel: string): string | null {
  const main = props.settings?.hotkey[platform.value]
  if (main && main === accel) return `与全局快捷键 ${main} 冲突`
  for (const h of props.settings?.commandHotkeys ?? []) {
    if (h.pluginId === cmdPluginId.value && h.commandId === cmdCommandId.value) continue
    if (h[platform.value] === accel) return `与「${commandLabel(h)}」冲突`
  }
  return null
}

async function saveCommandHotkey(accel: string): Promise<string | null> {
  if (cmdPluginId.value === '' || cmdCommandId.value === '') return '请先选择插件与指令'
  // 下拉只列启用插件，但已选中的插件可能在保存前一刻被禁用
  if (!commandPlugins.value.some((p) => p.manifest.id === cmdPluginId.value)) return '该插件已禁用，请重新选择'
  const prev = props.settings?.commandHotkeys ?? []
  const old = prev.find((h) => h.pluginId === cmdPluginId.value && h.commandId === cmdCommandId.value)
  const item: CommandHotkey = {
    pluginId: cmdPluginId.value,
    commandId: cmdCommandId.value,
    // 只录当前平台，另一平台沿用旧绑定、无则拷贝新值
    darwin: platform.value === 'darwin' ? accel : (old?.darwin ?? accel),
    win32: platform.value === 'win32' ? accel : (old?.win32 ?? accel)
  }
  // 拷贝新值在另一平台可能不合法（如 darwin 录 Alt+Space），主进程 sanitize 会整项剔除，提前拦住提示
  if (!validateAccelerator(item.darwin, 'darwin').ok || !validateAccelerator(item.win32, 'win32').ok) {
    return `组合 ${accel} 无法构成双平台合法绑定，请换一个快捷键`
  }
  const list = [...prev.filter((h) => h.pluginId !== item.pluginId || h.commandId !== item.commandId), item]
  const r = await window.gtools.host('settings:set', { commandHotkeys: list })
  if (!r.ok) return r.error ?? '保存失败'
  commandHotkeyWarnings.value = warningsOf(r)
  return null
}

async function removeCommandHotkey(h: CommandHotkey): Promise<void> {
  const list = (props.settings?.commandHotkeys ?? []).filter(
    (x) => x.pluginId !== h.pluginId || x.commandId !== h.commandId
  )
  const r = await window.gtools.host('settings:set', { commandHotkeys: list })
  if (!r.ok) opError.value = r.error ?? '操作失败'
  else commandHotkeyWarnings.value = warningsOf(r)
}

async function togglePlugin(id: string, enabled: boolean): Promise<void> {
  const r = await window.gtools.host('plugins:set-enabled', { id, enabled })
  if (!r.ok) opError.value = r.error ?? '操作失败'
}

const backupMsg = ref<string | null>(null)
const backupIsError = ref(false)
const backupBusy = ref(false)

async function exportBackup(): Promise<void> {
  backupBusy.value = true
  backupMsg.value = null
  try {
    const r = await window.gtools.host('backup:export')
    if (!r.ok) {
      backupIsError.value = true
      backupMsg.value = r.error ?? '导出失败'
      return
    }
    const path = (r.data as { path: string | null } | null)?.path ?? null
    backupIsError.value = false
    backupMsg.value = path === null ? '已取消导出' : `已导出到 ${path}`
  } finally {
    backupBusy.value = false
  }
}

async function importBackup(): Promise<void> {
  backupBusy.value = true
  backupMsg.value = null
  try {
    const r = await window.gtools.host('backup:import')
    if (!r.ok) {
      backupIsError.value = true
      backupMsg.value = r.error ?? '导入失败'
      return
    }
    const d = r.data as {
      restored: boolean
      warnings: string[]
      restartRecommended: boolean
      safetyBackupPath: string | null
    }
    backupIsError.value = false
    if (!d.restored) {
      backupMsg.value = '已取消导入'
      return
    }
    const parts = ['导入成功']
    if (d.safetyBackupPath) parts.push(`导入前数据已快照到 ${d.safetyBackupPath}`)
    if (d.restartRecommended) parts.push('建议重启应用，使常驻插件加载导入的数据')
    if (d.warnings.length > 0) parts.push(d.warnings.join('；'))
    backupMsg.value = parts.join('，')
  } finally {
    backupBusy.value = false
  }
}
</script>

<template>
  <div class="settings">
    <section>
      <h3>通用</h3>
      <div class="row">
        <span class="name">开机自动启动</span>
        <span class="dim">登录系统后自动运行（开发模式不写系统登录项）</span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings?.launchAtLogin ?? false"
            @change="setLaunchAtLogin(($event.target as HTMLInputElement).checked)"
          />
          <span>{{ settings?.launchAtLogin ? '已开启' : '已关闭' }}</span>
        </label>
      </div>
      <div class="row">
        <span class="name">唤起时剪贴板推荐</span>
        <span class="dim">唤起后读取剪贴板内容，在空态前置推荐可处理它的插件</span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings?.clipboardSuggest ?? true"
            @change="setBehavior('clipboardSuggest', ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ settings?.clipboardSuggest ? '已开启' : '已关闭' }}</span>
        </label>
      </div>
      <div class="row">
        <span class="name">失焦自动隐藏</span>
        <span class="dim">点击其它窗口时自动隐藏主窗口</span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings?.hideOnBlur ?? true"
            @change="setBehavior('hideOnBlur', ($event.target as HTMLInputElement).checked)"
          />
          <span>{{ settings?.hideOnBlur ? '已开启' : '已关闭' }}</span>
        </label>
      </div>
    </section>

    <section>
      <h3>主题</h3>
      <div class="row">
        <button
          v-for="t in themes"
          :key="t.id"
          class="btn"
          :class="{ primary: settings?.theme === t.id }"
          @click="setTheme(t.id)"
        >
          {{ t.label }}
        </button>
      </div>
      <div v-if="settings?.theme === 'glass' && platform === 'win32'" class="row">
        <span class="name">玻璃风格</span>
        <span class="dim">清玻璃：窗口实时透明直透桌面（零算力）；屏幕折射：弹出瞬间取身后画面+折射效果；亚克力：系统实时磨砂，亮色系统偏奶白</span>
        <div>
          <button
            v-for="m in glassMaterials"
            :key="m.id"
            class="btn"
            :class="{ primary: (settings?.glassMaterial ?? 'wallpaper') === m.id }"
            @click="setGlassMaterial(m.id)"
          >
            {{ m.label }}
          </button>
        </div>
      </div>
      <div class="row">
        <span class="name">透明效果</span>
        <span class="dim">所有主题可开：面板半透明透出桌面（Win11 实时模糊 / Win10 退化半透明）</span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings?.transparency?.enabled ?? true"
            @change="setTransparency({ enabled: ($event.target as HTMLInputElement).checked })"
          />
          <span>{{ settings?.transparency?.enabled ? '已开启' : '已关闭' }}</span>
        </label>
      </div>
      <div class="row">
        <span class="name">透明度</span>
        <input
          class="slider"
          type="range"
          min="0"
          max="100"
          step="5"
          :value="settings?.transparency?.opacity ?? 55"
          @change="setTransparency({ opacity: Number(($event.target as HTMLInputElement).value) })"
        />
        <span class="dim">{{ settings?.transparency?.opacity ?? 55 }}%（越大越透）</span>
      </div>
      <div class="row">
        <span class="name">实时模糊</span>
        <span class="dim">亚克力/毛玻璃实时演算；关闭后仅保留透明着色（无模糊需重启完全生效）</span>
        <label class="switch">
          <input
            type="checkbox"
            :checked="settings?.transparency?.blur ?? true"
            @change="setTransparency({ blur: ($event.target as HTMLInputElement).checked })"
          />
          <span>{{ settings?.transparency?.blur ? '已开启' : '已关闭' }}</span>
        </label>
      </div>
    </section>

    <section>
      <h3>全局快捷键</h3>
      <div class="row">
        <span class="accel">{{ currentHotkey || '未设置' }}</span>
        <HotkeyRecorder :platform="platform" :conflict-check="globalConflict" :save="saveGlobalHotkey" />
      </div>
      <p v-if="globalHotkeyWarnings.length > 0" class="partial-warn">
        部分未生效：{{ globalHotkeyWarnings.join('；') }}
      </p>
    </section>

    <section>
      <h3>指令快捷键</h3>
      <p class="dim">为启用中的插件指令绑定全局唤起热键；保存即注册生效，按下直达对应指令</p>
      <div class="row">
        <select v-model="cmdPluginId" class="select" @change="cmdCommandId = ''">
          <option value="" disabled>选择插件</option>
          <option v-for="p in commandPlugins" :key="p.manifest.id" :value="p.manifest.id">
            {{ p.manifest.name }}
          </option>
        </select>
        <select v-model="cmdCommandId" class="select" :disabled="cmdPluginId === ''">
          <option value="" disabled>选择指令</option>
          <option v-for="c in selectedCommands" :key="c.id" :value="c.id">{{ c.title }}</option>
        </select>
        <HotkeyRecorder :platform="platform" :conflict-check="commandConflict" :save="saveCommandHotkey" />
      </div>
      <div v-for="h in settings?.commandHotkeys ?? []" :key="`${h.pluginId}:${h.commandId}`" class="row">
        <span class="name">{{ commandLabel(h) }}</span>
        <span class="accel">{{ h[platform] || '未设置' }}</span>
        <span v-if="!pluginEnabled(h.pluginId)" class="dim">插件已禁用</span>
        <button class="btn" @click="removeCommandHotkey(h)">删除</button>
      </div>
      <p v-if="commandHotkeyWarnings.length > 0" class="partial-warn">
        部分未生效：{{ commandHotkeyWarnings.join('；') }}
      </p>
    </section>

    <section>
      <h3>插件</h3>
      <div v-if="loadIssues.length > 0 || externalDetected.length > 0" class="notice">
        <p v-for="i in loadIssues" :key="`${i.pluginId}:${i.message}`" class="error">
          {{ i.pluginId }}：{{ i.message }}
        </p>
        <p v-for="d in externalDetected" :key="d.id" class="dim">
          检测到外部插件 {{ d.name }}：动态加载尚未开放，仅检测不安装
        </p>
      </div>
      <div v-for="p in plugins" :key="p.manifest.id" class="row plugin-row">
        <span class="icon">{{ p.manifest.icon }}</span>
        <span class="name">{{ p.manifest.name }}</span>
        <span class="dim">{{ p.manifest.id }} · v{{ p.manifest.version }}</span>
        <label class="switch">
          <input type="checkbox" :checked="p.enabled" @change="togglePlugin(p.manifest.id, ($event.target as HTMLInputElement).checked)" />
          <span>{{ p.enabled ? '已启用' : '已禁用' }}</span>
        </label>
      </div>
    </section>

    <ApiServicesSection />

    <section>
      <h3>备份与恢复</h3>
      <div class="row">
        <button class="btn" :disabled="backupBusy" @click="exportBackup">导出备份…</button>
        <button class="btn" :disabled="backupBusy" @click="importBackup">导入备份…</button>
      </div>
      <p v-if="backupMsg" class="backup-msg" :class="{ error: backupIsError }">{{ backupMsg }}</p>
      <p class="dim">备份包含应用设置、API 服务配置、插件启用状态与全部插件数据，可用于 Windows / macOS 之间迁移。</p>
    </section>

    <p v-if="opError" class="error">{{ opError }}</p>
    <p class="dim tip">按 Esc 返回搜索</p>
    <p v-if="appVersion" class="dim version-line">GTools v{{ appVersion }}</p>
  </div>
</template>

<style scoped>
.settings {
  height: 100%;
  overflow-y: auto;
  /* 顶部 80px 让位悬浮玻璃胶囊（64px 栏 + 16px 原上留白），底部 46px 让位玻璃底栏（30px + 16px） */
  padding: 80px 20px 46px;
  scroll-padding-top: 80px;
  background: var(--bg-content);
  /* 顶部/底部溶解：设置项滚入玻璃胶囊或底栏下方渐隐（#000 为 alpha 蒙版形状色，非 UI 颜色） */
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 64px, #000 calc(100% - 40px), transparent);
  mask-image: linear-gradient(to bottom, transparent 0, #000 64px, #000 calc(100% - 40px), transparent);
}
section {
  margin-bottom: 20px;
}
h3 {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--fg-dim);
  font-weight: 600;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.accel {
  font-family: ui-monospace, monospace;
  background: var(--accent-dim);
  padding: 4px 10px;
  border-radius: var(--r-sm);
  font-size: 13px;
}
.select {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 5px 10px;
  font-size: 13px;
  outline: none;
}
.slider {
  flex: none;
  width: 180px;
  accent-color: var(--accent);
}
.btn {
  background: var(--bg-raised);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 5px 12px;
  font-size: 13px;
  cursor: pointer;
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
.plugin-row .icon {
  font-size: 18px;
}
.notice {
  margin-bottom: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-raised);
}
.notice p {
  margin: 2px 0;
}
.name {
  font-size: 14px;
}
.dim {
  color: var(--fg-dim);
  font-size: 12px;
}
.switch {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--fg-dim);
  cursor: pointer;
}
.error {
  color: var(--danger);
  font-size: 13px;
}
.backup-msg {
  margin: 4px 0 8px;
  font-size: 12px;
  color: var(--fg-dim);
  word-break: break-all;
}
/* 保存生效但个别热键注册失败的「部分未生效」警告 */
.partial-warn {
  margin: 4px 0 8px;
  font-size: 12px;
  color: var(--warn);
}
.tip {
  margin-top: 12px;
}
/* 设置页最底部的当前版本号，便于核对安装包是否生效 */
.version-line {
  margin-top: 4px;
  font-size: 11px;
  color: var(--fg-dim);
  opacity: 0.8;
}
</style>
