<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { PluginManifest } from '@sdk/manifest'
import type { AppSettings, CommandHotkey, ThemeName, TransparencySettings } from '@sdk/settings'
import { validateAccelerator } from '@sdk/shortcut-rules'
import type { HostInitResult } from '../env'
import AboutSection from './AboutSection.vue'
import ApiServicesSection from './ApiServicesSection.vue'
import HotkeyRecorder from './HotkeyRecorder.vue'
import { warningsOf } from './settings-warnings'

const props = defineProps<{ settings: AppSettings | null; plugins: { manifest: PluginManifest; enabled: boolean }[] }>()

const opError = ref<string | null>(null)

// ---- 分区导航（外壳 UI 状态走 localStorage，照 App.vue RECENT_KEY 模式，零 IPC）----
type SectionId = 'general' | 'appearance' | 'hotkeys' | 'plugins' | 'data' | 'about'
const SECTION_KEY = 'gtools:settings-section'
const sections: { id: SectionId; title: string; icon: string }[] = [
  { id: 'general', title: '通用', icon: '⚙️' },
  { id: 'appearance', title: '外观', icon: '🎨' },
  { id: 'hotkeys', title: '快捷键', icon: '⌨️' },
  { id: 'plugins', title: '插件', icon: '🧩' },
  { id: 'data', title: '数据与服务', icon: '🗂️' },
  { id: 'about', title: '关于', icon: 'ℹ️' }
]

function loadSection(): SectionId {
  try {
    const v = localStorage.getItem(SECTION_KEY)
    return sections.some((s) => s.id === v) ? (v as SectionId) : 'general'
  } catch {
    return 'general'
  }
}

const sectionId = ref<SectionId>(loadSection())
watch(sectionId, (v) => {
  try {
    localStorage.setItem(SECTION_KEY, v)
  } catch {
    /* 存储不可用（隐私模式）时静默降级为不记忆 */
  }
})

const platform = computed(() => (navigator.userAgent.includes('Mac') ? 'darwin' : 'win32'))
const currentHotkey = computed(() => props.settings?.hotkey[platform.value] ?? '')
const themes: { id: ThemeName; label: string }[] = [
  { id: 'light', label: '白色' },
  { id: 'dark', label: '黑色' },
  { id: 'glass', label: '玻璃' }
]

async function setTheme(theme: ThemeName): Promise<void> {
  const r = await window.gtools.host('settings:set', { theme })
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

// ---- 插件分区 ----
async function togglePlugin(id: string, enabled: boolean): Promise<void> {
  const r = await window.gtools.host('plugins:set-enabled', { id, enabled })
  if (!r.ok) opError.value = r.error ?? '操作失败'
}

// 过滤框只做 name/id 子串匹配（大小写不敏感），不引入拼音（克制）
const pluginFilter = ref('')
const filteredPlugins = computed(() => {
  const q = pluginFilter.value.trim().toLowerCase()
  if (q === '') return props.plugins
  return props.plugins.filter((p) => p.manifest.name.toLowerCase().includes(q) || p.manifest.id.toLowerCase().includes(q))
})

// ---- 备份与恢复 ----
const backupMsg = ref<string | null>(null)
const backupIsError = ref(false)
const backupBusy = ref(false)
// 导入 recommend 重启时给出可点入口（app:relaunch），把「建议重启」文案变成动作
const restartNeeded = ref(false)

async function relaunchApp(): Promise<void> {
  const r = await window.gtools.host('app:relaunch')
  if (!r.ok) opError.value = r.error ?? '重启失败'
}

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
  restartNeeded.value = false
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
    if (d.warnings.length > 0) parts.push(d.warnings.join('；'))
    backupMsg.value = parts.join('，')
    restartNeeded.value = d.restartRecommended
  } finally {
    backupBusy.value = false
  }
}
</script>

<template>
  <div class="settings-page">
    <aside class="settings-nav">
      <button
        v-for="s in sections"
        :key="s.id"
        class="nav-item"
        :class="{ active: sectionId === s.id }"
        @click="sectionId = s.id"
      >
        <span class="nav-icon">{{ s.icon }}</span>
        <span>{{ s.title }}</span>
      </button>
    </aside>

    <!-- 滚动面板类名必须保留 .settings：base.css 悬浮滚动条与 App.vue 顶栏溶解条按它匹配 -->
    <div class="settings">
      <template v-if="sectionId === 'general'">
        <h2 class="page-title">通用</h2>
        <div class="group">
          <div class="group-title">启动与行为</div>
          <div class="stack">
            <div class="row">
              <div class="row-main">
                <span class="name">开机自动启动</span>
                <span class="desc">登录系统后自动运行（开发模式不写系统登录项）</span>
              </div>
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
              <div class="row-main">
                <span class="name">唤起时剪贴板推荐</span>
                <span class="desc">唤起后读取剪贴板内容，在空态前置推荐可处理它的插件</span>
              </div>
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
              <div class="row-main">
                <span class="name">失焦自动隐藏</span>
                <span class="desc">点击其它窗口时自动隐藏主窗口</span>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="settings?.hideOnBlur ?? true"
                  @change="setBehavior('hideOnBlur', ($event.target as HTMLInputElement).checked)"
                />
                <span>{{ settings?.hideOnBlur ? '已开启' : '已关闭' }}</span>
              </label>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="sectionId === 'appearance'">
        <h2 class="page-title">外观</h2>
        <div class="group">
          <div class="group-title">主题</div>
          <div class="seg">
            <button
              v-for="t in themes"
              :key="t.id"
              class="seg-item"
              :class="{ active: settings?.theme === t.id }"
              @click="setTheme(t.id)"
            >
              {{ t.label }}
            </button>
          </div>
        </div>
        <div class="group">
          <div class="group-title">透明效果</div>
          <div class="stack">
            <div class="row">
              <div class="row-main">
                <span class="name">透明效果</span>
                <span class="desc">所有主题可开：面板半透明透出桌面，模糊开走系统实时磨砂（Win11 亚克力 / macOS vibrancy）</span>
              </div>
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
              <div class="row-main">
                <!-- 玻璃主题下滑杆语义 = 磨砂度：0 厚磨砂、100 清玻璃 -->
                <span class="name">{{ settings?.theme === 'glass' ? '磨砂度' : '透明度' }}</span>
              </div>
              <input
                class="slider"
                type="range"
                min="0"
                max="100"
                step="5"
                :value="settings?.transparency?.opacity ?? 55"
                @change="setTransparency({ opacity: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="accel">{{ settings?.transparency?.opacity ?? 55 }}%</span>
            </div>
            <div class="row">
              <div class="row-main">
                <span class="name">实时模糊</span>
                <span class="desc">亚克力/毛玻璃实时演算；关闭后仅保留透明着色（无模糊需重启完全生效）</span>
              </div>
              <label class="switch">
                <input
                  type="checkbox"
                  :checked="settings?.transparency?.blur ?? true"
                  @change="setTransparency({ blur: ($event.target as HTMLInputElement).checked })"
                />
                <span>{{ settings?.transparency?.blur ? '已开启' : '已关闭' }}</span>
              </label>
            </div>
          </div>
        </div>
      </template>

      <template v-else-if="sectionId === 'hotkeys'">
        <h2 class="page-title">快捷键</h2>
        <div class="group">
          <div class="group-title">全局快捷键</div>
          <div class="row">
            <span class="accel">{{ currentHotkey || '未设置' }}</span>
            <HotkeyRecorder :platform="platform" :conflict-check="globalConflict" :save="saveGlobalHotkey" />
          </div>
          <p v-if="globalHotkeyWarnings.length > 0" class="partial-warn">
            部分未生效：{{ globalHotkeyWarnings.join('；') }}
          </p>
        </div>
        <div class="group">
          <div class="group-title">指令快捷键</div>
          <p class="desc">为启用中的插件指令绑定全局唤起热键；保存即注册生效，按下直达对应指令</p>
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
          <p v-if="(settings?.commandHotkeys ?? []).length === 0" class="desc empty-hint">暂无指令热键，选择插件与指令后录入</p>
          <div v-for="h in settings?.commandHotkeys ?? []" :key="`${h.pluginId}:${h.commandId}`" class="row hover-row cmd-row">
            <span class="name">{{ commandLabel(h) }}</span>
            <span v-if="!pluginEnabled(h.pluginId)" class="desc">插件已禁用</span>
            <span class="row-right">
              <span class="accel">{{ h[platform] || '未设置' }}</span>
              <button class="btn small" @click="removeCommandHotkey(h)">删除</button>
            </span>
          </div>
          <p v-if="commandHotkeyWarnings.length > 0" class="partial-warn">
            部分未生效：{{ commandHotkeyWarnings.join('；') }}
          </p>
        </div>
      </template>

      <template v-else-if="sectionId === 'plugins'">
        <h2 class="page-title">插件</h2>
        <div v-if="loadIssues.length > 0 || externalDetected.length > 0" class="notice">
          <p v-for="i in loadIssues" :key="`${i.pluginId}:${i.message}`" class="error">
            {{ i.pluginId }}：{{ i.message }}
          </p>
          <p v-for="d in externalDetected" :key="d.id" class="desc">
            检测到外部插件 {{ d.name }}：动态加载尚未开放，仅检测不安装
          </p>
        </div>
        <div class="group">
          <div class="group-title">已安装插件</div>
          <input v-model="pluginFilter" class="select filter-input" placeholder="过滤插件（名称 / id）" spellcheck="false" />
          <div v-for="p in filteredPlugins" :key="p.manifest.id" class="row hover-row plugin-row">
            <span class="icon">{{ p.manifest.icon }}</span>
            <div class="row-main">
              <span class="name">{{ p.manifest.name }}</span>
              <span class="desc">{{ p.manifest.id }} · v{{ p.manifest.version }}</span>
            </div>
            <label class="switch">
              <input type="checkbox" :checked="p.enabled" @change="togglePlugin(p.manifest.id, ($event.target as HTMLInputElement).checked)" />
              <span>{{ p.enabled ? '已启用' : '已禁用' }}</span>
            </label>
          </div>
          <p v-if="filteredPlugins.length === 0" class="desc empty-hint">没有匹配的插件</p>
        </div>
      </template>

      <template v-else-if="sectionId === 'data'">
        <h2 class="page-title">数据与服务</h2>
        <ApiServicesSection />
        <div class="group">
          <div class="group-title">备份与恢复</div>
          <div class="row">
            <button class="btn" :disabled="backupBusy" @click="exportBackup">导出备份…</button>
            <button class="btn" :disabled="backupBusy" @click="importBackup">导入备份…</button>
          </div>
          <p v-if="backupMsg" class="backup-msg" :class="{ error: backupIsError }">{{ backupMsg }}</p>
          <p v-if="restartNeeded" class="restart-hint">
            <span>建议重启应用，使常驻插件加载导入的数据</span>
            <button class="btn small" @click="relaunchApp">重启应用</button>
          </p>
          <p class="desc">备份包含应用设置、API 服务配置、插件启用状态与全部插件数据，可用于 Windows / macOS 之间迁移。</p>
        </div>
      </template>

      <template v-else-if="sectionId === 'about'">
        <h2 class="page-title">关于</h2>
      </template>

      <!-- KeepAlive 须常驻在分区条件分支链之外：包在 v-else 分支内会随分支一起卸载、缓存失效；内部 v-if 切换才走缓存保态 -->
      <KeepAlive>
        <AboutSection v-if="sectionId === 'about'" :app-version="appVersion" />
      </KeepAlive>

      <p v-if="opError" class="error">{{ opError }}</p>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  height: 100%;
  background: var(--bg-content);
}
/* 侧边栏不做 backdrop-filter：.settings 滚动面板自带 mask，后代玻璃会断 backdrop 采样链（玻璃纪律） */
.settings-nav {
  flex: none;
  width: 168px;
  padding: 80px var(--sp-2) 46px;
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  position: relative;
}
/* 分隔线限定在让位区内（与滚动面板 padding 80/46 对位），满高 border-right 会穿到顶栏/底栏下方 */
.settings-nav::after {
  content: '';
  position: absolute;
  top: 80px;
  bottom: 46px;
  right: 0;
  width: 1px;
  background: var(--border);
}
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: none;
  border-radius: var(--r-md);
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-title);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.nav-item:hover {
  background: var(--hover);
  color: var(--fg);
}
.nav-item.active {
  background: var(--active-row);
  color: var(--fg);
}
.nav-icon {
  flex: none;
}
.settings {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  /* 顶部 80px 让位悬浮玻璃胶囊（64px 栏 + 16px 原上留白），底部 46px 让位玻璃底栏（30px + 16px） */
  padding: 80px var(--sp-4) 46px;
  scroll-padding-top: 80px;
  background: var(--bg-content);
  /* 顶部/底部溶解：设置项滚入玻璃胶囊或底栏下方渐隐（#000 为 alpha 蒙版形状色，非 UI 颜色） */
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 64px, #000 calc(100% - 40px), transparent);
  mask-image: linear-gradient(to bottom, transparent 0, #000 64px, #000 calc(100% - 40px), transparent);
}
.page-title {
  font-size: var(--fs-input);
  font-weight: 600;
  margin: 0 0 var(--sp-4);
}
.group {
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  background: var(--bg-raised);
  padding: var(--sp-3) var(--sp-4);
  margin-bottom: var(--sp-4);
}
.group-title {
  display: flex;
  gap: var(--sp-2);
  font-size: var(--fs-title);
  color: var(--fg-dim);
  font-weight: 600;
  margin: 0 0 var(--sp-2);
}
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) 0;
}
/* 堆叠行组：行间细分隔（首行不加），用于通用/透明卡这类纯设置行 */
.stack .row + .row {
  border-top: 1px solid var(--border);
  margin-top: var(--sp-1);
  padding-top: var(--sp-2);
}
.row-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.row-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
/* 可操作行（插件行/指令热键行）悬浮高亮 */
.hover-row {
  border-radius: var(--r-md);
  padding: var(--sp-1) var(--sp-2);
}
.hover-row:hover {
  background: var(--hover);
}
.name {
  font-size: var(--fs-title);
  color: var(--fg);
}
.desc {
  font-size: var(--fs-sub);
  color: var(--fg-dim);
}
.accel {
  font-family: ui-monospace, monospace;
  background: var(--accent-dim);
  padding: 4px 10px;
  border-radius: var(--r-sm);
  font-size: var(--fs-sub);
}
.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  overflow: hidden;
}
.seg-item {
  padding: 6px 18px;
  border: none;
  background: transparent;
  color: var(--fg-dim);
  font-size: var(--fs-title);
  font-family: inherit;
  cursor: pointer;
}
.seg-item.active {
  background: var(--accent);
  color: var(--on-accent);
}
.seg-item:not(.active):hover {
  background: var(--hover);
  color: var(--fg);
}
.seg-item + .seg-item {
  border-left: 1px solid var(--border);
}
.select {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 5px 10px;
  font-size: var(--fs-title);
  font-family: inherit;
  outline: none;
}
.filter-input {
  width: 100%;
  margin-bottom: var(--sp-2);
  box-sizing: border-box;
}
.slider {
  flex: none;
  width: 180px;
  accent-color: var(--accent);
}
.btn {
  background: var(--bg);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 5px 12px;
  font-size: var(--fs-title);
  font-family: inherit;
  cursor: pointer;
}
.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--on-accent);
}
.btn.small {
  padding: 2px 8px;
  font-size: var(--fs-sub);
}
.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.plugin-row .icon {
  font-size: 18px;
}
.cmd-row .name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.notice {
  margin-bottom: var(--sp-3);
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bg-raised);
}
.notice p {
  margin: 2px 0;
}
.switch {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sub);
  color: var(--fg-dim);
  cursor: pointer;
  white-space: nowrap;
}
.error {
  color: var(--danger);
  font-size: var(--fs-title);
  margin: var(--sp-2) 0 0;
}
.backup-msg {
  margin: 4px 0 8px;
  font-size: var(--fs-sub);
  color: var(--fg-dim);
  word-break: break-all;
}
.backup-msg.error {
  color: var(--danger);
}
.restart-hint {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0 0 8px;
  font-size: var(--fs-sub);
  color: var(--fg-dim);
}
.empty-hint {
  margin: var(--sp-1) 0;
}
/* 保存生效但个别热键注册失败的「部分未生效」警告 */
.partial-warn {
  margin: 4px 0 8px;
  font-size: var(--fs-sub);
  color: var(--warn);
}
</style>
